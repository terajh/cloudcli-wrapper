import { useCallback, useRef, useState } from 'react';

export function useFollowupQueue() {
  const [count, setCount] = useState(0);
  const queueRef = useRef<string[]>([]);

  const enqueue = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    queueRef.current = [...queueRef.current, trimmed];
    setCount(queueRef.current.length);
  }, []);

  const dequeue = useCallback((): string | null => {
    if (queueRef.current.length === 0) {
      return null;
    }
    const [first, ...rest] = queueRef.current;
    queueRef.current = rest;
    setCount(rest.length);
    return first;
  }, []);

  const clear = useCallback(() => {
    queueRef.current = [];
    setCount(0);
  }, []);

  return { enqueue, dequeue, clear, count };
}
