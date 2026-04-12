import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { api } from '../utils/api';
import type {
  AppSocketMessage,
  AppTab,
  LoadingProgress,
  Project,
  ProjectSession,
  ProjectsUpdatedMessage,
} from '../types/app';
import {
  applyPromotions,
  buildOptimisticEntry,
  findCleanupIds,
  findProactivePromotions,
  isPlaceholderSummary,
  mergeOptimisticSessions,
  sweepTempIdsForProject,
  type BucketKey,
  type OptimisticEntry,
  type OptimisticSessionMap,
} from './optimisticSessions';

type UseProjectsStateArgs = {
  sessionId?: string;
  navigate: NavigateFunction;
  latestMessage: AppSocketMessage | null;
  isMobile: boolean;
  activeSessions: Set<string>;
};

type FetchProjectsOptions = {
  showLoadingState?: boolean;
};

const serialize = (value: unknown) => JSON.stringify(value ?? null);

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
  includeExternalSessions: boolean,
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    const baseChanged =
      nextProject.name !== prevProject.name ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions) ||
      serialize(nextProject.taskmaster) !== serialize(prevProject.taskmaster);

    if (baseChanged) {
      return true;
    }

    if (!includeExternalSessions) {
      return false;
    }

    return (
      serialize(nextProject.cursorSessions) !== serialize(prevProject.cursorSessions) ||
      serialize(nextProject.codexSessions) !== serialize(prevProject.codexSessions) ||
      serialize(nextProject.geminiSessions) !== serialize(prevProject.geminiSessions)
    );
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  return [
    ...(project.sessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.cursorSessions ?? []),
    ...(project.geminiSessions ?? []),
  ];
};

const isOptimisticSession = (session: ProjectSession | undefined): boolean => {
  return Boolean(session && (session as Record<string, unknown>).__optimistic === true);
};

const isUpdateAdditive = (
  currentProjects: Project[],
  updatedProjects: Project[],
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): boolean => {
  if (!selectedProject || !selectedSession) {
    return true;
  }

  const currentSelectedProject = currentProjects.find((project) => project.name === selectedProject.name);
  const updatedSelectedProject = updatedProjects.find((project) => project.name === selectedProject.name);

  if (!currentSelectedProject || !updatedSelectedProject) {
    return false;
  }

  const currentSelectedSession = getProjectSessions(currentSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );
  const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );

  // Optimistic → real: the selected session exists locally only as an
  // optimistic stub and the server payload now carries the real version.
  // This is exactly the additive case — allow the update through so the
  // sidebar can reconcile, without triggering a main-chat refetch.
  if (isOptimisticSession(currentSelectedSession) && updatedSelectedSession && !isOptimisticSession(updatedSelectedSession)) {
    return true;
  }

  if (!currentSelectedSession || !updatedSelectedSession) {
    return false;
  }

  return (
    currentSelectedSession.id === updatedSelectedSession.id &&
    currentSelectedSession.title === updatedSelectedSession.title &&
    currentSelectedSession.created_at === updatedSelectedSession.created_at &&
    currentSelectedSession.updated_at === updatedSelectedSession.updated_at
  );
};

/**
 * Remove any `__optimistic` marker from sessions in `updatedProjects` that
 * match a session id that was optimistically inserted but is now arriving
 * as real data. This is a no-op for projects without optimistic sessions.
 */
/**
 * How long an optimistic sidebar row survives without backend acknowledgement
 * before the fallback cleanup timer removes it. See the comment next to the
 * `optimisticCleanupTimersRef` usage for the full rationale.
 */
const OPTIMISTIC_FALLBACK_TTL_MS = 60_000;

const VALID_TABS: Set<string> = new Set(['chat', 'files', 'shell', 'git', 'tasks', 'preview']);

const isValidTab = (tab: string): tab is AppTab => {
  return VALID_TABS.has(tab) || tab.startsWith('plugin:');
};

const readPersistedTab = (): AppTab => {
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored && isValidTab(stored)) {
      return stored as AppTab;
    }
  } catch {
    // localStorage unavailable
  }
  return 'chat';
};

export function useProjectsState({
  sessionId,
  navigate,
  latestMessage,
  isMobile,
  activeSessions,
}: UseProjectsStateArgs) {
  const [projectsRaw, setProjectsRaw] = useState<Project[]>([]);
  /**
   * Side-car state for optimistic sidebar rows.
   *
   * These rows live entirely *outside* of `projectsRaw`. Every consumer of
   * the hook sees them through the `projects` useMemo below, which merges
   * them in on top of the server payload. This makes the optimistic row
   * impossible to accidentally wipe from any `setProjectsRaw` call — WS
   * broadcasts, REST polls, sidebar refreshes, delete strips, none of
   * them touch this map. The row simply *coexists* with raw projects data
   * until either the backend acknowledges the id (the merge de-dupes and
   * the cleanup effect removes the side-car entry) or the fallback timer
   * fires (explicit removal).
   */
  const [optimisticSessions, setOptimisticSessions] = useState<OptimisticSessionMap>({});

  const projects = useMemo<Project[]>(
    () => mergeOptimisticSessions(projectsRaw, optimisticSessions),
    [projectsRaw, optimisticSessions],
  );

  /**
   * Proactive promotion: when `projects_updated` arrives with a brand-new
   * session row in the same project + bucket as a side-car entry whose id
   * the server does NOT yet know, eagerly rename the side-car entry to
   * the server's id. This handles two situations:
   *
   * 1. **Pre-`session_created` race.** The side-car still holds the
   *    original `new-session-*` tempId from the composer, and
   *    `projects_updated` arrived before the provider backend emitted
   *    `session_created`. We promote the tempId to the server row's id
   *    so the merge dedupes.
   *
   * 2. **`session_created` lied about the id.** The provider backend
   *    (historically codex, which read `thread.id` before any turn had
   *    started and fell back to `codex-${Date.now()}`) pinned the
   *    side-car to a fake id. Chokidar later indexed the real session
   *    file under a completely different id and the two rows never
   *    converged — permanent duplicate. The extended match below ALSO
   *    applies to non-tempId optimistic entries, so even post-promote
   *    we can heal the id drift when a placeholder row materialises in
   *    the correct bucket.
   *
   * Match rule: for each optimistic side-car entry whose id is NOT in
   * projectsRaw, find server rows in the target project + bucket that
   * look "brand new" (summary empty or matching a backend placeholder
   * like 'New Session'/'Codex Session'). If exactly one such candidate
   * exists and its id isn't already tracked by the side-car, promote
   * the entry to that id. The overlay logic in the merge will then
   * paint the user-provided summary onto the server row and the
   * duplicate never appears.
   */
  useEffect(() => {
    const promotions = findProactivePromotions(projectsRaw, optimisticSessions);
    if (promotions.length === 0) return;

    setOptimisticSessions((prev) => applyPromotions(prev, promotions));

    // Hand fallback cleanup timers from tempIds over to their new ids.
    for (const { tempId } of promotions) {
      const oldTimer = optimisticCleanupTimersRef.current.get(tempId);
      if (oldTimer) {
        clearTimeout(oldTimer);
        optimisticCleanupTimersRef.current.delete(tempId);
      }
    }

    // If any promotion matches the currently selected session, move its
    // id with it so the sidebar highlight follows.
    setSelectedSession((prev) => {
      if (!prev) return prev;
      const match = promotions.find((p) => p.tempId === prev.id);
      if (!match) return prev;
      return { ...prev, id: match.realId };
    });
  }, [projectsRaw, optimisticSessions]);

  /**
   * Smart auto-cleanup for side-car entries.
   *
   * The side-car exists as a safety net for the window between "user
   * submitted a new chat" and "backend has indexed the real session file
   * with a real summary". Once the backend has the row AND has parsed a
   * real (non-placeholder) summary, the side-car entry is no longer
   * needed — the merge would skip it anyway — and holding it forever
   * causes two real problems:
   *
   * 1. **Accumulation across submissions.** Every new-session submit
   *    added an entry; with no cleanup they piled up indefinitely. Once
   *    the backend's id diverged from the side-car id (happens whenever
   *    `session_created` payload's id doesn't match what the file
   *    watcher later indexes), the stale entry stayed visible forever
   *    — exactly the "두 개의 '안녕' 세션" symptom.
   *
   * 2. **Stale entries across hot reloads.** Same root cause, just
   *    amplified by the dev loop.
   *
   * Cleanup rule: a side-car entry is removed iff
   *   - projectsRaw has the same id under its owning project, AND
   *   - the server row's summary is a real string (not empty, not one
   *     of the backend placeholders like 'New Session' / 'Codex Session').
   *
   * As long as the server row is still in a placeholder state we keep
   * the side-car alive so the overlay can paint the user text and so
   * any transient "row disappeared" payload still has a fallback.
   */
  useEffect(() => {
    const toRemove = findCleanupIds(projectsRaw, optimisticSessions);
    if (toRemove.length === 0) return;

    setOptimisticSessions((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of toRemove) {
        if (id in next) {
          delete next[id];
          changed = true;
          const t = optimisticCleanupTimersRef.current.get(id);
          if (t) {
            clearTimeout(t);
            optimisticCleanupTimersRef.current.delete(id);
          }
        }
      }
      return changed ? next : prev;
    });
  }, [projectsRaw, optimisticSessions]);

  // Backwards-compatible setProjects name for the rest of this file.
  const setProjects = setProjectsRaw;

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(readPersistedTab);

  useEffect(() => {
    try {
      localStorage.setItem('activeTab', activeTab);
    } catch {
      // Silently ignore storage errors
    }
  }, [activeTab]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('agents');
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optimisticCleanupTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /**
   * Sessions that the user just optimistically deleted from the sidebar.
   * The backend file-system watcher can broadcast a stale `projects_updated`
   * payload (still containing the row we just removed) before the real
   * delete propagates, which causes the row to flicker back into view for
   * a moment and then disappear again. While an id is in this map we strip
   * it from any incoming projects payload, so the row stays gone from the
   * moment of the click. The mapped value is the cleanup timer handle so
   * we can cancel cleanup early if the real payload already dropped the id.
   */
  const recentlyDeletedSessionsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const RECENTLY_DELETED_TTL_MS = 8000;

  /**
   * Insert a temporary session row into the sidebar immediately, so the user
   * sees their new chat without waiting for the backend JSONL refresh.
   *
   * The row is stored in the `optimisticSessions` side-car (NOT in
   * `projectsRaw`), which means no subsequent `setProjectsRaw` call — WS
   * broadcasts, REST polls, delete strips, whatever — can wipe it out. The
   * merged `projects` useMemo re-adds it on every render until either:
   *   - the backend acknowledges the id in `projectsRaw` (cleanup effect
   *     removes the side-car entry and the row transitions to authoritative
   *     server data in place), or
   *   - the OPTIMISTIC_FALLBACK_TTL_MS fallback timer fires (explicit
   *     removal so the row never gets permanently dirty).
   */
  const injectOptimisticSession = useCallback(
    (
      projectName: string,
      sessionMeta: { id: string; summary?: string; lastActivity?: string },
      provider?: string,
    ) => {
      if (!projectName || !sessionMeta?.id) return;
      const sessionId = sessionMeta.id;

      const entry = buildOptimisticEntry(projectName, sessionMeta, provider);

      setOptimisticSessions((prev) => {
        if (prev[sessionId]) return prev;
        return { ...prev, [sessionId]: entry };
      });

      // Clear any previous fallback timer for this id and arm a new one.
      const existingTimer = optimisticCleanupTimersRef.current.get(sessionId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      const timer = setTimeout(() => {
        optimisticCleanupTimersRef.current.delete(sessionId);
        setOptimisticSessions((prev) => {
          if (!(sessionId in prev)) return prev;
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
      }, OPTIMISTIC_FALLBACK_TTL_MS);
      optimisticCleanupTimersRef.current.set(sessionId, timer);
    },
    [],
  );

  /**
   * Rename an optimistic session's id from `tempId` to `realId` inside the
   * side-car. Called when `session_created` delivers the authoritative id,
   * so the sidebar row can stay in place while its identity swaps under
   * the hood. Also moves the fallback cleanup timer from tempId → realId so
   * the safety net still fires against the new id in the (rare) case the
   * backend never broadcasts a `projects_updated`.
   *
   * Returns true if a matching side-car entry was found and renamed.
   */
  const promoteOptimisticSession = useCallback(
    (tempId: string, realId: string): boolean => {
      if (!tempId || !realId || tempId === realId) return false;

      let promoted = false;
      setOptimisticSessions((prev) => {
        const entry = prev[tempId];
        if (!entry) return prev;
        const next = { ...prev };
        delete next[tempId];
        next[realId] = {
          ...entry,
          session: { ...entry.session, id: realId },
        };
        promoted = true;
        return next;
      });

      // If the selected session was pointing at the temp id, move the
      // selection to the real id in place so the sidebar highlight follows
      // the promoted row without a flicker.
      setSelectedSession((prev) => {
        if (!prev || prev.id !== tempId) return prev;
        return { ...prev, id: realId };
      });

      // Cancel the fallback cleanup timer — `session_created` firing means
      // the backend has confirmed the session is real, so we no longer need
      // the "this submission never reached the server" safety net. From
      // here on the side-car entry is sticky for the session's lifetime,
      // giving the merge a permanent fallback to paint the row even if
      // the backend's projects payload temporarily drops it (parse races,
      // mid-write reads, etc).
      const tempTimer = optimisticCleanupTimersRef.current.get(tempId);
      if (tempTimer) {
        clearTimeout(tempTimer);
        optimisticCleanupTimersRef.current.delete(tempId);
      }

      return promoted;
    },
    [],
  );

  /**
   * Sweep any leftover `new-session-*` optimistic entries from the side-car.
   *
   * Called after `session_created` as a belt-and-suspenders cleanup. Under
   * normal conditions `promoteOptimisticSession(tempId, realId)` atomically
   * removes the exact temp id, but if for any reason the exact temp id
   * can't be matched (e.g. the composer's `pendingViewSessionRef.tempId`
   * differs from what's actually in the side-car, or a stale tempId from
   * a previous submission is lingering), this sweep prevents the merge
   * from rendering the tempId row alongside the new real row — which
   * was the source of the "two identical sessions in sidebar" bug.
   *
   * Scoped by projectName so we never touch another project's in-flight
   * optimistic rows.
   */
  const sweepStaleOptimisticTempIds = useCallback((projectName: string) => {
    if (!projectName) return;
    setOptimisticSessions((prev) => {
      const { next, removed } = sweepTempIdsForProject(prev, projectName);
      for (const id of removed) {
        const t = optimisticCleanupTimersRef.current.get(id);
        if (t) {
          clearTimeout(t);
          optimisticCleanupTimersRef.current.delete(id);
        }
      }
      return next;
    });
  }, []);

  const fetchProjects = useCallback(async ({ showLoadingState = true }: FetchProjectsOptions = {}) => {
    try {
      if (showLoadingState) {
        setIsLoadingProjects(true);
      }
      const response = await api.projects();
      const projectData = (await response.json()) as Project[];

      setProjects((prevProjects) => {
        if (prevProjects.length === 0) {
          return projectData;
        }

        return projectsHaveChanges(prevProjects, projectData, true)
          ? projectData
          : prevProjects;
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      if (showLoadingState) {
        setIsLoadingProjects(false);
      }
    }
  }, []);

  const refreshProjectsSilently = useCallback(async () => {
    // Keep chat view stable while still syncing sidebar/session metadata in background.
    await fetchProjects({ showLoadingState: false });
  }, [fetchProjects]);

  const openSettings = useCallback((tab = 'tools') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  // Auto-select the project when there is only one, so the user lands on the new session page
  useEffect(() => {
    if (!isLoadingProjects && projects.length === 1 && !selectedProject && !sessionId) {
      setSelectedProject(projects[0]);
    }
  }, [isLoadingProjects, projects, selectedProject, sessionId]);

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    if (latestMessage.type === 'loading_progress') {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }

      setLoadingProgress(latestMessage as LoadingProgress);

      if (latestMessage.phase === 'complete') {
        loadingProgressTimeoutRef.current = setTimeout(() => {
          setLoadingProgress(null);
          loadingProgressTimeoutRef.current = null;
        }, 500);
      }

      return;
    }

    if (latestMessage.type !== 'projects_updated') {
      return;
    }

    const projectsMessage = latestMessage as ProjectsUpdatedMessage;

    if (projectsMessage.changedFile && selectedSession && selectedProject) {
      const normalized = projectsMessage.changedFile.replace(/\\/g, '/');
      const changedFileParts = normalized.split('/');

      if (changedFileParts.length >= 2) {
        const filename = changedFileParts[changedFileParts.length - 1];
        const changedSessionId = filename.replace('.jsonl', '');

        if (changedSessionId === selectedSession.id) {
          const isSessionActive = activeSessions.has(selectedSession.id);

          if (!isSessionActive) {
            setExternalMessageUpdate((prev) => prev + 1);
          }
        }
      }
    }

    const hasActiveSession =
      (selectedSession && activeSessions.has(selectedSession.id)) ||
      (activeSessions.size > 0 && Array.from(activeSessions).some((id) => id.startsWith('new-session-')));

    const rawUpdatedProjects = projectsMessage.projects;

    // Strip any session id the user just optimistically deleted. Without
    // this the row would flicker back into view if the backend broadcasts
    // a stale projects payload before its delete actually propagates.
    const recentlyDeletedIds = recentlyDeletedSessionsRef.current;
    const projectsAfterDeleteStrip = recentlyDeletedIds.size === 0
      ? rawUpdatedProjects
      : rawUpdatedProjects.map((project) => {
          const stripList = (list: ProjectSession[] | undefined) =>
            list?.filter((session) => !recentlyDeletedIds.has(session.id));
          const before = (project.sessions?.length ?? 0)
            + (project.cursorSessions?.length ?? 0)
            + (project.codexSessions?.length ?? 0)
            + (project.geminiSessions?.length ?? 0);
          const next = {
            ...project,
            sessions: stripList(project.sessions) ?? project.sessions,
            cursorSessions: stripList(project.cursorSessions) ?? project.cursorSessions,
            codexSessions: stripList(project.codexSessions) ?? project.codexSessions,
            geminiSessions: stripList(project.geminiSessions) ?? project.geminiSessions,
          };
          const after = (next.sessions?.length ?? 0)
            + (next.cursorSessions?.length ?? 0)
            + (next.codexSessions?.length ?? 0)
            + (next.geminiSessions?.length ?? 0);
          if (before !== after && next.sessionMeta) {
            next.sessionMeta = {
              ...next.sessionMeta,
              total: Math.max(0, ((next.sessionMeta.total as number | undefined) ?? before) - (before - after)),
            };
          }
          return next;
        });

    // If the server payload itself no longer contains a recently-deleted id,
    // the delete has propagated and we can let the cleanup happen naturally
    // (clear the explicit timer here so the entry vanishes immediately).
    if (recentlyDeletedIds.size > 0) {
      const serverIds = new Set<string>();
      for (const project of rawUpdatedProjects) {
        for (const session of getProjectSessions(project)) {
          serverIds.add(session.id);
        }
      }
      for (const [sessionId, timer] of recentlyDeletedIds) {
        if (!serverIds.has(sessionId)) {
          clearTimeout(timer);
          recentlyDeletedIds.delete(sessionId);
        }
      }
    }

    // Side-car optimistic rows are preserved automatically by the `projects`
    // useMemo merge — `projectsRaw` can be freely replaced here without
    // wiping them. A separate cleanup effect watches `projectsRaw` and drops
    // side-car entries the moment the server acknowledges them.
    const updatedProjects = projectsAfterDeleteStrip;

    if (
      hasActiveSession &&
      !isUpdateAdditive(projects, updatedProjects, selectedProject, selectedSession)
    ) {
      return;
    }

    setProjects(updatedProjects);

    if (!selectedProject) {
      return;
    }

    const updatedSelectedProject = updatedProjects.find(
      (project) => project.name === selectedProject.name,
    );

    if (!updatedSelectedProject) {
      return;
    }

    if (serialize(updatedSelectedProject) !== serialize(selectedProject)) {
      setSelectedProject(updatedSelectedProject);
    }

    if (!selectedSession) {
      return;
    }

    const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
      (session) => session.id === selectedSession.id,
    );

    if (!updatedSelectedSession) {
      setSelectedSession(null);
    }
  }, [latestMessage, selectedProject, selectedSession, activeSessions, projects]);

  useEffect(() => {
    const optimisticTimers = optimisticCleanupTimersRef.current;
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
      for (const timer of optimisticTimers.values()) {
        clearTimeout(timer);
      }
      optimisticTimers.clear();
    };
  }, []);

  useEffect(() => {
    if (!sessionId || projects.length === 0) {
      return;
    }

    for (const project of projects) {
      const claudeSession = project.sessions?.find((session) => session.id === sessionId);
      if (claudeSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'claude';

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...claudeSession, __provider: 'claude' });
        }
        return;
      }

      const cursorSession = project.cursorSessions?.find((session) => session.id === sessionId);
      if (cursorSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'cursor';

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...cursorSession, __provider: 'cursor' });
        }
        return;
      }

      const codexSession = project.codexSessions?.find((session) => session.id === sessionId);
      if (codexSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'codex';

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...codexSession, __provider: 'codex' });
        }
        return;
      }

      const geminiSession = project.geminiSessions?.find((session) => session.id === sessionId);
      if (geminiSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'gemini';

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...geminiSession, __provider: 'gemini' });
        }
        return;
      }
    }
  }, [sessionId, projects, selectedProject?.name, selectedSession?.id, selectedSession?.__provider]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      // Temp optimistic rows (id prefixed with `new-session-`) are not yet
      // resolvable on the backend. Clicking such a row should drop the user
      // back to the new-session landing ('/'), not navigate into a 404-ish
      // `/session/new-session-…` route.
      if (session.id && session.id.startsWith('new-session-')) {
        setSelectedSession(null);
        navigate('/');
        if (isMobile) {
          setSidebarOpen(false);
        }
        return;
      }

      setSelectedSession(session);

      // 사이드바에서 세션을 선택하면 — 어떤 탭(files / shell / git / tasks /
      // preview / 플러그인 등)을 보고 있었더라도 — 항상 채팅 탭으로 돌아간다.
      // 사용자가 "이 세션의 대화를 보고 싶어서" 클릭한 것이므로 컨텍스트를
      // 즉시 chat 으로 전환해 주는 게 자연스럽다.
      if (activeTab !== 'chat') {
        setActiveTab('chat');
      }

      const provider = localStorage.getItem('selected-provider') || 'claude';
      if (provider === 'cursor') {
        sessionStorage.setItem('cursorSessionId', session.id);
      }

      if (isMobile) {
        const sessionProjectName = session.__projectName;
        const currentProjectName = selectedProject?.name;

        if (sessionProjectName !== currentProjectName) {
          setSidebarOpen(false);
        }
      }

      navigate(`/session/${session.id}`);
    },
    [activeTab, isMobile, navigate, selectedProject?.name],
  );

  const handleNewSession = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');

      // Notify the chat layer that the active session is no longer in-flight.
      // Without this, the composer / status bar can stay stuck in isLoading
      // from the previous session, making the "새 스레드" button appear to do
      // nothing because the chat pane still renders the old processing state.
      if (typeof window !== 'undefined' && (window as any).__vienna_resetChatLoading__) {
        (window as any).__vienna_resetChatLoading__();
      }

      // Clear stale sessionStorage keys that can otherwise leak the
      // previous session's id into the composer's submission path. The
      // composer's `effectiveSessionId` fallback chain is:
      //
      //   currentSessionId
      //     || selectedSession?.id
      //     || sessionStorage.getItem('cursorSessionId')
      //
      // If we leave `cursorSessionId` or `pendingSessionId` set after the
      // user clicks "새 스레드", the next submission picks the wrong id,
      // skips the optimistic-inject branch, and effectively sends the
      // new message into the previous session context — which looked to
      // the user like the + button doing nothing.
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.removeItem('pendingSessionId');
          sessionStorage.removeItem('cursorSessionId');
        } catch {
          // ignore storage errors
        }
      }

      // Navigate last so the URL change and all the synchronous state
      // updates above land in the same React commit.
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      // Mark id as recently-deleted so any stale `projects_updated` payload
      // arriving in the next few seconds (which can still contain the row)
      // gets stripped instead of flickering the row back onto the sidebar.
      const existingTimer = recentlyDeletedSessionsRef.current.get(sessionIdToDelete);
      if (existingTimer) clearTimeout(existingTimer);
      const cleanupTimer = setTimeout(() => {
        recentlyDeletedSessionsRef.current.delete(sessionIdToDelete);
      }, RECENTLY_DELETED_TTL_MS);
      recentlyDeletedSessionsRef.current.set(sessionIdToDelete, cleanupTimer);

      if (selectedSession?.id === sessionIdToDelete) {
        setSelectedSession(null);
        navigate('/');
      }

      // Optimistically drop the session from EVERY provider list, not just
      // `sessions`. The backend exposes claude rows under `sessions`, cursor
      // under `cursorSessions`, codex under `codexSessions`, gemini under
      // `geminiSessions`, and historically a missed list was the source of
      // earlier flicker bugs.
      const stripFromList = (list: ProjectSession[] | undefined) =>
        list?.filter((session) => session.id !== sessionIdToDelete);

      setProjects((prevProjects) =>
        prevProjects.map((project) => ({
          ...project,
          sessions: stripFromList(project.sessions) ?? [],
          cursorSessions: stripFromList(project.cursorSessions) ?? project.cursorSessions,
          codexSessions: stripFromList(project.codexSessions) ?? project.codexSessions,
          geminiSessions: stripFromList(project.geminiSessions) ?? project.geminiSessions,
          sessionMeta: {
            ...project.sessionMeta,
            total: Math.max(0, (project.sessionMeta?.total as number | undefined ?? 0) - 1),
          },
        })),
      );

      // Also drop any side-car optimistic entry keyed by this session id,
      // so the deleted session can't reappear via the merge overlay.
      setOptimisticSessions((prev) => {
        if (!(sessionIdToDelete in prev)) return prev;
        const next = { ...prev };
        delete next[sessionIdToDelete];
        return next;
      });
      const pendingTimer = optimisticCleanupTimersRef.current.get(sessionIdToDelete);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        optimisticCleanupTimersRef.current.delete(sessionIdToDelete);
      }
    },
    [navigate, selectedSession?.id],
  );

  const handleSidebarRefresh = useCallback(async () => {
    try {
      const response = await api.projects();
      const freshProjects = (await response.json()) as Project[];

      setProjects((prevProjects) =>
        projectsHaveChanges(prevProjects, freshProjects, true) ? freshProjects : prevProjects,
      );

      if (!selectedProject) {
        return;
      }

      const refreshedProject = freshProjects.find((project) => project.name === selectedProject.name);
      if (!refreshedProject) {
        return;
      }

      if (serialize(refreshedProject) !== serialize(selectedProject)) {
        setSelectedProject(refreshedProject);
      }

      if (!selectedSession) {
        return;
      }

      const refreshedSession = getProjectSessions(refreshedProject).find(
        (session) => session.id === selectedSession.id,
      );

      if (refreshedSession) {
        // Keep provider metadata stable when refreshed payload doesn't include __provider.
        const normalizedRefreshedSession =
          refreshedSession.__provider || !selectedSession.__provider
            ? refreshedSession
            : { ...refreshedSession, __provider: selectedSession.__provider };

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [selectedProject, selectedSession]);

  const handleProjectDelete = useCallback(
    (projectName: string) => {
      if (selectedProject?.name === projectName) {
        setSelectedProject(null);
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.name !== projectName));
    },
    [navigate, selectedProject?.name],
  );

  const sidebarSharedProps = useMemo(
    () => ({
      projects,
      selectedProject,
      selectedSession,
      onProjectSelect: handleProjectSelect,
      onSessionSelect: handleSessionSelect,
      onNewSession: handleNewSession,
      onSessionDelete: handleSessionDelete,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: () => setShowSettings(true),
      showSettings,
      settingsInitialTab,
      onCloseSettings: () => setShowSettings(false),
      isMobile,
    }),
    [
      handleNewSession,
      handleProjectDelete,
      handleProjectSelect,
      handleSessionDelete,
      handleSessionSelect,
      handleSidebarRefresh,
      isLoadingProjects,
      isMobile,
      loadingProgress,
      projects,
      settingsInitialTab,
      selectedProject,
      selectedSession,
      showSettings,
    ],
  );

  return {
    projects,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    loadingProgress,
    isInputFocused,
    showSettings,
    settingsInitialTab,
    externalMessageUpdate,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    fetchProjects,
    refreshProjectsSilently,
    injectOptimisticSession,
    promoteOptimisticSession,
    sweepStaleOptimisticTempIds,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleNewSession,
    handleSessionDelete,
    handleProjectDelete,
    handleSidebarRefresh,
  };
}
