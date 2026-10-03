import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

process.loadEnvFile?.('.env');
const uiPort = Number(process.env.UI_PORT ?? 5180);
const apiPort = Number(process.env.API_PORT ?? 5181);

export default defineConfig({
  root: 'app',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: uiPort,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${apiPort}` }
  },
  preview: { host: '127.0.0.1', port: 4180, strictPort: true },
  build: { outDir: '../dist/ui', emptyOutDir: false }
});
