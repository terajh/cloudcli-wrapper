import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { TFunction } from 'i18next';
import { api } from '../../../utils/api';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import type {
  AdditionalSessionsByProject,
  DeleteProjectConfirmation,
  LoadingSessionsByProject,
  ProjectSortOrder,
  SessionDeleteConfirmation,
  SessionWithProvider,
} from '../types/types';
import {
  filterProjects,
  getAllSessions,
  loadStarredProjects,
  persistStarredProjects,
  readProjectSortOrder,
  sortProjects,
} from '../utils/utils';

type SnippetHighlight = {
  start: number;
  end: number;
};

type ConversationMatch = {
  role: string;
  snippet: string;
  highlights: SnippetHighlight[];
  timestamp: string | null;
  provider?: string;
  messageUuid?: string | null;
};

type ConversationSession = {
  sessionId: string;
  sessionSummary: string;
  provider?: string;
  matches: ConversationMatch[];
};

type ConversationProjectResult = {
  projectName: string;
  projectDisplayName: string;
  sessions: ConversationSession[];
};

export type ConversationSearchResults = {
  results: ConversationProjectResult[];
  totalMatches: number;
  query: string;
};

export type SearchProgress = {
  scannedProjects: number;
  totalProjects: number;
};

type UseSidebarControllerArgs = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  isMobile: boolean;
  t: TFunction;
  onRefresh: () => Promise<void> | void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onSessionDelete?: (sessionId: string) => void;
  onProjectDelete?: (projectName: string) => void;
  setCurrentProject: (project: Project) => void;
  setSidebarVisible: (visible: boolean) => void;
  sidebarVisible: boolean;
};

export function useSidebarController({
  projects,
  selectedProject,
  selectedSession,
  isLoading,
  isMobile,
  t,
  onRefresh,
  onProjectSelect,
  onSessionSelect,
  onSessionDelete,
  onProjectDelete,
  setCurrentProject,
  setSidebarVisible,
  sidebarVisible,
}: UseSidebarControllerArgs) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [loadingSessions, setLoadingSessions] = useState<LoadingSessionsByProject>({});
  const [additionalSessions, setAdditionalSessions] = useState<AdditionalSessionsByProject>({});
  const [initialSessionsLoaded, setInitialSessionsLoaded] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(new Date());
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>('name');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [projectHasMoreOverrides, setProjectHasMoreOverrides] = useState<Record<string, boolean>>({});
  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [deletingProjects, setDeletingProjects] = useState<Set<string>>(new Set());
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteProjectConfirmation | null>(null);
  const [sessionDeleteConfirmation, setSessionDeleteConfirmation] = useState<SessionDeleteConfirmation | null>(null);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [starredProjects, setStarredProjects] = useState<Set<string>>(() => loadStarredProjects());
  const [searchMode, setSearchMode] = useState<'projects' | 'conversations'>('projects');
  const [conversationResults, setConversationResults] = useState<ConversationSearchResults | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<SearchProgress | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const isSidebarCollapsed = !isMobile && !sidebarVisible;

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setAdditionalSessions({});
    setInitialSessionsLoaded(new Set());
    setProjectHasMoreOverrides({});
  }, [projects]);

  // selectedProject가 실제로 바뀌었을 때만 자동 펼치기 (이름 기준).
  // 이전에는 [selectedSession, selectedProject]를 deps로 두어, 다른 프로젝트의
  // 세션을 클릭한 직후 selectedSession은 갱신되었으나 selectedProject 갱신이
  // 한 틱 지연되는 사이 effect가 옛 selectedProject로 실행되어 닫혀있던
  // 다른 프로젝트가 다시 열리는 버그가 있었음.
  const lastExpandedProjectNameRef = useRef<string | null>(null);
  useEffect(() => {
    const name = selectedProject?.name ?? null;
    if (!name || lastExpandedProjectNameRef.current === name) {
      return;
    }
    lastExpandedProjectNameRef.current = name;
    setExpandedProjects((prev) => {
      if (prev.has(name)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  }, [selectedProject]);

  useEffect(() => {
    if (projects.length > 0 && !isLoading) {
      const loadedProjects = new Set<string>();
      projects.forEach((project) => {
        if (project.sessions && project.sessions.length >= 0) {
          loadedProjects.add(project.name);
        }
      });
      setInitialSessionsLoaded(loadedProjects);
    }
  }, [projects, isLoading]);

  useEffect(() => {
    const loadSortOrder = () => {
      setProjectSortOrder(readProjectSortOrder());
    };

    loadSortOrder();

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'claude-settings') {
        loadSortOrder();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    const interval = setInterval(() => {
      if (document.hasFocus()) {
        loadSortOrder();
      }
    }, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Debounced conversation search with SSE streaming
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const query = searchFilter.trim();
    if (searchMode !== 'conversations' || query.length < 2) {
      searchSeqRef.current += 1;
      setConversationResults(null);
      setSearchProgress(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const seq = ++searchSeqRef.current;

    searchTimeoutRef.current = setTimeout(() => {
      if (seq !== searchSeqRef.current) return;

      const url = api.searchConversationsUrl(query);
      const es = new EventSource(url);
      eventSourceRef.current = es;

      const accumulated: ConversationProjectResult[] = [];
      let totalMatches = 0;

      es.addEventListener('result', (evt) => {
        if (seq !== searchSeqRef.current) { es.close(); return; }
        try {
          const data = JSON.parse(evt.data) as {
            projectResult: ConversationProjectResult;
            totalMatches: number;
            scannedProjects: number;
            totalProjects: number;
          };
          accumulated.push(data.projectResult);
          totalMatches = data.totalMatches;
          setConversationResults({ results: [...accumulated], totalMatches, query });
          setSearchProgress({ scannedProjects: data.scannedProjects, totalProjects: data.totalProjects });
        } catch {
          // Ignore malformed SSE data
        }
      });

      es.addEventListener('progress', (evt) => {
        if (seq !== searchSeqRef.current) { es.close(); return; }
        try {
          const data = JSON.parse(evt.data) as { totalMatches: number; scannedProjects: number; totalProjects: number };
          totalMatches = data.totalMatches;
          setSearchProgress({ scannedProjects: data.scannedProjects, totalProjects: data.totalProjects });
        } catch {
          // Ignore malformed SSE data
        }
      });

      es.addEventListener('done', () => {
        if (seq !== searchSeqRef.current) { es.close(); return; }
        es.close();
        eventSourceRef.current = null;
        setIsSearching(false);
        setSearchProgress(null);
        if (accumulated.length === 0) {
          setConversationResults({ results: [], totalMatches: 0, query });
        }
      });

      es.addEventListener('error', () => {
        if (seq !== searchSeqRef.current) { es.close(); return; }
        es.close();
        eventSourceRef.current = null;
        setIsSearching(false);
        setSearchProgress(null);
        if (accumulated.length === 0) {
          setConversationResults({ results: [], totalMatches: 0, query });
        }
      });
    }, 400);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [searchFilter, searchMode]);

  const handleTouchClick = useCallback(
    (callback: () => void) =>
      (event: React.TouchEvent<HTMLElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest('.overflow-y-auto') || target.closest('[data-scroll-container]')) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        callback();
      },
    [],
  );

  const toggleProject = useCallback((projectName: string) => {
    // 여러 프로젝트를 동시에 펼칠 수 있도록 토글 방식으로 변경
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectName)) {
        next.delete(projectName);
      } else {
        next.add(projectName);
      }
      return next;
    });
  }, []);

  const handleSessionClick = useCallback(
    (session: SessionWithProvider, projectName: string) => {
      onSessionSelect({ ...session, __projectName: projectName });
    },
    [onSessionSelect],
  );

  const toggleStarProject = useCallback((projectName: string) => {
    setStarredProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectName)) {
        next.delete(projectName);
      } else {
        next.add(projectName);
      }

      persistStarredProjects(next);
      return next;
    });
  }, []);

  const isProjectStarred = useCallback(
    (projectName: string) => starredProjects.has(projectName),
    [starredProjects],
  );

  const getProjectSessions = useCallback(
    (project: Project) => getAllSessions(project, additionalSessions),
    [additionalSessions],
  );

  const projectsWithSessionMeta = useMemo(
    () =>
      projects.map((project) => {
        const hasMoreOverride = projectHasMoreOverrides[project.name];
        if (hasMoreOverride === undefined) {
          return project;
        }

        return {
          ...project,
          sessionMeta: { ...project.sessionMeta, hasMore: hasMoreOverride },
        };
      }),
    [projectHasMoreOverrides, projects],
  );

  const sortedProjects = useMemo(
    () => sortProjects(projectsWithSessionMeta, projectSortOrder, starredProjects, additionalSessions),
    [additionalSessions, projectSortOrder, projectsWithSessionMeta, starredProjects],
  );

  const filteredProjects = useMemo(
    () => filterProjects(sortedProjects, searchFilter),
    [searchFilter, sortedProjects],
  );

  const startEditing = useCallback((project: Project) => {
    setEditingProject(project.name);
    setEditingName(project.displayName);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingProject(null);
    setEditingName('');
  }, []);

  const saveProjectName = useCallback(
    async (projectName: string) => {
      try {
        const response = await api.renameProject(projectName, editingName);
        if (response.ok) {
          if (window.refreshProjects) {
            await window.refreshProjects();
          } else {
            window.location.reload();
          }
        } else {
          console.error('Failed to rename project');
        }
      } catch (error) {
        console.error('Error renaming project:', error);
      } finally {
        setEditingProject(null);
        setEditingName('');
      }
    },
    [editingName],
  );

  const showDeleteSessionConfirmation = useCallback(
    (
      projectName: string,
      sessionId: string,
      sessionTitle: string,
      provider: SessionDeleteConfirmation['provider'] = 'claude',
    ) => {
      setSessionDeleteConfirmation({ projectName, sessionId, sessionTitle, provider });
    },
    [],
  );

  const confirmDeleteSession = useCallback(() => {
    if (!sessionDeleteConfirmation) {
      return;
    }

    const { projectName, sessionId, provider } = sessionDeleteConfirmation;
    setSessionDeleteConfirmation(null);

    // Optimistic delete: drop the row from the UI right away so the click
    // feels instant. The network request goes out fire-and-forget; the
    // existing handleSessionDelete in useProjectsState already updates the
    // local projects state, so there is no flicker from a re-fetch.
    onSessionDelete?.(sessionId);

    const deletePromise = (() => {
      if (provider === 'codex') return api.deleteCodexSession(sessionId);
      if (provider === 'gemini') return api.deleteGeminiSession(sessionId);
      return api.deleteSession(projectName, sessionId);
    })();

    deletePromise
      .then(async (response) => {
        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          console.error('[Sidebar] Failed to delete session:', {
            status: response.status,
            error: errorText,
          });
          // Surface the failure but do NOT auto-restore the row — the user
          // already saw it disappear. A subsequent project refetch will
          // resync if the backend kept it.
          alert(t('messages.deleteSessionFailed'));
        }
      })
      .catch((error) => {
        console.error('[Sidebar] Error deleting session:', error);
        alert(t('messages.deleteSessionError'));
      });
  }, [onSessionDelete, sessionDeleteConfirmation, t]);

  // One-click delete (no confirmation modal). Used by the sidebar trash
  // button so a hover-revealed click vanishes the row immediately.
  const deleteSessionImmediate = useCallback(
    (
      projectName: string,
      sessionId: string,
      _sessionTitle: string,
      provider: SessionDeleteConfirmation['provider'] = 'claude',
    ) => {
      onSessionDelete?.(sessionId);

      const deletePromise = (() => {
        if (provider === 'codex') return api.deleteCodexSession(sessionId);
        if (provider === 'gemini') return api.deleteGeminiSession(sessionId);
        return api.deleteSession(projectName, sessionId);
      })();

      deletePromise
        .then(async (response) => {
          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            console.error('[Sidebar] Failed to delete session (immediate):', {
              status: response.status,
              error: errorText,
            });
          }
        })
        .catch((error) => {
          console.error('[Sidebar] Error deleting session (immediate):', error);
        });
    },
    [onSessionDelete],
  );

  const requestProjectDelete = useCallback(
    (project: Project) => {
      setDeleteConfirmation({
        project,
        sessionCount: getProjectSessions(project).length,
      });
    },
    [getProjectSessions],
  );

  const confirmDeleteProject = useCallback(async () => {
    if (!deleteConfirmation) {
      return;
    }

    const { project, sessionCount } = deleteConfirmation;
    const isEmpty = sessionCount === 0;

    setDeleteConfirmation(null);
    setDeletingProjects((prev) => new Set([...prev, project.name]));

    try {
      const response = await api.deleteProject(project.name, !isEmpty);

      if (response.ok) {
        onProjectDelete?.(project.name);
      } else {
        const error = (await response.json()) as { error?: string };
        alert(error.error || t('messages.deleteProjectFailed'));
      }
    } catch (error) {
      console.error('Error deleting project:', error);
      alert(t('messages.deleteProjectError'));
    } finally {
      setDeletingProjects((prev) => {
        const next = new Set(prev);
        next.delete(project.name);
        return next;
      });
    }
  }, [deleteConfirmation, onProjectDelete, t]);

  const loadMoreSessions = useCallback(
    async (project: Project) => {
      const hasMoreOverride = projectHasMoreOverrides[project.name];
      const canLoadMore =
        hasMoreOverride !== undefined ? hasMoreOverride : project.sessionMeta?.hasMore === true;
      if (!canLoadMore || loadingSessions[project.name]) {
        return;
      }

      setLoadingSessions((prev) => ({ ...prev, [project.name]: true }));

      try {
        const currentSessionCount =
          (project.sessions?.length || 0) + (additionalSessions[project.name]?.length || 0);
        // 한 번에 남은 모든 세션 로드 (limit 1000)
        const response = await api.sessions(project.name, 1000, currentSessionCount);

        if (!response.ok) {
          return;
        }

        const result = (await response.json()) as {
          sessions?: ProjectSession[];
          hasMore?: boolean;
        };

        setAdditionalSessions((prev) => ({
          ...prev,
          [project.name]: [...(prev[project.name] || []), ...(result.sessions || [])],
        }));

        if (result.hasMore === false) {
          // Keep hasMore state in local hook state instead of mutating the project prop object.
          setProjectHasMoreOverrides((prev) => ({ ...prev, [project.name]: false }));
        }
      } catch (error) {
        console.error('Error loading more sessions:', error);
      } finally {
        setLoadingSessions((prev) => ({ ...prev, [project.name]: false }));
      }
    },
    [additionalSessions, loadingSessions, projectHasMoreOverrides],
  );

  const handleProjectSelect = useCallback(
    (project: Project) => {
      onProjectSelect(project);
      setCurrentProject(project);
    },
    [onProjectSelect, setCurrentProject],
  );

  const refreshProjects = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh]);

  const updateSessionSummary = useCallback(
    async (_projectName: string, sessionId: string, summary: string, provider: SessionProvider) => {
      const trimmed = summary.trim();
      if (!trimmed) {
        setEditingSession(null);
        setEditingSessionName('');
        return;
      }
      try {
        const response = await api.renameSession(sessionId, trimmed, provider);
        if (response.ok) {
          await onRefresh();
        } else {
          console.error('[Sidebar] Failed to rename session:', response.status);
          alert(t('messages.renameSessionFailed'));
        }
      } catch (error) {
        console.error('[Sidebar] Error renaming session:', error);
        alert(t('messages.renameSessionError'));
      } finally {
        setEditingSession(null);
        setEditingSessionName('');
      }
    },
    [onRefresh, t],
  );

  const collapseSidebar = useCallback(() => {
    setSidebarVisible(false);
  }, [setSidebarVisible]);

  const expandSidebar = useCallback(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  return {
    isSidebarCollapsed,
    expandedProjects,
    editingProject,
    showNewProject,
    editingName,
    loadingSessions,
    additionalSessions,
    initialSessionsLoaded,
    currentTime,
    projectSortOrder,
    isRefreshing,
    editingSession,
    editingSessionName,
    searchFilter,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    starredProjects,
    filteredProjects,
    toggleProject,
    handleSessionClick,
    toggleStarProject,
    isProjectStarred,
    getProjectSessions,
    startEditing,
    cancelEditing,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    deleteSessionImmediate,
    requestProjectDelete,
    confirmDeleteProject,
    loadMoreSessions,
    handleProjectSelect,
    refreshProjects,
    updateSessionSummary,
    collapseSidebar,
    expandSidebar,
    setShowNewProject,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    searchMode,
    setSearchMode,
    conversationResults,
    isSearching,
    searchProgress,
    clearConversationResults: useCallback(() => {
      searchSeqRef.current += 1;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsSearching(false);
      setSearchProgress(null);
      setConversationResults(null);
    }, []),
    setSearchFilter,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
    setShowVersionModal,
  };
}
