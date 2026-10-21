import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API runs on 127.0.0.1:8787 (apps/api); the board reaches it through this proxy,
// so provider keys stay in that process and the browser only talks to its own origin.
const api = `http://127.0.0.1:${process.env.CHALKLINE_API_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/v1': api },
  },
  worker: { format: 'es' },
});
