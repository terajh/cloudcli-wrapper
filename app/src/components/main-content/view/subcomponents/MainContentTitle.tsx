import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { AppTab, Project, ProjectSession } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';
import { api } from '../../../../utils/api';

type MainContentTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
};

function getTabTitle(activeTab: AppTab, shouldShowTasksTab: boolean, t: (key: string) => string, pluginDisplayName?: string) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  return 'Project';
}

function getSessionTitle(session: ProjectSession): string {
  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.summary as string) || 'New Session';
}

export default function MainContentTitle({
  activeTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
}: MainContentTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [displayedTitle, setDisplayedTitle] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 세션이 바뀌면 편집 상태와 로컬 표시 제목 초기화
  useEffect(() => {
    setIsEditing(false);
    setDisplayedTitle(null);
  }, [selectedSession?.id]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const pluginDisplayName = activeTab.startsWith('plugin:')
    ? plugins.find((p) => p.name === activeTab.replace('plugin:', ''))?.displayName
    : undefined;

  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;

  const startEditing = () => {
    if (!selectedSession) return;
    setEditValue(displayedTitle ?? getSessionTitle(selectedSession));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const saveEditing = async () => {
    if (!selectedSession) {
      cancelEditing();
      return;
    }
    const trimmed = editValue.trim();
    const original = displayedTitle ?? getSessionTitle(selectedSession);
    if (!trimmed || trimmed === original) {
      cancelEditing();
      return;
    }
    try {
      const response = await api.renameSession(
        selectedSession.id as string,
        trimmed,
        selectedSession.__provider,
      );
      if (!response.ok) {
        console.error('[MainContentTitle] Failed to rename session:', response.status);
        cancelEditing();
        return;
      }
      // 즉시 로컬 반영. 사이드바는 다음 refresh 시 동기화됨.
      setDisplayedTitle(trimmed);
      setIsEditing(false);
    } catch (error) {
      console.error('[MainContentTitle] Error renaming session:', error);
      cancelEditing();
    }
  };

  return (
    <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {showSessionIcon && (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <SessionProviderLogo provider={selectedSession?.__provider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {activeTab === 'chat' && selectedSession ? (
          <div className="min-w-0">
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(event) => setEditValue(event.target.value)}
                onBlur={() => void saveEditing()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void saveEditing();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelEditing();
                  }
                }}
                className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-sm font-semibold leading-tight text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <button
                type="button"
                onClick={startEditing}
                title={t('mainContent.clickToRename') || 'Click to rename'}
                className="group -mx-1 flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-white/5"
              >
                <span className="truncate text-sm font-semibold leading-tight text-foreground">
                  {displayedTitle ?? getSessionTitle(selectedSession)}
                </span>
                <Pencil className="h-3 w-3 flex-shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            )}
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-foreground">{t('mainContent.newSession')}</h2>
            <div className="truncate text-xs leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight text-foreground">
              {getTabTitle(activeTab, shouldShowTasksTab, t, pluginDisplayName)}
            </h2>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        )}
      </div>
    </div>
  );
}
