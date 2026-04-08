import { Plus } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { cn } from '../../../../lib/utils';
import SidebarSessionItem from './SidebarSessionItem';

type SidebarProjectSessionsProps = {
  project: Project;
  isExpanded: boolean;
  sessions: SessionWithProvider[];
  selectedSession: ProjectSession | null;
  initialSessionsLoaded: boolean;
  isLoadingSessions: boolean;
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
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project) => void;
  t: TFunction;
};

function SessionListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-md p-2">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 h-3 w-3 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${60 + index * 15}%` }} />
              <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export default function SidebarProjectSessions({
  project,
  isExpanded,
  sessions,
  selectedSession,
  initialSessionsLoaded,
  isLoadingSessions,
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
  onLoadMoreSessions,
  onNewSession,
  t,
}: SidebarProjectSessionsProps) {
  const hasSessions = sessions.length > 0;

  // 데스크톱에서 최대 10개까지 보이고 나머지는 박스 내부 스크롤
  // 세션 아이템 1개 높이 ≈ 36px → 10개 = 360px
  const SESSIONS_MAX_HEIGHT_PX = 360;

  // CSS grid-template-rows 0fr → 1fr 트릭으로 부드러운 펼침/접힘.
  // 자식은 항상 마운트 상태로 두고 outer wrapper 의 행 높이만 transition.
  // overflow-hidden 으로 접힌 상태에서 콘텐츠가 새 어 나오지 않게 한다.
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
        isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
      aria-hidden={!isExpanded}
    >
      <div className="overflow-hidden">
        <div className="ml-5 space-y-0.5 pt-0.5">
          <div className="px-3 pb-1 pt-1 md:hidden">
            <button
              className="flex h-8 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
              onClick={() => {
                onProjectSelect(project);
                onNewSession(project);
              }}
            >
              <Plus className="h-3 w-3" />
              {t('sessions.newSession')}
            </button>
          </div>

          {!initialSessionsLoaded ? (
            <SessionListSkeleton />
          ) : !hasSessions && !isLoadingSessions ? (
            <div className="px-3 py-1.5 text-left">
              <p className="text-xs text-muted-foreground/70">{t('sessions.noSessions')}</p>
            </div>
          ) : (
            <div
              className="space-y-0.5 md:overflow-y-auto md:overscroll-contain"
              style={{ maxHeight: `${SESSIONS_MAX_HEIGHT_PX}px` }}
            >
              {sessions.map((session) => (
                <SidebarSessionItem
                  key={session.id}
                  project={project}
                  session={session}
                  selectedSession={selectedSession}
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
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
