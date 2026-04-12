import { useEffect, useRef, useState } from 'react';

const EXAMPLE_PROMPTS = [
  'Fix the login bug in auth.ts',
  'Add dark mode support to the settings page',
  'Write unit tests for the payment module',
  'Refactor the database queries for better performance',
  'Explain how the WebSocket connection works',
  'Add input validation to the registration form',
  'Create a REST API endpoint for user profiles',
  'Optimize the image loading for mobile',
  'Review the security of the authentication flow',
  'Add error handling to the file upload service',
  'Implement pagination for the search results',
  'Set up CI/CD pipeline with GitHub Actions',
  'Add TypeScript types to the legacy module',
  'Create a caching layer for API responses',
  'Debug the memory leak in the dashboard',
  'Add drag-and-drop support to the file manager',
  'Write integration tests for the checkout flow',
  'Migrate the database schema to the latest version',
  'Add accessibility attributes to the navigation',
  'Implement rate limiting on the API endpoints',
  'Create a reusable modal component',
  'Add i18n support for Japanese locale',
  'Optimize the bundle size with code splitting',
  'Set up environment-specific configuration',
  'Add WebSocket reconnection with exponential backoff',
];

const ROTATION_INTERVAL_MS = 6500;

/**
 * Returns a rotating example prompt string when `isActive` is true.
 * Cycles through EXAMPLE_PROMPTS every 6.5 seconds starting from a
 * random index so the user sees variety across sessions.
 */
export function usePlaceholderRotation(isActive: boolean): string {
  const startIndex = useRef(
    Math.floor(Math.random() * EXAMPLE_PROMPTS.length),
  );
  const [index, setIndex] = useState(startIndex.current);

  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % EXAMPLE_PROMPTS.length);
    }, ROTATION_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isActive]);

  if (!isActive) return '';

  return EXAMPLE_PROMPTS[index] ?? '';
}
