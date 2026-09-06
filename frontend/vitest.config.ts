import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
    server: {
      deps: {
        // shaka-player ships a UMD/CJS bundle; without inlining it is externalized
        // at runtime and vi.mock(...) never intercepts the import.
        inline: ['shaka-player'],
      },
    },
  },
});
