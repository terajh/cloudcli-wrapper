import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { ChatMessage } from '../../types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import { getIntrinsicMessageKey } from '../../utils/messageKeys';
import MessageComponent from './MessageComponent';
import ProviderSelectionEmptyState from './ProviderSelectionEmptyState';
// AssistantThinkingIndicator removed in T1: the optimistic placeholder in the
// message list (MessageComponent isPlaceholder branch) replaces this.

/** A group of consecutive tool-use messages that should be collapsed together */
type ToolGroup = { type: 'tool-group'; messages: ChatMessage[]; startIndex: number };
/** A single non-tool message */
type SingleMessage = { type: 'single'; message: ChatMessage; index: number };
type RenderItem = ToolGroup | SingleMessage;

/** Minimum consecutive tool-use messages to form a collapsed group */
const MIN_GROUP_SIZE = 2;

function ToolGroupCollapsible({
  group,
  getMessageKey,
  commonProps,
  allMessages,
}: {
  group: ToolGroup;
  getMessageKey: (m: ChatMessage) => string;
  commonProps: Record<string, unknown>;
  allMessages: ChatMessage[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { messages, startIndex } = group;
  const count = messages.length;
  const toolNames = [...new Set(messages.map((m) => m.toolName || 'tool'))];
  const label = toolNames.length === 1
    ? `${count} ${toolNames[0]} calls`
    : `${count} tool calls`;

  return (
    <div className="group/tool-group relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full cursor-pointer select-none items-center gap-1.5 rounded py-1 text-left text-xs text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <svg
          className={`h-3 w-3 flex-shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">{label}</span>
      </button>

      {isOpen && (
        <div className="mt-1 space-y-2 border-l-2 border-gray-300 pl-3 dark:border-gray-600">
          {messages.map((message, i) => {
            const globalIndex = startIndex + i;
            const prevMessage = globalIndex > 0 ? allMessages[globalIndex - 1] : null;
            return (
              <MessageComponent
                key={getMessageKey(message)}
                message={message}
                prevMessage={prevMessage}
                {...(commonProps as any)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ChatMessagesPaneProps {
  scrollContainerRef: RefObject<HTMLDivElement>;
  onWheel: () => void;
  onTouchMove: () => void;
  isLoadingSessionMessages: boolean;
  chatMessages: ChatMessage[];
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  setProvider: (provider: SessionProvider) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  cursorModel: string;
  setCursorModel: (model: string) => void;
  codexModel: string;
  setCodexModel: (model: string) => void;
  geminiModel: string;
  setGeminiModel: (model: string) => void;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: Dispatch<SetStateAction<string>>;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: boolean;
  totalMessages: number;
  sessionMessagesCount: number;
  visibleMessageCount: number;
  visibleMessages: ChatMessage[];
  tailChatMessage: ChatMessage | null;
  loadEarlierMessages: () => void;
  loadAllMessages: () => void;
  allMessagesLoaded: boolean;
  isLoadingAllMessages: boolean;
  loadAllJustFinished: boolean;
  showLoadAllOverlay: boolean;
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject: Project;
  isLoading: boolean;
  isUserScrolledUp?: boolean;
  scrollToBottom?: () => void;
}

export default function ChatMessagesPane({
  scrollContainerRef,
  onWheel,
  onTouchMove,
  isLoadingSessionMessages,
  chatMessages,
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  claudeModel,
  setClaudeModel,
  cursorModel,
  setCursorModel,
  codexModel,
  setCodexModel,
  geminiModel,
  setGeminiModel,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
  isLoadingMoreMessages,
  hasMoreMessages,
  totalMessages,
  sessionMessagesCount,
  visibleMessageCount,
  visibleMessages,
  tailChatMessage,
  loadEarlierMessages,
  loadAllMessages,
  allMessagesLoaded,
  isLoadingAllMessages,
  loadAllJustFinished,
  showLoadAllOverlay,
  createDiff,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  autoExpandTools,
  showRawParameters,
  showThinking,
  selectedProject,
  isLoading,
  isUserScrolledUp,
  scrollToBottom,
}: ChatMessagesPaneProps) {
  const { t } = useTranslation('chat');
  const messageKeyMapRef = useRef<WeakMap<ChatMessage, string>>(new WeakMap());
  const allocatedKeysRef = useRef<Set<string>>(new Set());
  const generatedMessageKeyCounterRef = useRef(0);

  // Keep keys stable across prepends so existing MessageComponent instances retain local state.
  const getMessageKey = useCallback((message: ChatMessage) => {
    const existingKey = messageKeyMapRef.current.get(message);
    if (existingKey) {
      return existingKey;
    }

    const intrinsicKey = getIntrinsicMessageKey(message);
    let candidateKey = intrinsicKey;

    if (!candidateKey || allocatedKeysRef.current.has(candidateKey)) {
      do {
        generatedMessageKeyCounterRef.current += 1;
        candidateKey = intrinsicKey
          ? `${intrinsicKey}-${generatedMessageKeyCounterRef.current}`
          : `message-generated-${generatedMessageKeyCounterRef.current}`;
      } while (allocatedKeysRef.current.has(candidateKey));
    }

    allocatedKeysRef.current.add(candidateKey);
    messageKeyMapRef.current.set(message, candidateKey);
    return candidateKey;
  }, []);

  // Defer the loading spinner so quick fetches (<200ms) don't flash a spinner.
  const [showLoadingSpinner, setShowLoadingSpinner] = useState(false);
  useEffect(() => {
    if (!isLoadingSessionMessages) {
      setShowLoadingSpinner(false);
      return;
    }
    const timer = setTimeout(() => setShowLoadingSpinner(true), 200);
    return () => clearTimeout(timer);
  }, [isLoadingSessionMessages]);

  return (
    <div
      ref={scrollContainerRef}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      className="chat-scroll-container relative flex-1 overflow-y-auto overflow-x-hidden"
    >
      <div className="mx-auto w-full max-w-4xl space-y-3 px-3 py-3 sm:space-y-4 sm:p-4">
      {isLoadingSessionMessages && chatMessages.length === 0 ? (
        showLoadingSpinner ? (
          <div className="mt-8 text-center text-gray-500 dark:text-gray-400">
            <div className="flex items-center justify-center space-x-2">
              <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-400" />
              <p>{t('session.loading.sessionMessages')}</p>
            </div>
          </div>
        ) : null
      ) : chatMessages.length === 0 ? (
        <ProviderSelectionEmptyState
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={setProvider}
          textareaRef={textareaRef}
          claudeModel={claudeModel}
          setClaudeModel={setClaudeModel}
          cursorModel={cursorModel}
          setCursorModel={setCursorModel}
          codexModel={codexModel}
          setCodexModel={setCodexModel}
          geminiModel={geminiModel}
          setGeminiModel={setGeminiModel}
          tasksEnabled={tasksEnabled}
          isTaskMasterInstalled={isTaskMasterInstalled}
          onShowAllTasks={onShowAllTasks}
          setInput={setInput}
        />
      ) : (
        <>
          {(() => {
            // Group consecutive tool-use messages into collapsible groups
            const renderItems: RenderItem[] = [];
            let i = 0;
            while (i < visibleMessages.length) {
              const msg = visibleMessages[i];
              if (msg.isToolUse && !msg.isSubagentContainer) {
                // Collect consecutive tool-use messages
                const groupStart = i;
                const groupMessages: ChatMessage[] = [];
                while (
                  i < visibleMessages.length &&
                  visibleMessages[i].isToolUse &&
                  !visibleMessages[i].isSubagentContainer
                ) {
                  groupMessages.push(visibleMessages[i]);
                  i++;
                }
                if (groupMessages.length >= MIN_GROUP_SIZE) {
                  renderItems.push({ type: 'tool-group', messages: groupMessages, startIndex: groupStart });
                } else {
                  // Not enough to group, render individually
                  groupMessages.forEach((m, j) => {
                    renderItems.push({ type: 'single', message: m, index: groupStart + j });
                  });
                }
              } else {
                renderItems.push({ type: 'single', message: msg, index: i });
                i++;
              }
            }

            const commonProps = {
              createDiff,
              onFileOpen,
              onShowSettings,
              onGrantToolPermission,
              autoExpandTools,
              showRawParameters,
              showThinking,
              selectedProject,
              provider,
            };

            return renderItems.map((item, ri) => {
              if (item.type === 'tool-group') {
                return (
                  <ToolGroupCollapsible
                    key={`tool-group-${item.startIndex}`}
                    group={item}
                    getMessageKey={getMessageKey}
                    commonProps={commonProps}
                    allMessages={visibleMessages}
                  />
                );
              }
              const prevMessage = item.index > 0 ? visibleMessages[item.index - 1] : null;
              return (
                <MessageComponent
                  key={getMessageKey(item.message)}
                  message={item.message}
                  prevMessage={prevMessage}
                  {...commonProps}
                />
              );
            });
          })()}

          {/* D-1 (T2) — Streaming / placeholder tail rendered as an isolated
              MessageComponent with a stable key. Because this slot is the
              only thing that re-renders on every stream_delta notify, the
              1000+ already-mounted siblings above never reconcile during
              streaming. Use previous last message for grouping continuity. */}
          {tailChatMessage && (
            <MessageComponent
              key="__chat_tail__"
              message={tailChatMessage}
              prevMessage={visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1] : null}
              createDiff={createDiff}
              onFileOpen={onFileOpen}
              onShowSettings={onShowSettings}
              onGrantToolPermission={onGrantToolPermission}
              autoExpandTools={autoExpandTools}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              selectedProject={selectedProject}
              provider={provider}
            />
          )}
        </>
      )}

      {/* AssistantThinkingIndicator removed in T1: optimistic placeholder in
          the message list (MessageComponent.isPlaceholder branch) now shows
          immediate "Receiving…" feedback at the exact position where the
          response will land. */}
      </div>

      {/* Floating scroll-to-bottom button — visible when user scrolls up
          during an active streaming response or long conversation. */}
      {isUserScrolledUp && scrollToBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-gray-800/90 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-sm transition-all hover:bg-gray-700/90 dark:border-white/10 dark:bg-gray-900/90 dark:hover:bg-gray-800/90"
          aria-label={t('scroll.toBottom')}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          <span>{isLoading ? t('scroll.newMessages') : t('scroll.toBottom')}</span>
        </button>
      )}
    </div>
  );
}

