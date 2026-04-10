/**
 * OpenAI Codex SDK Integration
 * =============================
 *
 * This module provides integration with the OpenAI Codex SDK for non-interactive
 * chat sessions. It mirrors the pattern used in claude-sdk.js for consistency.
 *
 * ## Usage
 *
 * - queryCodex(command, options, ws) - Execute a prompt with streaming via WebSocket
 * - abortCodexSession(sessionId) - Cancel an active session
 * - isCodexSessionActive(sessionId) - Check if a session is running
 * - getActiveCodexSessions() - List all active sessions
 */

import { Codex } from '@openai/codex-sdk';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { codexAdapter } from './providers/codex/adapter.js';
import { createNormalizedMessage } from './providers/types.js';

// Track active sessions
const activeCodexSessions = new Map();

/**
 * Transform Codex SDK event to WebSocket message format
 * @param {object} event - SDK event
 * @returns {object} - Transformed event for WebSocket
 */
function transformCodexEvent(event) {
  // Map SDK event types to a consistent format
  switch (event.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      const item = event.item;
      if (!item) {
        return { type: event.type, item: null };
      }

      // Transform based on item type
      switch (item.type) {
        case 'agent_message':
          return {
            type: 'item',
            itemType: 'agent_message',
            message: {
              role: 'assistant',
              content: item.text
            }
          };

        case 'reasoning':
          return {
            type: 'item',
            itemType: 'reasoning',
            message: {
              role: 'assistant',
              content: item.text,
              isReasoning: true
            }
          };

        case 'command_execution':
          return {
            type: 'item',
            itemType: 'command_execution',
            command: item.command,
            output: item.aggregated_output,
            exitCode: item.exit_code,
            status: item.status
          };

        case 'file_change':
          return {
            type: 'item',
            itemType: 'file_change',
            changes: item.changes,
            status: item.status
          };

        case 'mcp_tool_call':
          return {
            type: 'item',
            itemType: 'mcp_tool_call',
            server: item.server,
            tool: item.tool,
            arguments: item.arguments,
            result: item.result,
            error: item.error,
            status: item.status
          };

        case 'web_search':
          return {
            type: 'item',
            itemType: 'web_search',
            query: item.query
          };

        case 'todo_list':
          return {
            type: 'item',
            itemType: 'todo_list',
            items: item.items
          };

        case 'error':
          return {
            type: 'item',
            itemType: 'error',
            message: {
              role: 'error',
              content: item.message
            }
          };

        default:
          return {
            type: 'item',
            itemType: item.type,
            item: item
          };
      }

    case 'turn.started':
      return {
        type: 'turn_started'
      };

    case 'turn.completed':
      return {
        type: 'turn_complete',
        usage: event.usage
      };

    case 'turn.failed':
      return {
        type: 'turn_failed',
        error: event.error
      };

    case 'thread.started':
      return {
        type: 'thread_started',
        threadId: event.id
      };

    case 'error':
      return {
        type: 'error',
        message: event.message
      };

    default:
      return {
        type: event.type,
        data: event
      };
  }
}

/**
 * Map permission mode to Codex SDK options.
 *
 * NOTE: `approvalPolicy` is intentionally omitted. The @openai/codex-sdk
 * (v0.101.x) maps it to --approval-policy, but codex CLI ≥0.112 removed
 * that flag. Passing it causes an "unexpected argument" error that kills the
 * subprocess silently. sandboxMode alone is sufficient for access control.
 *
 * @param {string} permissionMode - 'default', 'acceptEdits', or 'bypassPermissions'
 * @returns {object} - { sandboxMode }
 */
function mapPermissionModeToCodexOptions(permissionMode) {
  switch (permissionMode) {
    case 'acceptEdits':
      return { sandboxMode: 'workspace-write' };
    case 'bypassPermissions':
      return { sandboxMode: 'danger-full-access' };
    case 'default':
    default:
      return { sandboxMode: 'workspace-write' };
  }
}

/**
 * Execute a Codex query with streaming
 * @param {string} command - The prompt to send
 * @param {object} options - Options including cwd, sessionId, model, permissionMode
 * @param {WebSocket|object} ws - WebSocket connection or response writer
 */
export async function queryCodex(command, options = {}, ws) {
  const {
    sessionId,
    sessionSummary,
    cwd,
    projectPath,
    model,
    permissionMode = 'default'
  } = options;

  const workingDirectory = cwd || projectPath || process.cwd();
  const { sandboxMode } = mapPermissionModeToCodexOptions(permissionMode);

  let codex;
  let thread;
  let currentSessionId = sessionId;
  let terminalFailure = null;
  let receivedAnyEvent = false;
  const abortController = new AbortController();

  try {
    // Initialize Codex SDK
    codex = new Codex();

    // Thread options — do NOT include approvalPolicy; codex CLI ≥0.112 removed the flag.
    const threadOptions = {
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode,
      model
    };

    // Start or resume thread
    if (sessionId) {
      thread = codex.resumeThread(sessionId, threadOptions);
    } else {
      thread = codex.startThread(threadOptions);
    }

    // Resumed threads already know their id. Brand-new threads do NOT —
    // per the SDK docs (`/** Populated after the first turn starts. */`),
    // `thread.id` is `null` at this point for a new thread. Using a
    // `codex-${Date.now()}` placeholder here and broadcasting it via
    // `session_created` was the source of the "duplicate codex session"
    // sidebar bug: the frontend pinned its optimistic row to the
    // placeholder id, but chokidar later indexed the real jsonl under
    // the actual thread id → the two rows never converged.
    //
    // Instead, defer `session_created` until we actually know the real
    // id. For resumed threads we can emit immediately. For new threads
    // we wait for the first event inside `runStreamed` (a
    // `thread.started` event carrying `thread_id`) and only THEN emit
    // `session_created` with the authoritative id.
    const isResumed = Boolean(sessionId);
    if (isResumed) {
      currentSessionId = thread.id || sessionId;
      activeCodexSessions.set(currentSessionId, {
        thread,
        codex,
        status: 'running',
        abortController,
        startedAt: new Date().toISOString()
      });
      sendMessage(ws, createNormalizedMessage({ kind: 'session_created', newSessionId: currentSessionId, sessionId: currentSessionId, provider: 'codex' }));
    }

    // Execute with streaming
    const streamedTurn = await thread.runStreamed(command, {
      signal: abortController.signal
    });

    for await (const event of streamedTurn.events) {
      // For brand-new threads, the very first event is `thread.started`
      // carrying the real `thread_id`. Capture it, register the session
      // under the real id, and emit `session_created` here so the
      // frontend's optimistic row promotes directly to the authoritative
      // id that chokidar will later index.
      if (!currentSessionId && event.type === 'thread.started' && event.thread_id) {
        currentSessionId = event.thread_id;
        activeCodexSessions.set(currentSessionId, {
          thread,
          codex,
          status: 'running',
          abortController,
          startedAt: new Date().toISOString()
        });
        sendMessage(ws, createNormalizedMessage({ kind: 'session_created', newSessionId: currentSessionId, sessionId: currentSessionId, provider: 'codex' }));
      }

      // Check if session was aborted
      const session = currentSessionId ? activeCodexSessions.get(currentSessionId) : null;
      if (currentSessionId && (!session || session.status === 'aborted')) {
        break;
      }

      receivedAnyEvent = true;

      if (event.type === 'item.started' || event.type === 'item.updated') {
        continue;
      }

      const transformed = transformCodexEvent(event);

      // Normalize the transformed event into NormalizedMessage(s) via adapter
      const normalizedMsgs = codexAdapter.normalizeMessage(transformed, currentSessionId);
      for (const msg of normalizedMsgs) {
        sendMessage(ws, msg);
      }

      if (event.type === 'turn.failed' && !terminalFailure) {
        terminalFailure = event.error || new Error('Turn failed');
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: currentSessionId,
          sessionName: sessionSummary,
          error: terminalFailure
        });
      }

      // Extract and send token usage if available (normalized to match Claude format)
      if (event.type === 'turn.completed' && event.usage) {
        const totalTokens = (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0);
        sendMessage(ws, createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: { used: totalTokens, total: 200000 }, sessionId: currentSessionId, provider: 'codex' }));
      }
    }

    // If codex subprocess exited without producing any events, it likely failed
    // silently (e.g. unknown CLI flag, auth error). Surface it as an error.
    if (!receivedAnyEvent && !terminalFailure) {
      const msg = 'Codex process exited without output. Check that codex CLI is authenticated and the model name is valid.';
      console.error('[Codex]', msg);
      terminalFailure = new Error(msg);
      sendMessage(ws, createNormalizedMessage({ kind: 'error', content: msg, sessionId: currentSessionId, provider: 'codex' }));
    }

    // Safety net: if the stream produced events but somehow never emitted a
    // `thread.started` (shouldn't happen with current codex-sdk, but the
    // SDK's ordering is not formally guaranteed), derive the id from
    // `thread.id` which is populated once the first turn starts. Without
    // this the `complete` event below would sail out with sessionId=null.
    if (!currentSessionId && thread.id) {
      currentSessionId = thread.id;
      activeCodexSessions.set(currentSessionId, {
        thread,
        codex,
        status: 'running',
        abortController,
        startedAt: new Date().toISOString()
      });
      sendMessage(ws, createNormalizedMessage({ kind: 'session_created', newSessionId: currentSessionId, sessionId: currentSessionId, provider: 'codex' }));
    }

    // Send completion event
    if (!terminalFailure) {
      const resolvedSessionId = thread.id || currentSessionId;
      sendMessage(ws, createNormalizedMessage({ kind: 'complete', actualSessionId: resolvedSessionId, sessionId: currentSessionId, provider: 'codex' }));
      notifyRunStopped({
        userId: ws?.userId || null,
        provider: 'codex',
        sessionId: currentSessionId,
        sessionName: sessionSummary,
        stopReason: 'completed'
      });
    }

  } catch (error) {
    const session = currentSessionId ? activeCodexSessions.get(currentSessionId) : null;
    const wasAborted =
      session?.status === 'aborted' ||
      error?.name === 'AbortError' ||
      String(error?.message || '').toLowerCase().includes('aborted');

    if (!wasAborted) {
      console.error('[Codex] Error:', error);
      sendMessage(ws, createNormalizedMessage({ kind: 'error', content: error.message, sessionId: currentSessionId, provider: 'codex' }));
      if (!terminalFailure) {
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: currentSessionId,
          sessionName: sessionSummary,
          error
        });
      }
    }

  } finally {
    // Update session status
    if (currentSessionId) {
      const session = activeCodexSessions.get(currentSessionId);
      if (session) {
        session.status = session.status === 'aborted' ? 'aborted' : 'completed';
      }
    }
  }
}

/**
 * Abort an active Codex session
 * @param {string} sessionId - Session ID to abort
 * @returns {boolean} - Whether abort was successful
 */
export function abortCodexSession(sessionId) {
  const session = activeCodexSessions.get(sessionId);

  if (!session) {
    return false;
  }

  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Codex] Failed to abort session ${sessionId}:`, error);
  }

  return true;
}

/**
 * Check if a session is active
 * @param {string} sessionId - Session ID to check
 * @returns {boolean} - Whether session is active
 */
export function isCodexSessionActive(sessionId) {
  const session = activeCodexSessions.get(sessionId);
  return session?.status === 'running';
}

/**
 * Get all active sessions
 * @returns {Array} - Array of active session info
 */
export function getActiveCodexSessions() {
  const sessions = [];

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status === 'running') {
      sessions.push({
        id,
        status: session.status,
        startedAt: session.startedAt
      });
    }
  }

  return sessions;
}

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      // Writer handles stringification (SSEStreamWriter or WebSocketWriter)
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      // Raw WebSocket - stringify here
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

// Clean up old completed sessions periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes
