import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000';
// Polling avoids missed fs events when the source lives on a bind-mounted
// Windows drive (Docker dev stack). Set VITE_USE_POLLING=true in that case.
const usePolling = process.env.VITE_USE_POLLING === 'true';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    watch: usePolling ? { usePolling: true } : undefined,
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
      },
      '/socket.io': {
        target: proxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
