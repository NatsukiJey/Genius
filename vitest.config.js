import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

const here = p => fileURLToPath(new URL(p, import.meta.url));

// Тесты интерфейса: настоящие React-компоненты в jsdom + Testing Library. Сервер подменяется fetch-заглушкой.
export default defineConfig({
  plugins: [react()],
  resolve: {alias: {'@shared': here('./shared')}},
  css: {include: []},
  test: {environment: 'jsdom', include: ['tests/ui/**/*.test.{js,jsx}'], setupFiles: ['tests/ui/setup.js'], globals: false, css: false}
});
