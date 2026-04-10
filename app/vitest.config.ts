import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Kept separate from `vite.config.js` so the main build stays lean and so
// vitest doesn't try to parse the dev server proxy block.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
