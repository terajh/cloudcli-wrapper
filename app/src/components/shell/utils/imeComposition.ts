/**
 * IME composition gating for the standalone shell terminal.
 *
 * xterm.js wires its hidden textarea to its own `onData` callback. When
 * the user types Korean (or any IME-composed text — Chinese pinyin,
 * Japanese kana ↔ kanji), the textarea fires `input` events for every
 * intermediate jamo / pinyin syllable / kana stroke. Forwarding those
 * raw fragments to the PTY corrupts the input — the shell sees stray
 * jamo characters instead of the composed Hangul syllable.
 *
 * The fix is to listen on the textarea's `compositionstart` /
 * `compositionend` events, swallow `onData` payloads while a composition
 * is in progress, and emit the final composed text once at
 * `compositionend`.
 *
 * This module owns the *state machine* for that gate so it can be unit
 * tested without spinning up a real DOM-attached xterm instance.
 */

export type CompositionGateActions = {
  /**
   * Called when the gate decides to forward a chunk of text to the PTY.
   * The host wires this up to `sendSocketMessage(ws, { type: 'input', data })`.
   */
  send: (data: string) => void;
};

export type CompositionGate = {
  /** True while a composition is in progress. */
  readonly isComposing: boolean;
  /** Buffered fragments captured during the active composition. */
  readonly bufferedFragment: string;
  /** Called by the xterm `onData` handler. Returns true if the chunk was forwarded. */
  onData: (data: string) => boolean;
  /** Called by the textarea `compositionstart` handler. */
  onCompositionStart: () => void;
  /** Called by the textarea `compositionend` handler. */
  onCompositionEnd: (eventData?: string | null) => void;
  /** Reset to idle (used by tests / cleanup paths). */
  reset: () => void;
};

export const createCompositionGate = (
  actions: CompositionGateActions,
): CompositionGate => {
  let isComposing = false;
  let bufferedFragment = '';

  return {
    get isComposing() {
      return isComposing;
    },
    get bufferedFragment() {
      return bufferedFragment;
    },
    onData(data: string): boolean {
      if (isComposing) {
        bufferedFragment += data;
        return false;
      }
      actions.send(data);
      return true;
    },
    onCompositionStart() {
      isComposing = true;
      bufferedFragment = '';
    },
    onCompositionEnd(eventData?: string | null) {
      isComposing = false;
      // Prefer the browser-supplied composition data because it always
      // contains the *final* composed glyph (e.g. "안녕"). Fall back to
      // the buffered fragments only if the browser didn't supply data.
      const composed =
        typeof eventData === 'string' && eventData.length > 0 ? eventData : bufferedFragment;
      bufferedFragment = '';
      if (composed) {
        actions.send(composed);
      }
    },
    reset() {
      isComposing = false;
      bufferedFragment = '';
    },
  };
};
