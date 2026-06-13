/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

// GitHub Pages serves this project under /ModelVisualization/.
// Local dev/preview use '/'. Override with BASE_PATH if the repo is renamed.
const base = process.env.BASE_PATH ?? (process.env.NODE_ENV === 'production' ? '/ModelVisualization/' : '/');

export default defineConfig({
  base,
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
