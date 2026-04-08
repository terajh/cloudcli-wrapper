/**
 * Session-keyed message store.
 *
 * Holds per-session state in a Map keyed by sessionId.
 * Session switch = change activeSessionId pointer. No clearing. Old data stays.
 * WebSocket handler = store.appendRealtime(msg.sessionId, msg). One line.
 * No localStorage for messages. Backend JSONL is the source of truth.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { SessionProvider } from '../types/app';
import { authenticatedFetch } from '../utils/api';

// ─── NormalizedMessage (mirrors server/adapters/types.js) ────────────────────

export type MessageKind =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'stream_delta'
  | 'stream_end'
  | 'error'
  | 'complete'
  | 'status'
  | 'permission_request'
  | 'permission_cancelled'
  | 'session_created'
  | 'interactive_prompt'
  | 'task_notification';

export interface NormalizedMessage {
  id: string;
  sessionId: string;
  timestamp: string;
  provider: SessionProvider;
  kind: MessageKind;

  // kind-specific fields (flat for simplicity)
  role?: 'user' | 'assistant';
  content?: string;
  images?: string[];
  toolName?: string;
  toolInput?: unknown;
  toolId?: string;
  toolResult?: { content: string; isError: boolean; toolUseResult?: unknown } | null;
  isError?: boolean;
  text?: string;
  tokens?: number;
  canInterrupt?: boolean;
  tokenBudget?: unknown;
  requestId?: string;
  input?: unknown;
  context?: unknown;
  newSessionId?: string;
  status?: string;
  summary?: string;
  exitCode?: number;
  actualSessionId?: string;
  parentToolUseId?: string;
  subagentTools?: unknown[];
  isFinal?: boolean;
  // Cursor-specific ordering
  sequence?: number;
  rowid?: number;
}

// ─── Per-session slot ────────────────────────────────────────────────────────

export type SessionStatus = 'idle' | 'loading' | 'streaming' | 'error';

export interface SessionSlot {
  serverMessages: NormalizedMessage[];
  realtimeMessages: NormalizedMessage[];
  merged: NormalizedMessage[];
  /** @internal Cache-invalidation refs for computeMerged */
  _lastServerRef: NormalizedMessage[];
  _lastRealtimeRef: NormalizedMessage[];
  status: SessionStatus;
  fetchedAt: number;
  total: number;
  hasMore: boolean;
  offset: number;
  tokenUsage: unknown;
}

const EMPTY: NormalizedMessage[] = [];

function createEmptySlot(): SessionSlot {
  return {
    serverMessages: EMPTY,
    realtimeMessages: EMPTY,
    merged: EMPTY,
    _lastServerRef: EMPTY,
    _lastRealtimeRef: EMPTY,
    status: 'idle',
    fetchedAt: 0,
    total: 0,
    hasMore: false,
    offset: 0,
    tokenUsage: null,
  };
}

/**
 * Compute merged messages: server + realtime, deduped by id.
 * Server messages take priority (they're the persisted source of truth).
 * Realtime messages that aren't yet in server stay (in-flight streaming).
 */
function computeMerged(server: NormalizedMessage[], realtime: NormalizedMessage[]): NormalizedMessage[] {
  if (realtime.length === 0) return server;
  if (server.length === 0) return realtime;
  const serverIds = new Set(server.map(m => m.id));
  const extra = realtime.filter(m => !serverIds.has(m.id));
  if (extra.length === 0) return server;
  return [...server, ...extra];
}

/**
 * Recompute slot.merged only when the input arrays have actually changed
 * (by reference). Returns true if merged was recomputed.
 */
function recomputeMergedIfNeeded(slot: SessionSlot): boolean {
  if (slot.serverMessages === slot._lastServerRef && slot.realtimeMessages === slot._lastRealtimeRef) {
    return false;
  }
  slot._lastServerRef = slot.serverMessages;
  slot._lastRealtimeRef = slot.realtimeMessages;
  slot.merged = computeMerged(slot.serverMessages, slot.realtimeMessages);
  return true;
}

// ─── Stale threshold ─────────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 30_000;

const MAX_REALTIME_MESSAGES = 500;

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSessionStore() {
  const storeRef = useRef(new Map<string, SessionSlot>());
  const activeSessionIdRef = useRef<string | null>(null);
  // Bump to force re-render — only when the active session's data changes
  const [, setTick] = useState(0);
  const notify = useCallback((sessionId: string) => {
    if (sessionId === activeSessionIdRef.current) {
      setTick(n => n + 1);
    }
  }, []);

  const setActiveSession = useCallback((sessionId: string | null) => {
    activeSessionIdRef.current = sessionId;
  }, []);

  const getSlot = useCallback((sessionId: string): SessionSlot => {
    const store = storeRef.current;
    if (!store.has(sessionId)) {
      store.set(sessionId, createEmptySlot());
    }
    return store.get(sessionId)!;
  }, []);

  /**
   * Read-only slot accessor. Returns undefined if the slot doesn't exist.
   * Unlike getSlot, this never creates a new slot as a side-effect, so it's
   * safe to use from render-path guards that only want to probe for state.
   */
  const peekSlot = useCallback((sessionId: string): SessionSlot | undefined => {
    return storeRef.current.get(sessionId);
  }, []);

  const has = useCallback((sessionId: string) => storeRef.current.has(sessionId), []);

  /**
   * Migrate a temporary slot (e.g. `new-session-<ts>`) onto a real session id.
   * Used when the backend reports `session_created` mid-stream: the in-flight
   * streaming content must survive the id swap so the chat view doesn't blank.
   *
   * - If no slot exists for tempId, this is a no-op (returns false).
   * - If realId already has a slot, the two are merged (server + realtime
   *   messages unioned by id, the freshest fetchedAt wins, tempId's status is
   *   preferred when it's streaming).
   * - The tempId slot is deleted afterwards to prevent memory leaks.
   * - The realId slot's fetchedAt is refreshed so isStale() stays false and
   *   the main session effect won't re-fetch and wipe realtime messages.
   * - Cursor provider stores its session id in sessionStorage under
   *   `cursorSessionId`; if it matches tempId it's rewritten to realId.
   */
  const promoteSession = useCallback((tempId: string, realId: string): boolean => {
    if (!tempId || !realId || tempId === realId) return false;
    const store = storeRef.current;
    const tempSlot = store.get(tempId);
    if (!tempSlot) return false;

    try {
      const existingRealSlot = store.get(realId);

      // Build merged server/realtime arrays. Union by id, temp takes priority
      // for the in-flight data that hasn't been persisted yet.
      const mergeById = (a: NormalizedMessage[], b: NormalizedMessage[]) => {
        if (a.length === 0) return b;
        if (b.length === 0) return a;
        const seen = new Set<string>();
        const result: NormalizedMessage[] = [];
        for (const m of a) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            result.push(m);
          }
        }
        for (const m of b) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            result.push(m);
          }
        }
        return result;
      };

      const serverMessages = existingRealSlot
        ? mergeById(existingRealSlot.serverMessages, tempSlot.serverMessages)
        : tempSlot.serverMessages;
      const realtimeMessages = existingRealSlot
        ? mergeById(existingRealSlot.realtimeMessages, tempSlot.realtimeMessages)
        : tempSlot.realtimeMessages;

      // Prefer streaming status over anything else so the UI keeps rendering
      // the live stream while the id swap happens.
      const pickStatus = (): SessionStatus => {
        if (tempSlot.status === 'streaming') return 'streaming';
        if (existingRealSlot?.status === 'streaming') return 'streaming';
        if (tempSlot.status === 'error' || existingRealSlot?.status === 'error') return 'error';
        if (tempSlot.status === 'loading' || existingRealSlot?.status === 'loading') return 'loading';
        return 'idle';
      };

      const promotedSlot: SessionSlot = {
        serverMessages,
        realtimeMessages,
        merged: EMPTY,
        _lastServerRef: EMPTY,
        _lastRealtimeRef: EMPTY,
        status: pickStatus(),
        // Force fresh so the session load effect doesn't re-fetch and wipe us.
        fetchedAt: Date.now(),
        total: Math.max(existingRealSlot?.total ?? 0, tempSlot.total),
        hasMore: existingRealSlot?.hasMore ?? tempSlot.hasMore,
        offset: Math.max(existingRealSlot?.offset ?? 0, tempSlot.offset),
        tokenUsage: existingRealSlot?.tokenUsage ?? tempSlot.tokenUsage,
      };

      // Replace (or create) the real slot in one immutable assignment.
      store.set(realId, promotedSlot);
      recomputeMergedIfNeeded(promotedSlot);

      // Drop the temporary slot to prevent leaks.
      store.delete(tempId);

      // Cursor provider: if the sessionStorage pointer is on the temp id,
      // migrate it to the real id so subsequent sends route correctly.
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          const cursorId = window.sessionStorage.getItem('cursorSessionId');
          if (cursorId === tempId) {
            window.sessionStorage.setItem('cursorSessionId', realId);
          }
        }
      } catch {
        // sessionStorage unavailable — ignore.
      }

      // If the active view was pointing at the temp id, move it forward so
      // notify() on realId reaches the current subscriber.
      if (activeSessionIdRef.current === tempId) {
        activeSessionIdRef.current = realId;
      }

      notify(realId);
      return true;
    } catch (error) {
      console.error(`[SessionStore] promoteSession failed (${tempId} → ${realId}):`, error);
      return false;
    }
  }, [notify]);

  /**
   * Fetch messages from the unified endpoint and populate serverMessages.
   */
  const fetchFromServer = useCallback(async (
    sessionId: string,
    opts: {
      provider?: SessionProvider;
      projectName?: string;
      projectPath?: string;
      limit?: number | null;
      offset?: number;
    } = {},
  ) => {
    const slot = getSlot(sessionId);
    slot.status = 'loading';
    notify(sessionId);

    try {
      const params = new URLSearchParams();
      if (opts.provider) params.append('provider', opts.provider);
      if (opts.projectName) params.append('projectName', opts.projectName);
      if (opts.projectPath) params.append('projectPath', opts.projectPath);
      if (opts.limit !== null && opts.limit !== undefined) {
        params.append('limit', String(opts.limit));
        params.append('offset', String(opts.offset ?? 0));
      }

      const qs = params.toString();
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`;
      const response = await authenticatedFetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const messages: NormalizedMessage[] = data.messages || [];

      slot.serverMessages = messages;
      slot.total = data.total ?? messages.length;
      slot.hasMore = Boolean(data.hasMore);
      slot.offset = (opts.offset ?? 0) + messages.length;
      slot.fetchedAt = Date.now();
      slot.status = 'idle';
      recomputeMergedIfNeeded(slot);
      if (data.tokenUsage) {
        slot.tokenUsage = data.tokenUsage;
      }

      notify(sessionId);
      return slot;
    } catch (error) {
      console.error(`[SessionStore] fetch failed for ${sessionId}:`, error);
      slot.status = 'error';
      notify(sessionId);
      return slot;
    }
  }, [getSlot, notify]);

  /**
   * Load older (paginated) messages and prepend to serverMessages.
   */
  const fetchMore = useCallback(async (
    sessionId: string,
    opts: {
      provider?: SessionProvider;
      projectName?: string;
      projectPath?: string;
      limit?: number;
    } = {},
  ) => {
    const slot = getSlot(sessionId);
    if (!slot.hasMore) return slot;

    const params = new URLSearchParams();
    if (opts.provider) params.append('provider', opts.provider);
    if (opts.projectName) params.append('projectName', opts.projectName);
    if (opts.projectPath) params.append('projectPath', opts.projectPath);
    const limit = opts.limit ?? 20;
    params.append('limit', String(limit));
    params.append('offset', String(slot.offset));

    const qs = params.toString();
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`;

    try {
      const response = await authenticatedFetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const olderMessages: NormalizedMessage[] = data.messages || [];

      // Prepend older messages (they're earlier in the conversation)
      slot.serverMessages = [...olderMessages, ...slot.serverMessages];
      slot.hasMore = Boolean(data.hasMore);
      slot.offset = slot.offset + olderMessages.length;
      recomputeMergedIfNeeded(slot);
      notify(sessionId);
      return slot;
    } catch (error) {
      console.error(`[SessionStore] fetchMore failed for ${sessionId}:`, error);
      return slot;
    }
  }, [getSlot, notify]);

  /**
   * Append a realtime (WebSocket) message to the correct session slot.
   * This works regardless of which session is actively viewed.
   */
  const appendRealtime = useCallback((sessionId: string, msg: NormalizedMessage) => {
    const slot = getSlot(sessionId);
    // Strip any optimistic assistant placeholders when a real message arrives.
    // The placeholder is added by the composer on submit to give immediate
    // feedback, and must vanish on the first real token or tool use. We
    // preserve the placeholder itself (the message that added it) by checking
    // msg.id first — only filter when the incoming msg is NOT a placeholder.
    const incomingIsPlaceholder = typeof msg.id === 'string' && msg.id.startsWith('__placeholder_');
    let base = slot.realtimeMessages;
    if (!incomingIsPlaceholder) {
      base = base.filter(m => !(typeof m.id === 'string' && m.id.startsWith('__placeholder_')));
    }
    let updated = [...base, msg];
    if (updated.length > MAX_REALTIME_MESSAGES) {
      updated = updated.slice(-MAX_REALTIME_MESSAGES);
    }
    slot.realtimeMessages = updated;
    recomputeMergedIfNeeded(slot);
    notify(sessionId);
  }, [getSlot, notify]);

  /**
   * Append multiple realtime messages at once (batch).
   */
  const appendRealtimeBatch = useCallback((sessionId: string, msgs: NormalizedMessage[]) => {
    if (msgs.length === 0) return;
    const slot = getSlot(sessionId);
    let updated = [...slot.realtimeMessages, ...msgs];
    if (updated.length > MAX_REALTIME_MESSAGES) {
      updated = updated.slice(-MAX_REALTIME_MESSAGES);
    }
    slot.realtimeMessages = updated;
    recomputeMergedIfNeeded(slot);
    notify(sessionId);
  }, [getSlot, notify]);

  /**
   * Re-fetch serverMessages from the unified endpoint (e.g., on projects_updated).
   */
  const refreshFromServer = useCallback(async (
    sessionId: string,
    opts: {
      provider?: SessionProvider;
      projectName?: string;
      projectPath?: string;
    } = {},
  ) => {
    const slot = getSlot(sessionId);
    try {
      const params = new URLSearchParams();
      if (opts.provider) params.append('provider', opts.provider);
      if (opts.projectName) params.append('projectName', opts.projectName);
      if (opts.projectPath) params.append('projectPath', opts.projectPath);

      const qs = params.toString();
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`;
      const response = await authenticatedFetch(url);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      slot.serverMessages = data.messages || [];
      slot.total = data.total ?? slot.serverMessages.length;
      slot.hasMore = Boolean(data.hasMore);
      slot.fetchedAt = Date.now();
      // drop realtime messages that the server has caught up with to prevent unbounded growth.
      slot.realtimeMessages = [];
      recomputeMergedIfNeeded(slot);
      notify(sessionId);
    } catch (error) {
      console.error(`[SessionStore] refresh failed for ${sessionId}:`, error);
    }
  }, [getSlot, notify]);

  /**
   * Update session status.
   */
  const setStatus = useCallback((sessionId: string, status: SessionStatus) => {
    const slot = getSlot(sessionId);
    slot.status = status;
    notify(sessionId);
  }, [getSlot, notify]);

  /**
   * Check if a session's data is stale (>30s old).
   */
  const isStale = useCallback((sessionId: string) => {
    const slot = storeRef.current.get(sessionId);
    if (!slot) return true;
    return Date.now() - slot.fetchedAt > STALE_THRESHOLD_MS;
  }, []);

  /**
   * Update or create a streaming message (accumulated text so far).
   * Uses a well-known ID so subsequent calls replace the same message.
   */
  const updateStreaming = useCallback((sessionId: string, accumulatedText: string, msgProvider: SessionProvider) => {
    const slot = getSlot(sessionId);
    const streamId = `__streaming_${sessionId}`;
    const msg: NormalizedMessage = {
      id: streamId,
      sessionId,
      timestamp: new Date().toISOString(),
      provider: msgProvider,
      kind: 'stream_delta',
      content: accumulatedText,
    };
    // Strip optimistic placeholders on first streaming token — the placeholder
    // has done its job of reserving visual space for the assistant reply.
    const withoutPlaceholder = slot.realtimeMessages.filter(
      m => !(typeof m.id === 'string' && m.id.startsWith('__placeholder_')),
    );
    const idx = withoutPlaceholder.findIndex(m => m.id === streamId);
    if (idx >= 0) {
      const next = [...withoutPlaceholder];
      next[idx] = msg;
      slot.realtimeMessages = next;
    } else {
      slot.realtimeMessages = [...withoutPlaceholder, msg];
    }
    recomputeMergedIfNeeded(slot);
    notify(sessionId);
  }, [getSlot, notify]);

  /**
   * Finalize streaming: convert the streaming message to a regular text message.
   * The well-known streaming ID is replaced with a unique text message ID.
   */
  const finalizeStreaming = useCallback((sessionId: string) => {
    const slot = storeRef.current.get(sessionId);
    if (!slot) return;
    const streamId = `__streaming_${sessionId}`;
    const idx = slot.realtimeMessages.findIndex(m => m.id === streamId);
    if (idx >= 0) {
      const stream = slot.realtimeMessages[idx];
      slot.realtimeMessages = [...slot.realtimeMessages];
      slot.realtimeMessages[idx] = {
        ...stream,
        id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind: 'text',
        role: 'assistant',
      };
      recomputeMergedIfNeeded(slot);
      notify(sessionId);
    }
  }, [notify]);

  /**
   * Remove any optimistic `__placeholder_*` assistant messages for a session.
   * Used by the realtime `complete` handler as a safety net when no streaming
   * token ever arrived (error / tool-only responses).
   */
  const clearPlaceholders = useCallback((sessionId: string) => {
    const slot = storeRef.current.get(sessionId);
    if (!slot) return;
    const filtered = slot.realtimeMessages.filter(
      m => !(typeof m.id === 'string' && m.id.startsWith('__placeholder_')),
    );
    if (filtered.length !== slot.realtimeMessages.length) {
      slot.realtimeMessages = filtered;
      recomputeMergedIfNeeded(slot);
      notify(sessionId);
    }
  }, [notify]);

  /**
   * Clear realtime messages for a session (e.g., after stream completes and server fetch catches up).
   */
  const clearRealtime = useCallback((sessionId: string) => {
    const slot = storeRef.current.get(sessionId);
    if (slot) {
      slot.realtimeMessages = [];
      recomputeMergedIfNeeded(slot);
      notify(sessionId);
    }
  }, [notify]);

  /**
   * Get merged messages for a session (for rendering).
   */
  const getMessages = useCallback((sessionId: string): NormalizedMessage[] => {
    return storeRef.current.get(sessionId)?.merged ?? [];
  }, []);

  /**
   * Get session slot (for status, pagination info, etc.).
   */
  const getSessionSlot = useCallback((sessionId: string): SessionSlot | undefined => {
    return storeRef.current.get(sessionId);
  }, []);

  return useMemo(() => ({
    getSlot,
    peekSlot,
    has,
    fetchFromServer,
    fetchMore,
    appendRealtime,
    appendRealtimeBatch,
    refreshFromServer,
    setActiveSession,
    setStatus,
    isStale,
    updateStreaming,
    finalizeStreaming,
    promoteSession,
    clearRealtime,
    clearPlaceholders,
    getMessages,
    getSessionSlot,
  }), [
    getSlot, peekSlot, has, fetchFromServer, fetchMore,
    appendRealtime, appendRealtimeBatch, refreshFromServer,
    setActiveSession, setStatus, isStale, updateStreaming, finalizeStreaming,
    promoteSession, clearRealtime, clearPlaceholders, getMessages, getSessionSlot,
  ]);
}

export type SessionStore = ReturnType<typeof useSessionStore>;
