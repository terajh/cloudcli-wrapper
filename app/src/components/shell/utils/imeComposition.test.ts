/**
 * Regression tests for the standalone shell IME composition gate.
 *
 * The gate exists to fix Korean / Chinese / Japanese input being mangled
 * in the xterm-backed shell — without it, every intermediate jamo gets
 * forwarded to the PTY raw and the user's "안녕" turns into "ㅇㅏㄴㄴㅕㅇ".
 */

import { describe, expect, it, vi } from 'vitest';
import { createCompositionGate } from './imeComposition';

const makeGate = () => {
  const send = vi.fn<(data: string) => void>();
  const gate = createCompositionGate({ send });
  return { gate, send };
};

describe('createCompositionGate (idle path)', () => {
  it('forwards onData when no composition is in progress', () => {
    const { gate, send } = makeGate();
    expect(gate.onData('a')).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('a');
  });

  it('starts in non-composing state', () => {
    const { gate } = makeGate();
    expect(gate.isComposing).toBe(false);
    expect(gate.bufferedFragment).toBe('');
  });
});

describe('createCompositionGate (Korean composition)', () => {
  it('swallows jamo fragments during composition and emits the syllable on compositionend', () => {
    const { gate, send } = makeGate();

    // Hangul "안녕" composition flow:
    //   compositionstart
    //   onData('ㅇ')        ← swallowed
    //   onData('아')        ← swallowed (browser is updating composition buffer)
    //   onData('안')        ← swallowed
    //   onData('아ㄴ')      ← swallowed
    //   onData('안ㄴ')      ← swallowed
    //   onData('안녀')      ← swallowed
    //   onData('안녕')      ← swallowed
    //   compositionend('안녕')
    gate.onCompositionStart();
    expect(gate.isComposing).toBe(true);

    expect(gate.onData('ㅇ')).toBe(false);
    expect(gate.onData('아')).toBe(false);
    expect(gate.onData('안')).toBe(false);
    expect(gate.onData('안녕')).toBe(false);

    expect(send).not.toHaveBeenCalled();

    gate.onCompositionEnd('안녕');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('안녕');
    expect(gate.isComposing).toBe(false);
    expect(gate.bufferedFragment).toBe('');
  });

  it('falls back to buffered fragments when compositionend has no data', () => {
    const { gate, send } = makeGate();
    gate.onCompositionStart();
    gate.onData('a');
    gate.onData('b');
    gate.onCompositionEnd(null);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('ab');
  });

  it('falls back to buffered fragments when compositionend data is empty string', () => {
    const { gate, send } = makeGate();
    gate.onCompositionStart();
    gate.onData('xy');
    gate.onCompositionEnd('');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('xy');
  });

  it('does not emit on compositionend if no data and no buffer', () => {
    const { gate, send } = makeGate();
    gate.onCompositionStart();
    gate.onCompositionEnd();
    expect(send).not.toHaveBeenCalled();
  });

  it('clears buffer between composition cycles', () => {
    const { gate, send } = makeGate();

    gate.onCompositionStart();
    gate.onData('first');
    gate.onCompositionEnd('first');

    gate.onCompositionStart();
    expect(gate.bufferedFragment).toBe('');

    gate.onData('second');
    gate.onCompositionEnd('second');

    expect(send.mock.calls.map((c) => c[0])).toEqual(['first', 'second']);
  });

  it('forwards normal ASCII keys interleaved with composition cycles', () => {
    const { gate, send } = makeGate();

    // Type 'a' (no composition)
    gate.onData('a');
    // Type Korean syllable
    gate.onCompositionStart();
    gate.onData('ㄴ');
    gate.onCompositionEnd('나');
    // Type 'b' (no composition)
    gate.onData('b');

    expect(send.mock.calls.map((c) => c[0])).toEqual(['a', '나', 'b']);
  });

  it('reset() clears state mid-composition', () => {
    const { gate, send } = makeGate();
    gate.onCompositionStart();
    gate.onData('half');
    gate.reset();
    expect(gate.isComposing).toBe(false);
    expect(gate.bufferedFragment).toBe('');
    // Subsequent data is forwarded normally.
    gate.onData('clean');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('clean');
  });
});

describe('createCompositionGate (edge cases)', () => {
  it('handles compositionend without a matching compositionstart', () => {
    const { gate, send } = makeGate();
    // The browser sometimes emits a stray compositionend without start
    // (e.g. focus loss mid-composition). Should not throw or send.
    gate.onCompositionEnd('orphan');
    // The gate emits the orphan data because it considers itself "not
    // composing" and the data parameter is non-empty. This matches the
    // host's behavior of sending whatever the browser hands us — better
    // than dropping potentially-typed text on the floor.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('orphan');
  });

  it('two consecutive compositionstart events are tolerated', () => {
    const { gate, send } = makeGate();
    gate.onCompositionStart();
    gate.onData('a');
    // Browser emits a second compositionstart without an end (rare but
    // possible during quick IME mode toggles). Should reset the buffer
    // so the previous half-composed input doesn't leak into the next.
    gate.onCompositionStart();
    expect(gate.bufferedFragment).toBe('');
    gate.onData('b');
    gate.onCompositionEnd('b');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('b');
  });
});
