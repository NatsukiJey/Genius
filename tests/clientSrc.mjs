import {readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');
export const CLIENT_SRC = path.join(root, 'client', 'src');

export function walk(dir, ok = () => true) {
  return readdirSync(dir).flatMap(n => { const f = path.join(dir, n); return statSync(f).isDirectory() ? walk(f, ok) : ok(f) ? [f] : []; });
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
