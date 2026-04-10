import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { PendingPermissionRequest } from '../types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import type { SessionStore, NormalizedMessage } from '../../../stores/useSessionStore';
import type { SessionLifecyclePhase } from '../view/ChatInterface';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
  tempId?: string | null;
};

type LatestChatMessage = {
  type?: string;
  kind?: string;
  data?: any;
  message?: any;
  delta?: string;
  sessionId?: string;
  session_id?: string;
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  error?: string;
  tool?: any;
  toolId?: string;
  result?: any;
  exitCode?: number;
  isProcessing?: boolean;
  actualSessionId?: string;
  event?: string;
  status?: any;
  isNewSession?: boolean;
  resultText?: string;
  isError?: boolean;
  success?: boolean;
  reason?: string;
  provider?: string;
  content?: string;
  text?: string;
  tokens?: number;
  canInterrupt?: boolean;
  tokenBudget?: unknown;
  newSessionId?: string;
  aborted?: boolean;
  [key: string]: any;
};

interface UseChatRealtimeHandlersArgs {
  latestMessage: LatestChatMessage | null;
  provider: SessionProvider;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: (status: { text: string; tokens: number; can_interrupt: boolean } | null) => void;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  sessionLifecyclePhaseRef: MutableRefObject<SessionLifecyclePhase>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  accumulatedStreamRef: MutableRefObject<string>;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (sessionId: string) => void;
  onWebSocketReconnect?: () => void;
  sessionStore: SessionStore;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useChatRealtimeHandlers({
  latestMessage,
  provider,
  selectedProject,
  selectedSession,
  currentSessionId,
  setCurrentSessionId,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setTokenBudget,
  setPendingPermissionRequests,
  pendingViewSessionRef,
  sessionLifecyclePhaseRef,
  streamBufferRef,
  streamTimerRef,
  accumulatedStreamRef,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  onReplaceTemporarySession,
  onNavigateToSession,
  onWebSocketReconnect,
  sessionStore,
}: UseChatRealtimeHandlersArgs) {
  const lastProcessedMessageRef = useRef<LatestChatMessage | null>(null);

  useEffect(() => {
    if (!latestMessage) return;
    if (lastProcessedMessageRef.current === latestMessage) return;
    lastProcessedMessageRef.current = latestMessage;

    const activeViewSessionId =
      selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || null;

    /* ---------------------------------------------------------------- */
    /*  Legacy messages (no `kind` field) — handle and return           */
    /* ---------------------------------------------------------------- */

    const msg = latestMessage as any;

    if (!msg.kind) {
      const messageType = String(msg.type || '');

      switch (messageType) {
        case 'websocket-reconnected':
          onWebSocketReconnect?.();
          return;

        case 'pending-permissions-response': {
          const permSessionId = msg.sessionId;
          const isCurrentPermSession =
            permSessionId === currentSessionId || (selectedSession && permSessionId === selectedSession.id);
          if (permSessionId && !isCurrentPermSession) return;
          setPendingPermissionRequests(msg.data || []);
          return;
        }

        case 'session-status': {
          const statusSessionId = msg.sessionId;
          if (!statusSessionId) return;

          const status = msg.status;
          if (status) {
            const statusInfo = {
              text: status.text || 'Working...',
              tokens: status.tokens || 0,
              can_interrupt: status.can_interrupt !== undefined ? status.can_interrupt : true,
            };
            setClaudeStatus(statusInfo);
            setIsLoading(true);
            setCanAbortSession(statusInfo.can_interrupt);
            return;
          }

          // Legacy isProcessing format from check-session-status
          const isCurrentSession =
            statusSessionId === currentSessionId || (selectedSession && statusSessionId === selectedSession.id);

          if (msg.isProcessing) {
            onSessionProcessing?.(statusSessionId);
            if (isCurrentSession) { setIsLoading(true); setCanAbortSession(true); }
            return;
          }
          onSessionInactive?.(statusSessionId);
          onSessionNotProcessing?.(statusSessionId);
          if (isCurrentSession) {
            setIsLoading(false);
            setCanAbortSession(false);
            setClaudeStatus(null);
          }
          return;
        }

        default:
          // Unknown legacy message type — ignore
          return;
      }
    }

    /* ---------------------------------------------------------------- */
    /*  NormalizedMessage handling (has `kind` field)                    */
    /* ---------------------------------------------------------------- */

    const sid = msg.sessionId || activeViewSessionId;

    // --- Streaming: buffer for performance ---
    if (msg.kind === 'stream_delta') {
      // First delta after submission means we're live; drop the transient
      // pre-stream phases.
      if (
        sessionLifecyclePhaseRef.current === 'submitting' ||
        sessionLifecyclePhaseRef.current === 'awaiting_session_id' ||
        sessionLifecyclePhaseRef.current === 'session_acquired'
      ) {
        sessionLifecyclePhaseRef.current = 'live';
      }
      const text = msg.content || '';
      if (!text) return;
      streamBufferRef.current += text;
      accumulatedStreamRef.current += text;
      if (!streamTimerRef.current) {
        // ~30fps flush cadence — smooth token-by-token feel without spamming
        // React. Combined with T2 streaming-tail isolation, only the single
        // tail MessageComponent re-renders per tick, so 30Hz stays cheap.
        streamTimerRef.current = window.setTimeout(() => {
          streamTimerRef.current = null;
          if (sid) {
            sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
          }
        }, 33);
      }
      // Also route to store for non-active sessions
      if (sid && sid !== activeViewSessionId) {
        sessionStore.appendRealtime(sid, msg as NormalizedMessage);
      }
      return;
    }

    if (msg.kind === 'stream_end') {
      if (streamTimerRef.current) {
        clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      if (sid) {
        if (accumulatedStreamRef.current) {
          sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
        }
        sessionStore.finalizeStreaming(sid);
      }
      accumulatedStreamRef.current = '';
      streamBufferRef.current = '';
      return;
    }

    // --- All other messages: route to store ---
    if (sid) {
      sessionStore.appendRealtime(sid, msg as NormalizedMessage);
    }

    // --- UI side effects for specific kinds ---
    switch (msg.kind) {
      case 'session_created': {
        const newSessionId = msg.newSessionId;
        if (!newSessionId) break;

        if (!currentSessionId || currentSessionId.startsWith('new-session-')) {
          sessionStorage.setItem('pendingSessionId', newSessionId);

          // Promote the temp slot in the store so realtime messages that
          // arrived under the `new-session-<ts>` id survive the id swap.
          // We do this BEFORE updating currentSessionId / pendingViewSessionRef
          // so peekSlot on the real id inside the session-loading guards sees
          // the promoted slot immediately.
          try {
            const tempId =
              (currentSessionId && currentSessionId.startsWith('new-session-')
                ? currentSessionId
                : pendingViewSessionRef.current?.tempId) || null;
            if (tempId) {
              sessionStore.promoteSession(tempId, newSessionId);
            }
          } catch (error) {
            console.error('[ChatRealtime] promoteSession failed in session_created:', error);
          }

          if (pendingViewSessionRef.current) {
            pendingViewSessionRef.current = {
              ...pendingViewSessionRef.current,
              sessionId: newSessionId,
            };
          }
          setCurrentSessionId(newSessionId);
          // Advance the lifecycle phase so the main session-loading effect's
          // one-shot guard passes through without refetching.
          sessionLifecyclePhaseRef.current = 'session_acquired';
          onReplaceTemporarySession?.(newSessionId);
          setPendingPermissionRequests((prev) =>
            prev.map((r) => (r.sessionId ? r : { ...r, sessionId: newSessionId })),
          );

          // Optimistic sidebar: the composer already injected a row with the
          // temp id at submit time so the user saw their chat immediately.
          // Here we rename that row's id to the real one in place — no
          // remove/re-insert, so the sidebar never flickers.
          //
          // The belt-and-suspenders `sweepStaleOptimisticTempIds` call runs
          // regardless of whether promote matched the exact temp id: it
          // removes any leftover `new-session-*` entries under the current
          // project so we can never end up with BOTH a temp row AND the
          // promoted/inserted real row in the sidebar at the same time
          // (the "duplicate session in sidebar" bug).
          //
          // Fallback inject (when promote found no matching entry) is
          // intentionally scoped to the case where we have a project name
          // — otherwise we trust the backend's `projects_updated` to paint
          // the row authoritatively within a moment.
          try {
            const tempIdToPromote =
              (currentSessionId && currentSessionId.startsWith('new-session-')
                ? currentSessionId
                : pendingViewSessionRef.current?.tempId) || null;

            const promoted = Boolean(
              tempIdToPromote &&
                typeof window !== 'undefined' &&
                window.promoteOptimisticSession &&
                window.promoteOptimisticSession(tempIdToPromote, newSessionId),
            );

            if (selectedProject?.name && typeof window !== 'undefined' && window.sweepStaleOptimisticTempIds) {
              window.sweepStaleOptimisticTempIds(selectedProject.name);
            }

            if (!promoted && selectedProject?.name && typeof window !== 'undefined' && window.injectOptimisticSession) {
              const slot = sessionStore.getSessionSlot(newSessionId);
              const lastUserText = slot?.realtimeMessages
                .filter((m) => m.kind === 'text' && m.role === 'user' && typeof m.content === 'string')
                .map((m) => m.content as string)
                .pop();
              const summaryRaw = (lastUserText || '').replace(/\s+/g, ' ').trim();
              const summary = summaryRaw.length > 80 ? `${summaryRaw.slice(0, 77)}...` : summaryRaw;
              window.injectOptimisticSession(selectedProject.name, {
                id: newSessionId,
                summary: summary || undefined,
                lastActivity: new Date().toISOString(),
              }, provider);
            }
          } catch (error) {
            console.error('[ChatRealtime] optimistic session sync failed:', error);
          }

          // Only navigate to the new session when the user is actually waiting
          // on this chat (i.e. we had no currentSessionId, or we were viewing
          // a `new-session-*` placeholder that this event is promoting). When
          // multiple sessions run in parallel and the user is looking at one
          // of them, a session_created event for a sibling session MUST NOT
          // rip the UI over to that sibling — the old unconditional call made
          // any concurrent response steal focus away from whatever the user
          // was reading.
          onNavigateToSession?.(newSessionId);
        }
        break;
      }

      case 'complete': {
        // Flush any remaining streaming state
        if (streamTimerRef.current) {
          clearTimeout(streamTimerRef.current);
          streamTimerRef.current = null;
        }
        if (sid && accumulatedStreamRef.current) {
          sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
          sessionStore.finalizeStreaming(sid);
        }
        accumulatedStreamRef.current = '';
        streamBufferRef.current = '';

        // Defensive placeholder cleanup: if the run finished without ever
        // emitting a stream_delta (e.g. error case or tool-only response),
        // the optimistic assistant placeholder is still in realtimeMessages.
        // Strip it so the UI doesn't get stuck on "Receiving…".
        if (sid) {
          sessionStore.clearPlaceholders(sid);
        }

        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        setPendingPermissionRequests([]);
        onSessionInactive?.(sid);
        onSessionNotProcessing?.(sid);

        // Mark lifecycle complete, then return to idle on the next tick so
        // subsequent submissions start from a clean state.
        sessionLifecyclePhaseRef.current = 'complete';
        setTimeout(() => {
          if (sessionLifecyclePhaseRef.current === 'complete') {
            sessionLifecyclePhaseRef.current = 'idle';
          }
        }, 0);

        // Handle aborted case
        if (msg.aborted) {
          // Abort was requested — the complete event confirms it
          // No special UI action needed beyond clearing loading state above
          // The backend already sent any abort-related messages
          break;
        }

        // Clear pending session
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        if (pendingSessionId && !currentSessionId && msg.exitCode === 0) {
          const actualId = msg.actualSessionId || pendingSessionId;
          setCurrentSessionId(actualId);
          if (msg.actualSessionId) {
            onNavigateToSession?.(actualId);
          }
          sessionStorage.removeItem('pendingSessionId');
          // Fire refreshProjects immediately — there is no benefit to the
          // old 500 ms delay now that we've already inserted an optimistic
          // row at `session_created` and the store guards prevent refetch
          // races from wiping the chat.
          window.refreshProjects?.();
        }
        break;
      }

      case 'error': {
        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        onSessionInactive?.(sid);
        onSessionNotProcessing?.(sid);
        sessionLifecyclePhaseRef.current = 'idle';
        break;
      }

      case 'permission_request': {
        if (!msg.requestId) break;
        setPendingPermissionRequests((prev) => {
          if (prev.some((r: PendingPermissionRequest) => r.requestId === msg.requestId)) return prev;
          return [...prev, {
            requestId: msg.requestId,
            toolName: msg.toolName || 'UnknownTool',
            input: msg.input,
            context: msg.context,
            sessionId: sid || null,
            receivedAt: new Date(),
          }];
        });
        setIsLoading(true);
        setCanAbortSession(true);
        setClaudeStatus({ text: 'Waiting for permission', tokens: 0, can_interrupt: true });
        break;
      }

      case 'permission_cancelled': {
        if (msg.requestId) {
          setPendingPermissionRequests((prev) => prev.filter((r: PendingPermissionRequest) => r.requestId !== msg.requestId));
        }
        break;
      }

      case 'status': {
        if (msg.text === 'token_budget' && msg.tokenBudget) {
          setTokenBudget(msg.tokenBudget as Record<string, unknown>);
        } else if (msg.text) {
          setClaudeStatus({
            text: msg.text,
            tokens: msg.tokens || 0,
            can_interrupt: msg.canInterrupt !== undefined ? msg.canInterrupt : true,
          });
          setIsLoading(true);
          setCanAbortSession(msg.canInterrupt !== false);
        }
        break;
      }

      // text, tool_use, tool_result, thinking, interactive_prompt, task_notification
      // → already routed to store above, no UI side effects needed
      default:
        break;
    }
  }, [
    latestMessage,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setTokenBudget,
    setPendingPermissionRequests,
    pendingViewSessionRef,
    streamBufferRef,
    streamTimerRef,
    accumulatedStreamRef,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onReplaceTemporarySession,
    onNavigateToSession,
    onWebSocketReconnect,
    sessionStore,
  ]);
}
