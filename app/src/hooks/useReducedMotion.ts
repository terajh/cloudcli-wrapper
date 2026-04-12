import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Returns `true` when the user's OS-level accessibility setting requests
 * reduced motion. Listens for live changes (e.g. toggling the setting in
 * System Preferences while the app is running).
 */
export function useReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const handler = (event: MediaQueryListEvent) => {
      setPrefersReduced(event.matches);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return prefersReduced;
}
