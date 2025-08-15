import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false, // if 5173 is busy, pick the next available port
  }
});
