import { useState } from 'react';
import { Check, Clock, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Badge, Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import { formatTimeAgo } from '../../../../utils/dateUtils';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import SidebarItemContextMenu from './SidebarItemContextMenu';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => void;
  t: TFunction;
};

export default function SidebarSessionItem({
  project,
  session,
  selectedSession,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const selectMobileSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.name);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.name, session.id, editingSessionName, session.__provider);
  };

  const requestDeleteSession = () => {
    onDeleteSession(project.name, session.id, sessionView.sessionName, session.__provider);
  };

  return (
    <div className="group relative">
      {sessionView.isActive && (
        <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 transform">
          <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
        </div>
      )}

      <div className="md:hidden">
        <div
          className={cn(
            'p-2 mx-3 my-0.5 rounded-md bg-card border active:scale-[0.98] transition-all duration-150 relative',
            isSelected ? 'bg-primary/5 border-primary/20' : '',
            !isSelected && sessionView.isActive
              ? 'border-green-500/30 bg-green-50/5 dark:bg-green-900/5'
              : 'border-border/30',
          )}
          onClick={selectMobileSession}
        >
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0',
                isSelected ? 'bg-primary/10' : 'bg-muted/50',
              )}
            >
              <SessionProviderLogo provider={session.__provider} className="h-3 w-3" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-foreground">{sessionView.sessionName}</div>
              <div className="mt-0.5 flex items-center gap-1">
                <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {formatTimeAgo(sessionView.sessionTime, currentTime, t)}
                </span>
                {sessionView.messageCount > 0 && (
                  <Badge variant="secondary" className="ml-auto px-1 py-0 text-xs">
                    {sessionView.messageCount}
                  </Badge>
                )}
                <span className="ml-1 opacity-70">
                  <SessionProviderLogo provider={session.__provider} className="h-3 w-3" />
                </span>
              </div>
            </div>

            {!sessionView.isCursorSession && (
              <button
                className="ml-1 flex h-5 w-5 items-center justify-center rounded-md bg-red-50 opacity-70 transition-transform active:scale-95 dark:bg-red-900/20"
                onClick={(event) => {
                  event.stopPropagation();
                  requestDeleteSession();
                }}
              >
                <Trash2 className="h-2.5 w-2.5 text-red-600 dark:text-red-400" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        <Button
          variant="ghost"
          className={cn(
            'w-full justify-start pl-2 pr-1 py-1.5 h-auto font-normal text-left rounded-md',
            'hover:bg-accent/40 transition-colors duration-150',
            isSelected && 'bg-white/[0.06] text-foreground hover:bg-white/[0.09]',
          )}
          onClick={() => onSessionSelect(session, project.name)}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <div className="flex w-full min-w-0 items-center gap-2">
            <span
              className={cn(
                'h-1 w-1 flex-shrink-0 rounded-full',
                sessionView.isActive ? 'bg-emerald-400' : isSelected ? 'bg-foreground/40' : 'bg-transparent',
              )}
            />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[13px] leading-tight',
                isSelected ? 'font-medium text-foreground' : 'text-foreground/85',
              )}
            >
              {sessionView.sessionName}
            </span>
            {/*
              Right-edge meta cluster:
                - provider logo (claude / codex / cursor / gemini)
                - relative timestamp ("10시간 전") flush to the right
              On hover the cluster becomes invisible and a same-position
              trash button takes over (rendered as a sibling absolute below).
            */}
            <span className="flex flex-shrink-0 items-center gap-1.5 pr-1 transition-opacity duration-150 group-hover:opacity-0">
              <SessionProviderLogo
                provider={session.__provider}
                className="h-3 w-3 opacity-70"
              />
              <span className="text-[10px] tabular-nums text-muted-foreground/80">
                {formatTimeAgo(sessionView.sessionTime, currentTime, t)}
              </span>
            </span>
          </div>
        </Button>

        {editingSession === session.id && (
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 transform items-center gap-1">
            <input
              type="text"
              value={editingSessionName}
              onChange={(event) => onEditingSessionNameChange(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  saveEditedSession();
                } else if (event.key === 'Escape') {
                  onCancelEditingSession();
                }
              }}
              onClick={(event) => event.stopPropagation()}
              className="w-32 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
            <button
              className="flex h-6 w-6 items-center justify-center rounded bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40"
              onClick={(event) => {
                event.stopPropagation();
                saveEditedSession();
              }}
              title={t('tooltips.save')}
            >
              <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
            </button>
            <button
              className="flex h-6 w-6 items-center justify-center rounded bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40"
              onClick={(event) => {
                event.stopPropagation();
                onCancelEditingSession();
              }}
              title={t('tooltips.cancel')}
            >
              <X className="h-3 w-3 text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        )}

        {editingSession !== session.id && !sessionView.isCursorSession && (
          <div className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 transform items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <button
              className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-red-500/15"
              onClick={(event) => {
                event.stopPropagation();
                requestDeleteSession();
              }}
              title={t('tooltips.deleteSession')}
              aria-label={t('tooltips.deleteSession')}
            >
              <Trash2 className="h-3 w-3 text-red-500" />
            </button>
          </div>
        )}

        {contextMenu && (
          <SidebarItemContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            items={[
              {
                id: 'edit',
                label: t('tooltips.editSessionName'),
                icon: 'edit',
                onClick: () => onStartEditingSession(session.id, sessionView.sessionName),
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}
