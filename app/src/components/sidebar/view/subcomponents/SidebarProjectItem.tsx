import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Edit3, Folder, FolderOpen, Plus, Star, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { MCPServerStatus, SessionWithProvider } from '../../types/types';
import { getTaskIndicatorStatus } from '../../utils/utils';
import TaskIndicator from './TaskIndicator';
import SidebarProjectSessions from './SidebarProjectSessions';
import SidebarItemContextMenu from './SidebarItemContextMenu';

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  isStarred: boolean;
  editingProject: string | null;
  editingName: string;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  onEditingNameChange: (name: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  t: TFunction;
};

const getSessionCountDisplay = (sessions: SessionWithProvider[], hasMoreSessions: boolean): string => {
  const sessionCount = sessions.length;
  if (hasMoreSessions && sessionCount >= 5) {
    return `${sessionCount}+`;
  }

  return `${sessionCount}`;
};

export default function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  isExpanded,
  isDeleting,
  isStarred,
  editingProject,
  editingName,
  sessions,
  initialSessionsLoaded,
  isLoadingSessions,
  currentTime,
  editingSession,
  editingSessionName,
  tasksEnabled,
  mcpServerStatus,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  t,
}: SidebarProjectItemProps) {
  const isSelected = selectedProject?.name === project.name;
  const isEditing = editingProject === project.name;
  const hasMoreSessions = project.sessionMeta?.hasMore === true;
  const sessionCountDisplay = getSessionCountDisplay(sessions, hasMoreSessions);
  const sessionCountLabel = `${sessionCountDisplay} session${sessions.length === 1 ? '' : 's'}`;
  const taskStatus = getTaskIndicatorStatus(project, mcpServerStatus);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const toggleProject = () => onToggleProject(project.name);
  const toggleStarProject = () => onToggleStarProject(project.name);

  const saveProjectName = () => {
    onSaveProjectName(project.name);
  };

  const selectAndToggleProject = () => {
    if (selectedProject?.name !== project.name) {
      onProjectSelect(project);
    }

    toggleProject();
  };

  return (
    <div
      className={cn(
        // mt-2 → 데스크톱 사이드바에서 프로젝트 아이템 사이의 호흡감을 위한 상단 마진.
        'md:space-y-1 md:mt-2 md:first:mt-0',
        isDeleting && 'opacity-50 pointer-events-none',
      )}
    >
      <div className="md:group group">
        <div className="md:hidden">
          <div
            className={cn(
              'p-3 mx-3 my-1 rounded-lg bg-card border border-border/50 active:scale-[0.98] transition-all duration-150',
              isSelected && 'bg-primary/5 border-primary/20',
              isStarred &&
                !isSelected &&
                'bg-yellow-50/50 dark:bg-yellow-900/5 border-yellow-200/30 dark:border-yellow-800/30',
            )}
            onClick={toggleProject}
          >
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div
                  className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                    isExpanded ? 'bg-primary/10' : 'bg-muted',
                  )}
                >
                  {isExpanded ? (
                    <FolderOpen className="h-4 w-4 text-primary" />
                  ) : (
                    <Folder className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(event) => onEditingNameChange(event.target.value)}
                      className="w-full rounded-lg border-2 border-primary/40 bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-all duration-200 focus:border-primary focus:shadow-md focus:outline-none"
                      placeholder={t('projects.projectNamePlaceholder')}
                      autoFocus
                      autoComplete="off"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          saveProjectName();
                        }

                        if (event.key === 'Escape') {
                          onCancelEditingProject();
                        }
                      }}
                      style={{
                        fontSize: '16px',
                        WebkitAppearance: 'none',
                        borderRadius: '8px',
                      }}
                    />
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 items-center justify-between">
                        <h3 className="truncate text-sm font-medium text-foreground">{project.displayName}</h3>
                        {tasksEnabled && (
                          <TaskIndicator
                            status={taskStatus}
                            size="xs"
                            className="ml-2 hidden flex-shrink-0 md:inline-flex"
                          />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{sessionCountLabel}</p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {isEditing ? (
                  <>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-green-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        saveProjectName();
                      }}
                    >
                      <Check className="h-4 w-4 text-white" />
                    </button>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-gray-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelEditingProject();
                      }}
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 transition-all duration-150 border',
                        isStarred
                          ? 'bg-yellow-500/10 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800'
                          : 'bg-gray-500/10 dark:bg-gray-900/30 border-gray-200 dark:border-gray-800',
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleStarProject();
                      }}
                      title={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
                    >
                      <Star
                        className={cn(
                          'w-4 h-4 transition-colors',
                          isStarred
                            ? 'text-yellow-600 dark:text-yellow-400 fill-current'
                            : 'text-gray-600 dark:text-gray-400',
                        )}
                      />
                    </button>

                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-500/10 active:scale-90 dark:border-red-800 dark:bg-red-900/30"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteProject(project);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                    </button>

                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 active:scale-90 dark:border-primary/30 dark:bg-primary/20"
                      onClick={(event) => {
                        event.stopPropagation();
                        onStartEditingProject(project);
                      }}
                    >
                      <Edit3 className="h-4 w-4 text-primary" />
                    </button>

                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/30">
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/*
          데스크톱 행: 프로젝트 토글 버튼과 + 버튼은 nested interactive(invalid HTML)을
          피하기 위해 형제 엘리먼트로 분리한다. 상단에 sticky로 고정.
        */}
        <div
          // 사이드바 배경이 회색 톤이므로 sticky 헤더의 배경도 같은 톤으로
          // 맞춰야 한다. backdrop-blur 는 WKWebView 에서 inline backgroundColor
          // 페인팅을 깨뜨리므로 사용 금지.
          className={cn(
            'hidden md:flex w-full items-stretch',
            'md:sticky md:top-0 md:z-10',
          )}
          style={{ backgroundColor: 'hsl(var(--sidebar-background))' }}
        >
        <Button
          variant="ghost"
          className={cn(
            'hidden md:flex flex-1 min-w-0 justify-between px-2 py-1.5 h-auto font-normal rounded-md',
            'hover:bg-accent/40 transition-colors duration-150',
            isSelected && 'bg-white/[0.06] text-foreground hover:bg-white/[0.09]',
            isStarred &&
              !isSelected &&
              'bg-yellow-50/40 dark:bg-yellow-900/[0.06] hover:bg-yellow-100/40 dark:hover:bg-yellow-900/[0.10]',
          )}
          onClick={selectAndToggleProject}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <div className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center text-muted-foreground/70">
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </div>
            {isExpanded ? (
              <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-primary/85" />
            ) : (
              <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/80" />
            )}
            {isEditing ? (
              <div className="min-w-0 flex-1 text-left">
                <div className="space-y-1">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(event) => onEditingNameChange(event.target.value)}
                    className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
                    placeholder={t('projects.projectNamePlaceholder')}
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        saveProjectName();
                      }
                      if (event.key === 'Escape') {
                        onCancelEditingProject();
                      }
                    }}
                  />
                  <div className="truncate text-xs text-muted-foreground" title={project.fullPath}>
                    {project.fullPath}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <span
                  className={cn(
                    'min-w-0 flex-shrink truncate text-left text-[13px] leading-tight',
                    isSelected ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
                  )}
                  title={project.displayName}
                >
                  {project.displayName}
                </span>
                {(() => {
                  const fullPath = project.fullPath || project.path || '';
                  const parts = fullPath.split('/').filter(Boolean);
                  const folderName = parts[parts.length - 1] || '';
                  if (!folderName || folderName === project.displayName) return null;
                  return (
                    <span
                      className="min-w-0 flex-shrink truncate text-[10.5px] text-muted-foreground/65"
                      title={project.fullPath}
                    >
                      {folderName}
                    </span>
                  );
                })()}
                {/* ml-auto 만 두고, 실제 우측 끝 슬롯(세션 카운트 ↔ + 버튼)은
                    Button 바깥 형제 엘리먼트에서 그린다. 여기는 단순히 남는
                    공간을 모두 좌측 텍스트에 양보하기 위한 spacer 이다. */}
                <span className="ml-auto" aria-hidden="true" />
              </>
            )}
          </div>

        </Button>
        {!isEditing && (
          // 우측 끝 트레일링 슬롯: 기본은 세션 카운트가 우측 끝에 보이고,
          // 마우스 호버 시 카운트가 좌측으로 슬라이드+페이드 아웃되며 동시에
          // + (새 세션) 버튼이 페이드 인 한다. 두 엘리먼트는 동일한 우측 끝
          // 위치에 절대 배치되어 자리 교체 효과를 만든다.
          <div className="relative hidden md:flex h-auto w-7 flex-shrink-0 items-center justify-end pr-1">
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-y-0 right-1 flex items-center text-[10px] tabular-nums text-muted-foreground/60',
                'transition-all duration-200 ease-out',
                'group-hover:-translate-x-2 group-hover:opacity-0',
              )}
            >
              {sessionCountDisplay}
            </span>
            <button
              type="button"
              className={cn(
                'absolute inset-y-0 right-0 flex w-7 items-center justify-center rounded',
                'opacity-0 transition-opacity duration-200 ease-out',
                'group-hover:opacity-100 hover:bg-white/10',
              )}
              onClick={(event) => {
                event.stopPropagation();
                onProjectSelect(project);
                onNewSession(project);
              }}
              title={t('sessions.newSession') || '새 세션'}
              aria-label={t('sessions.newSession') || '새 세션'}
            >
              <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        )}
        {isEditing && (
          <>
            <button
              type="button"
              className="hidden md:flex h-auto w-7 flex-shrink-0 items-center justify-center rounded text-green-600 transition-colors hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-900/20"
              onClick={(event) => {
                event.stopPropagation();
                saveProjectName();
              }}
              aria-label={t('tooltips.save') || 'Save'}
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="hidden md:flex h-auto w-7 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:hover:bg-gray-800"
              onClick={(event) => {
                event.stopPropagation();
                onCancelEditingProject();
              }}
              aria-label={t('tooltips.cancel') || 'Cancel'}
            >
              <X className="h-3 w-3" />
            </button>
          </>
        )}
        </div>
      </div>

      <SidebarProjectSessions
        project={project}
        isExpanded={isExpanded}
        sessions={sessions}
        selectedSession={selectedSession}
        initialSessionsLoaded={initialSessionsLoaded}
        isLoadingSessions={isLoadingSessions}
        currentTime={currentTime}
        editingSession={editingSession}
        editingSessionName={editingSessionName}
        onEditingSessionNameChange={onEditingSessionNameChange}
        onStartEditingSession={onStartEditingSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        onProjectSelect={onProjectSelect}
        onSessionSelect={onSessionSelect}
        onDeleteSession={onDeleteSession}
        onLoadMoreSessions={onLoadMoreSessions}
        onNewSession={onNewSession}
        t={t}
      />

      {contextMenu && (
        <SidebarItemContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              id: 'favorite',
              label: isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites'),
              icon: isStarred ? 'star-off' : 'star',
              onClick: toggleStarProject,
            },
            {
              id: 'edit',
              label: t('tooltips.renameProject'),
              icon: 'edit',
              onClick: () => onStartEditingProject(project),
            },
            {
              id: 'delete',
              label: t('tooltips.deleteProject') || '프로젝트 삭제',
              icon: 'trash',
              onClick: () => onDeleteProject(project),
            },
          ]}
        />
      )}
    </div>
  );
}
