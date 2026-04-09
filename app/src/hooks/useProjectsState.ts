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

const projectHasOptimisticSessions = (project: Project | undefined): boolean => {
  if (!project) return false;
  return getProjectSessions(project).some(isOptimisticSession);
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
const reconcileOptimisticSessions = (
  currentProjects: Project[],
  updatedProjects: Project[],
): Project[] => {
  if (!currentProjects.some(projectHasOptimisticSessions)) {
    return updatedProjects;
  }
  const optimisticIds = new Set<string>();
  for (const project of currentProjects) {
    for (const session of getProjectSessions(project)) {
      if (isOptimisticSession(session)) {
        optimisticIds.add(session.id);
      }
    }
  }
  if (optimisticIds.size === 0) return updatedProjects;

  const stripMarker = (sessions?: ProjectSession[]) =>
    sessions?.map((session) => {
      if (!optimisticIds.has(session.id)) return session;
      const next = { ...session } as ProjectSession & { __optimistic?: boolean };
      delete next.__optimistic;
      return next;
    });

  return updatedProjects.map((project) => ({
    ...project,
    sessions: stripMarker(project.sessions) ?? project.sessions,
    cursorSessions: stripMarker(project.cursorSessions) ?? project.cursorSessions,
    codexSessions: stripMarker(project.codexSessions) ?? project.codexSessions,
    geminiSessions: stripMarker(project.geminiSessions) ?? project.geminiSessions,
  }));
};

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
  const [projects, setProjects] = useState<Project[]>([]);
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
   * The real `projects_updated` payload eventually replaces this with the
   * authoritative record (reconcileOptimisticSessions strips the marker).
   *
   * A 5s fallback timer removes the stub if the real update never arrives,
   * so the sidebar never gets permanently dirty.
   */
  const injectOptimisticSession = useCallback(
    (
      projectName: string,
      sessionMeta: { id: string; summary?: string; lastActivity?: string },
    ) => {
      if (!projectName || !sessionMeta?.id) return;
      const sessionId = sessionMeta.id;

      setProjects((prevProjects) => {
        const targetIndex = prevProjects.findIndex((project) => project.name === projectName);
        if (targetIndex === -1) return prevProjects;

        const targetProject = prevProjects[targetIndex];
        const existingSessions = targetProject.sessions ?? [];

        // Don't double-insert if the session is already listed (real or optimistic).
        if (existingSessions.some((session) => session.id === sessionId)) {
          return prevProjects;
        }

        const now = sessionMeta.lastActivity || new Date().toISOString();
        const optimisticSession: ProjectSession = {
          id: sessionId,
          summary: sessionMeta.summary,
          title: sessionMeta.summary,
          lastActivity: now,
          created_at: now,
          updated_at: now,
          __provider: 'claude',
          __optimistic: true,
        };

        const nextProject: Project = {
          ...targetProject,
          sessions: [optimisticSession, ...existingSessions],
          sessionMeta: {
            ...targetProject.sessionMeta,
            total:
              typeof targetProject.sessionMeta?.total === 'number'
                ? (targetProject.sessionMeta.total as number) + 1
                : undefined,
          },
        };

        const nextProjects = [...prevProjects];
        nextProjects[targetIndex] = nextProject;
        return nextProjects;
      });

      // Clear any previous fallback timer for this id and arm a new one.
      const existingTimer = optimisticCleanupTimersRef.current.get(sessionId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      const timer = setTimeout(() => {
        optimisticCleanupTimersRef.current.delete(sessionId);
        setProjects((prevProjects) => {
          let changed = false;
          const nextProjects = prevProjects.map((project) => {
            if (project.name !== projectName) return project;
            const sessions = project.sessions ?? [];
            const filtered = sessions.filter(
              (session) => !(session.id === sessionId && isOptimisticSession(session)),
            );
            if (filtered.length === sessions.length) return project;
            changed = true;
            return { ...project, sessions: filtered };
          });
          return changed ? nextProjects : prevProjects;
        });
      }, 5000);
      optimisticCleanupTimersRef.current.set(sessionId, timer);
    },
    [],
  );

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

    // Strip the `__optimistic` marker for any ids the server now knows about,
    // and cancel any pending fallback timers so we don't delete the real row
    // from under ourselves.
    const updatedProjects = reconcileOptimisticSessions(projects, projectsAfterDeleteStrip);

    if (optimisticCleanupTimersRef.current.size > 0) {
      const knownServerIds = new Set<string>();
      for (const project of rawUpdatedProjects) {
        for (const session of getProjectSessions(project)) {
          knownServerIds.add(session.id);
        }
      }
      for (const [sessionId, timer] of optimisticCleanupTimersRef.current) {
        if (knownServerIds.has(sessionId)) {
          clearTimeout(timer);
          optimisticCleanupTimersRef.current.delete(sessionId);
        }
      }
    }

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
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleNewSession,
    handleSessionDelete,
    handleProjectDelete,
    handleSidebarRefresh,
  };
}
