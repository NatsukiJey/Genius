import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

const here = p => fileURLToPath(new URL(p, import.meta.url));

// Клиент: ./client (root). Сборка идёт в ./dist, её раздаёт Node-сервер (server.mjs) с того же адреса.
// Строгая CSP (script-src 'self', style-src 'self') работает на сборке: modulePreload.polyfill=false и assetsInlineLimit=0
// не дают Vite вставить inline-скрипты/стили.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  resolve: {alias: {'@shared': here('./shared')}},
  build: {outDir: '../dist', emptyOutDir: true, assetsInlineLimit: 0, modulePreload: {polyfill: false}, sourcemap: false},
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    fs: {allow: [here('.')]},
    // В разработке браузер ходит на :5173, а Vite пересылает /api и /audio на Node-сервер (:4173).
    // Host/Origin остаются localhost:5173, поэтому сервер для разработки запускают с ALLOWED_HOSTS (см. npm run dev:server).
    proxy: {'/api': 'http://127.0.0.1:4173', '/audio': 'http://127.0.0.1:4173'}
  }
});
