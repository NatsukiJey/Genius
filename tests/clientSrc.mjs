import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');
export const CLIENT_SRC = path.join(root, 'client', 'src');

// Обход папки. Генерируемые/игнорируемые каталоги (node_modules, dist, .git, tests/.data — профили браузера и
// тестовые данные) не обходим вообще, символические ссылки не разыменовываем (в профиле Chromium они бывают битыми).
export const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.data', 'coverage', '.vercel']);
export function walk(dir, ok = () => true) {
  return readdirSync(dir, {withFileTypes: true}).flatMap(e => {
    const f = path.join(dir, e.name);
    if (e.isSymbolicLink()) return [];
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(f, ok);
    return e.isFile() && ok(f) ? [f] : [];
  });
}
// Весь исходный код клиента (js/jsx) одной строкой: для охранных проверок «браузер сам ничего не решает».
export const clientFiles = () => walk(CLIENT_SRC, f => /\.(js|jsx)$/.test(f));
export const readClientSource = () => clientFiles().map(f => readFileSync(f, 'utf8')).join('\n');
// CSS в порядке @import из App.css (порядок = порядок каскада).
export function readStyles() {
  const app = readFileSync(path.join(CLIENT_SRC, 'App.css'), 'utf8');
  return [...app.matchAll(/@import '\.\/([^']+)'/g)].map(m => readFileSync(path.join(CLIENT_SRC, m[1]), 'utf8')).join('\n');
}
export const readRoot = rel => readFileSync(path.join(root, rel), 'utf8');
