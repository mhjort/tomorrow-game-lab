import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'esnext', chunkSizeWarningLimit: 4096 },
  server: { port: 5173 },
  preview: { port: 4173 },
});
