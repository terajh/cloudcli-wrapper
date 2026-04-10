import '@testing-library/jest-dom/vitest';

// Silence react-router's deprecation warnings for navigate/useNavigate in
// hook tests — we don't exercise navigation semantics here, we just want
// the callbacks to fire so we can assert state effects.
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && first.includes('React Router')) return;
  originalWarn.apply(console, args as [unknown, ...unknown[]]);
};
