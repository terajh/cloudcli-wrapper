import { useCallback, useRef } from 'react';
import { safeLocalStorage } from '../utils/chatStorage';

const MAX_HISTORY = 100;
const STORAGE_KEY = 'prompt-history';

function loadHistory(): string[] {
  const raw = safeLocalStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]): void {
  safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function usePromptHistory() {
  const indexRef = useRef(-1);
  const savedCurrentRef = useRef<string | null>(null);

  const push = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const history = loadHistory();
    // Deduplicate: skip if identical to last entry
    if (history.length > 0 && history[0] === trimmed) {
      return;
    }
    const next = [trimmed, ...history].slice(0, MAX_HISTORY);
    saveHistory(next);
  }, []);

  const navigateUp = useCallback((currentText: string): string | null => {
    const history = loadHistory();
    if (history.length === 0) {
      return null;
    }
    // Save current unsent text when leaving index -1
    if (indexRef.current === -1) {
      savedCurrentRef.current = currentText;
    }
    const nextIndex = Math.min(indexRef.current + 1, history.length - 1);
    if (nextIndex === indexRef.current && indexRef.current !== -1) {
      return null;
    }
    indexRef.current = nextIndex;
    return history[nextIndex] ?? null;
  }, []);

  const navigateDown = useCallback((): string | null => {
    if (indexRef.current <= -1) {
      return null;
    }
    const nextIndex = indexRef.current - 1;
    indexRef.current = nextIndex;
    if (nextIndex === -1) {
      const saved = savedCurrentRef.current ?? '';
      savedCurrentRef.current = null;
      return saved;
    }
    const history = loadHistory();
    return history[nextIndex] ?? null;
  }, []);

  const reset = useCallback(() => {
    indexRef.current = -1;
    savedCurrentRef.current = null;
  }, []);

  return { push, navigateUp, navigateDown, reset };
}
