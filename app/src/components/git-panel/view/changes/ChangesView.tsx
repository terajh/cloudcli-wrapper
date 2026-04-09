import { ChevronDown, ChevronRight, GitBranch, GitCommit, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConfirmationRequest, FileStatusCode, GitDiffMap, GitStatusResponse, GitWorktreeStatus } from '../../types/types';
import { getAllChangedFiles, hasChangedFiles } from '../../utils/gitPanelUtils';
import CommitComposer from './CommitComposer';
import FileChangeList from './FileChangeList';
import FileStatusLegend from './FileStatusLegend';

type ChangesViewProps = {
  isMobile: boolean;
  projectPath: string;
  gitStatus: GitStatusResponse | null;
  gitDiff: GitDiffMap;
  isLoading: boolean;
  wrapText: boolean;
  isCreatingInitialCommit: boolean;
  onWrapTextChange: (wrapText: boolean) => void;
  onCreateInitialCommit: () => Promise<boolean>;
  onOpenFile: (filePath: string) => Promise<void>;
  onDiscardFile: (filePath: string) => Promise<void>;
  onDeleteFile: (filePath: string) => Promise<void>;
  onCommitChanges: (message: string, files: string[]) => Promise<boolean>;
  onGenerateCommitMessage: (files: string[]) => Promise<string | null>;
  onRequestConfirmation: (request: ConfirmationRequest) => void;
  onExpandedFilesChange: (hasExpandedFiles: boolean) => void;
};

export default function ChangesView({
  isMobile,
  projectPath,
  gitStatus,
  gitDiff,
  isLoading,
  wrapText,
  isCreatingInitialCommit,
  onWrapTextChange,
  onCreateInitialCommit,
  onOpenFile,
  onDiscardFile,
  onDeleteFile,
  onCommitChanges,
  onGenerateCommitMessage,
  onRequestConfirmation,
  onExpandedFilesChange,
}: ChangesViewProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const changedFiles = useMemo(() => getAllChangedFiles(gitStatus), [gitStatus]);
  const hasExpandedFiles = expandedFiles.size > 0;

  useEffect(() => {
    if (!gitStatus || gitStatus.error) {
      setSelectedFiles(new Set());
      return;
    }

    // Remove any selected files that no longer exist in the status
    setSelectedFiles((prev) => {
      const allFiles = new Set(getAllChangedFiles(gitStatus));
      const next = new Set([...prev].filter((f) => allFiles.has(f)));
      return next;
    });
  }, [gitStatus]);

  useEffect(() => {
    onExpandedFilesChange(hasExpandedFiles);
  }, [hasExpandedFiles, onExpandedFilesChange]);

  useEffect(() => {
    return () => {
      onExpandedFilesChange(false);
    };
  }, [onExpandedFilesChange]);

  const toggleFileExpanded = useCallback((filePath: string) => {
    setExpandedFiles((previous) => {
      const next = new Set(previous);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const toggleFileSelected = useCallback((filePath: string) => {
    setSelectedFiles((previous) => {
      const next = new Set(previous);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const requestFileAction = useCallback(
    (filePath: string, status: FileStatusCode) => {
      if (status === 'U') {
        onRequestConfirmation({
          type: 'delete',
          message: `Delete untracked file "${filePath}"? This action cannot be undone.`,
          onConfirm: async () => {
            await onDeleteFile(filePath);
          },
        });
        return;
      }

      onRequestConfirmation({
        type: 'discard',
        message: `Discard all changes to "${filePath}"? This action cannot be undone.`,
        onConfirm: async () => {
          await onDiscardFile(filePath);
        },
      });
    },
    [onDeleteFile, onDiscardFile, onRequestConfirmation],
  );

  const commitSelectedFiles = useCallback(
    (message: string) => {
      return onCommitChanges(message, Array.from(selectedFiles));
    },
    [onCommitChanges, selectedFiles],
  );

  const generateMessageForSelection = useCallback(() => {
    return onGenerateCommitMessage(Array.from(selectedFiles));
  }, [onGenerateCommitMessage, selectedFiles]);

  const unstagedFiles = useMemo(
    () => new Set(changedFiles.filter((f) => !selectedFiles.has(f))),
    [changedFiles, selectedFiles],
  );

  return (
    <>
      <CommitComposer
        isMobile={isMobile}
        projectPath={projectPath}
        selectedFileCount={selectedFiles.size}
        isHidden={hasExpandedFiles}
        onCommit={commitSelectedFiles}
        onGenerateMessage={generateMessageForSelection}
        onRequestConfirmation={onRequestConfirmation}
      />

      {!gitStatus?.error && <FileStatusLegend isMobile={isMobile} />}

      <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-mobile-nav' : ''}`}>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : gitStatus?.hasCommits === false ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
              <GitBranch className="h-7 w-7 text-muted-foreground/50" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-foreground">No commits yet</h3>
            <p className="mb-6 max-w-md text-sm text-muted-foreground">
              This repository doesn&apos;t have any commits yet. Create your first commit to start tracking changes.
            </p>
            <button
              onClick={() => void onCreateInitialCommit()}
              disabled={isCreatingInitialCommit}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreatingInitialCommit ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Creating Initial Commit...</span>
                </>
              ) : (
                <>
                  <GitCommit className="h-4 w-4" />
                  <span>Create Initial Commit</span>
                </>
              )}
            </button>
          </div>
        ) : !gitStatus || !hasChangedFiles(gitStatus) ? (
          <div className="flex h-32 flex-col items-center justify-center text-muted-foreground">
            <GitCommit className="mb-2 h-10 w-10 opacity-40" />
            <p className="text-sm">No changes detected</p>
          </div>
        ) : (
          <div className={isMobile ? 'pb-4' : ''}>
            {/* STAGED section */}
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Staged ({selectedFiles.size})
              </span>
              {selectedFiles.size > 0 && (
                <button
                  onClick={() => setSelectedFiles(new Set())}
                  className="text-xs text-primary transition-colors hover:text-primary/80"
                >
                  Unstage All
                </button>
              )}
            </div>
            {selectedFiles.size === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground italic">No staged files</div>
            ) : (
              <FileChangeList
                gitStatus={gitStatus}
                gitDiff={gitDiff}
                expandedFiles={expandedFiles}
                selectedFiles={selectedFiles}
                isMobile={isMobile}
                wrapText={wrapText}
                filePaths={selectedFiles}
                onToggleSelected={toggleFileSelected}
                onToggleExpanded={toggleFileExpanded}
                onOpenFile={(filePath) => { void onOpenFile(filePath); }}
                onToggleWrapText={() => onWrapTextChange(!wrapText)}
                onRequestFileAction={requestFileAction}
              />
            )}

            {/* CHANGES section */}
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Changes ({unstagedFiles.size})
              </span>
              {unstagedFiles.size > 0 && (
                <button
                  onClick={() => setSelectedFiles(new Set(changedFiles))}
                  className="text-xs text-primary transition-colors hover:text-primary/80"
                >
                  Stage All
                </button>
              )}
            </div>
            {unstagedFiles.size === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground italic">All changes staged</div>
            ) : (
              <FileChangeList
                gitStatus={gitStatus}
                gitDiff={gitDiff}
                expandedFiles={expandedFiles}
                selectedFiles={selectedFiles}
                isMobile={isMobile}
                wrapText={wrapText}
                filePaths={unstagedFiles}
                onToggleSelected={toggleFileSelected}
                onToggleExpanded={toggleFileExpanded}
                onOpenFile={(filePath) => { void onOpenFile(filePath); }}
                onToggleWrapText={() => onWrapTextChange(!wrapText)}
                onRequestFileAction={requestFileAction}
              />
            )}

            {/* WORKTREES — 메인 worktree 외 추가로 등록된 worktree 들의
                변경사항을 그룹별로 표시. read-only 요약(파일 목록만)이며,
                각 worktree 의 staging/commit 은 그 worktree 를 직접 선택해서
                작업해야 한다. */}
            {gitStatus.worktrees && gitStatus.worktrees.length > 0 && (
              <WorktreeGroups worktrees={gitStatus.worktrees} />
            )}
          </div>
        )}
      </div>
    </>
  );
}

// === Worktree group section ================================================

function countWorktreeFiles(wt: GitWorktreeStatus): number {
  return wt.modified.length + wt.added.length + wt.deleted.length + wt.untracked.length;
}

function WorktreeGroups({ worktrees }: { worktrees: GitWorktreeStatus[] }) {
  return (
    <>
      <div className="mt-4 flex items-center gap-1.5 border-y border-border/60 bg-muted/20 px-3 py-1.5">
        <GitBranch className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Worktrees ({worktrees.length})
        </span>
      </div>
      {worktrees.map((wt) => (
        <WorktreeGroup key={wt.path} worktree={wt} />
      ))}
    </>
  );
}

function WorktreeGroup({ worktree }: { worktree: GitWorktreeStatus }) {
  const fileCount = countWorktreeFiles(worktree);
  const [isExpanded, setIsExpanded] = useState(fileCount > 0);

  return (
    <div className="border-b border-border/40">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left transition-colors hover:bg-muted/30"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-xs font-medium text-foreground" title={worktree.path}>
          {worktree.name}
        </span>
        {worktree.branch && (
          <span className="truncate text-[10px] text-muted-foreground/70">({worktree.branch})</span>
        )}
        <span className="ml-auto flex-shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {fileCount}
        </span>
      </button>
      {isExpanded && (
        <div className="bg-muted/10 px-3 py-1.5">
          {fileCount === 0 ? (
            <div className="text-[11px] text-muted-foreground/60 italic">변경사항 없음</div>
          ) : (
            <ul className="space-y-0.5 text-[11px]">
              {worktree.modified.map((f) => (
                <WorktreeFileLine key={`m-${f}`} status="M" file={f} />
              ))}
              {worktree.added.map((f) => (
                <WorktreeFileLine key={`a-${f}`} status="A" file={f} />
              ))}
              {worktree.deleted.map((f) => (
                <WorktreeFileLine key={`d-${f}`} status="D" file={f} />
              ))}
              {worktree.untracked.map((f) => (
                <WorktreeFileLine key={`u-${f}`} status="U" file={f} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function WorktreeFileLine({ status, file }: { status: 'M' | 'A' | 'D' | 'U'; file: string }) {
  const colorMap: Record<typeof status, string> = {
    M: 'text-amber-500',
    A: 'text-green-500',
    D: 'text-red-500',
    U: 'text-muted-foreground',
  };
  return (
    <li className="flex items-center gap-2">
      <span className={`w-3 flex-shrink-0 font-mono ${colorMap[status]}`}>{status}</span>
      <span className="truncate text-foreground/80" title={file}>
        {file}
      </span>
    </li>
  );
}
