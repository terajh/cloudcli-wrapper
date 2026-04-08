import { Filter, Folder, FolderPlus, MessageSquare, Plus, RefreshCw, Search, X, PanelLeftClose, SquarePen } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button, Input } from '../../../../shared/view/ui';
import { IS_PLATFORM } from '../../../../constants/config';
import { cn } from '../../../../lib/utils';

type SearchMode = 'projects' | 'conversations';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projectsCount: number;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onOpenProjectFilter: () => void;
  onCollapseSidebar: () => void;
  onNewSession: () => void;
  t: TFunction;
};

export default function SidebarHeader({
  isPWA,
  isMobile,
  isLoading,
  projectsCount,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onOpenProjectFilter,
  onCollapseSidebar,
  onNewSession,
  t,
}: SidebarHeaderProps) {
  return (
    <div className="flex-shrink-0">
      {/* Desktop header */}
      <div className="hidden px-2.5 pb-2 pt-8 md:block">
        <div className="flex items-center justify-between gap-2">
          {/* 새 스레드 버튼 — 좌측 */}
          <button
            onClick={onNewSession}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
            title="새 스레드"
          >
            <SquarePen className="h-3.5 w-3.5" />
            <span>새 스레드</span>
          </button>

          {/* 우측 액션 버튼들 */}
          <div className="flex flex-shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onRefresh}
              disabled={isRefreshing}
              title={t('tooltips.refresh')}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onCreateProject}
              title={t('tooltips.createProject')}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onOpenProjectFilter}
              title="프로젝트 표시 설정"
            >
              <Filter className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onCollapseSidebar}
              title={t('tooltips.hideSidebar')}
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Desktop divider */}
      <div className="nav-divider hidden md:block" />

      {/* Mobile header */}
      <div
        className="p-3 pb-2 md:hidden"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center justify-between">
          <button
            onClick={onNewSession}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground active:scale-95"
          >
            <SquarePen className="h-3.5 w-3.5" />
            <span>새 스레드</span>
          </button>

          <div className="flex flex-shrink-0 gap-1.5">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 transition-all active:scale-95"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Mobile search */}
        {projectsCount > 0 && !isLoading && (
          <div className="mt-2.5 space-y-2">
            <div className="flex rounded-lg bg-muted/50 p-0.5">
              <button
                onClick={() => onSearchModeChange('projects')}
                aria-pressed={searchMode === 'projects'}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
                  searchMode === 'projects'
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Folder className="h-3 w-3" />
                {t('search.modeProjects')}
              </button>
              <button
                onClick={() => onSearchModeChange('conversations')}
                aria-pressed={searchMode === 'conversations'}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
                  searchMode === 'conversations'
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <MessageSquare className="h-3 w-3" />
                {t('search.modeConversations')}
              </button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                type="text"
                placeholder={searchMode === 'conversations' ? t('search.conversationsPlaceholder') : t('projects.searchPlaceholder')}
                value={searchFilter}
                onChange={(event) => onSearchFilterChange(event.target.value)}
                className="nav-search-input h-10 rounded-xl border-0 pl-10 pr-9 text-sm transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {searchFilter && (
                <button
                  onClick={onClearSearchFilter}
                  aria-label={t('tooltips.clearSearch')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mobile divider */}
      <div className="nav-divider md:hidden" />
    </div>
  );
}
