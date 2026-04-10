import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { cn } from '../../../../lib/utils';
import SidebarSessionItem from './SidebarSessionItem';

// 데스크톱 사이드바에서 한 프로젝트당 기본으로 노출할 세션 수.
// 이 수를 넘어가면 "더보기" 토글이 나타나고, 펼치면 전체가 한 번에 보이며
// 스크롤 없이 그대로 흘러내린다. 10 이었다가 실사용에서 몇 개만 있어도
// 리스트가 길게 늘어지고 더보기 토글이 너무 늦게 나타나 답답하다는 피드백을
// 받고 5로 낮췄다.
const DESKTOP_DEFAULT_VISIBLE_SESSIONS = 5;

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

  // 데스크톱: 기본 10개 노출 → 10개 초과 시 "더보기" 토글로 전체 펼침.
  // 펼친 상태에서도 스크롤 없이 그대로 길게 늘어난다.
  const [showAllSessions, setShowAllSessions] = useState(false);
  const hasOverflow = sessions.length > DESKTOP_DEFAULT_VISIBLE_SESSIONS;
  const visibleDesktopSessions = hasOverflow && !showAllSessions
    ? sessions.slice(0, DESKTOP_DEFAULT_VISIBLE_SESSIONS)
    : sessions;
  const hiddenSessionCount = sessions.length - DESKTOP_DEFAULT_VISIBLE_SESSIONS;

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
            <>
              <div className="space-y-0.5">
                {visibleDesktopSessions.map((session) => (
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

              {hasOverflow && (
                <button
                  type="button"
                  className="hidden md:flex mt-1 w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                  onClick={() => setShowAllSessions((prev) => !prev)}
                >
                  {showAllSessions ? (
                    <>
                      <ChevronUp className="h-3.5 w-3.5" />
                      <span>{t('sessions.collapse', { defaultValue: '접기' })}</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3.5 w-3.5" />
                      <span>
                        {t('sessions.showMore', {
                          defaultValue: `더보기 (${hiddenSessionCount}개)`,
                          count: hiddenSessionCount,
                        })}
                      </span>
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
