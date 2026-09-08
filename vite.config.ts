/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` emits relative asset URLs, so the same build works at
// https://user.github.io/, https://user.github.io/<repo>/ or a custom domain
// without rebuilding. Override with BASE_PATH if you ever need absolute URLs.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2020',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
