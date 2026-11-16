// Ручная проверка «белого экрана» в настоящем headless Chromium (CDP) на НАСТОЯЩЕЙ сборке dist/. Не входит в npm run check.
// Запуск: npm run build && node tests/browser-blank-boot.mjs
// Свой мини-сервер отдаёт dist с боевой CSP и подменяет только /api/*: сценарии — HTML вместо API, 503 без DATABASE_URL, 404, сломанные /assets/.
// Профиль браузера — tests/.data/bb (в .gitignore). Никаких аккаунтов и паролей.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync, existsSync, openSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CSP} from '../server/app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), dist = process.env.BLANK_DIST || path.join(root, 'dist'); // BLANK_DIST — проверить чужую (старую) сборку
if (!existsSync(path.join(dist, 'index.html'))) { console.error('нет dist/ — сначала npm run build'); process.exit(2); }
const work = path.join(root, 'tests', '.data', 'bb'); rmSync(work, {recursive: true, force: true});
for (const d of ['profile', 'tmp']) mkdirSync(path.join(work, d), {recursive: true});
const PORT = 4188, CDP = 9335, base = `http://127.0.0.1:${PORT}`;
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css'};
let mode = 'html', assets = true;
const api = {
  html: r => { r.writeHead(200, {'Content-Type': 'text/html'}); r.end('<!doctype html><title>x</title>'); },
  setup503: r => { r.writeHead(503, {'Content-Type': 'application/json'}); r.end(JSON.stringify({error: 'Baza ulanmagan: Vercel loyihasida DATABASE_URL sozlanmagan. VERCEL-SETUP.md dagi qadamlarni bajaring.', setup: 'database_url_missing'})); },
  notfound: r => { r.writeHead(404, {'Content-Type': 'text/html'}); r.end('<h1>404</h1>'); },
  hang: () => {}
};
const server = createServer((req, res) => {
  const p = new URL(req.url, base).pathname;
  const sec = {'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff'};
  if (p.startsWith('/api/')) return api[mode](Object.assign(res, {writeHead: ((o) => (s, h) => o(s, {...h, ...sec}))(res.writeHead.bind(res))}));
  if (p.startsWith('/assets/')) { if (!assets) { res.writeHead(404, sec); return res.end('nf'); } const f = path.join(dist, p); try { res.writeHead(200, {...sec, 'Content-Type': mime[path.extname(f)] || 'application/octet-stream'}); return res.end(readFileSync(f)); } catch { res.writeHead(404, sec); return res.end(); } }
  res.writeHead(200, {...sec, 'Content-Type': mime['.html']}); res.end(readFileSync(path.join(dist, 'index.html')));
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const chrome = spawn('/usr/sbin/chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(work, 'profile')}`, 'about:blank'], {stdio: ['ignore', 'ignore', openSync(path.join(work, 'chromium.log'), 'w')], env: {...process.env, TMPDIR: path.join(work, 'tmp')}});
const cleanup = () => { try { chrome.kill(); } catch {} try { server.close(); } catch {} };
process.on('exit', cleanup);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 10000) { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t > ms) return null; await sleep(100); } }
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`); };
try {
  const targets = await until(async () => { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); return l.find(t => t.type === 'page') && l; }, 15000);
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(), events = [];
  ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, d => d.error ? rej(new Error(d.error.message)) : res(d.result)); ws.send(JSON.stringify({id: i, method, params})); });
  const ev = async e => (await send('Runtime.evaluate', {expression: e, awaitPromise: true, returnByValue: true})).result.value;
  await send('Page.enable'); await send('Runtime.enable');
  const visible = () => ev(`document.getElementById('root').innerText.trim()`);
  const open = async (m, a = true, url = '/') => { mode = m; assets = a; events.length = 0; await send('Page.navigate', {url: base + url}); await sleep(300); };
  const csp = () => events.filter(e => e.method === 'Runtime.consoleAPICalled' || e.method === 'Runtime.exceptionThrown').map(e => JSON.stringify(e.params).toLowerCase()).filter(s => s.includes('content security policy'));

  await open('html');
  ok('API отдаёт HTML 200: экран «Server bilan aloqa yo‘q» + причина', await until(async () => /Server bilan aloqa yo‘q/.test(await visible()) && /HTML/.test(await visible())), (await visible()).slice(0, 120).replace(/\n/g, ' | '));
  await open('setup503', true, '/login');
  ok('503 без DATABASE_URL: видно сообщение про DATABASE_URL и VERCEL-SETUP.md', await until(async () => /DATABASE_URL/.test(await visible()) && /VERCEL-SETUP/.test(await visible())));
  await open('notfound');
  ok('API 404 HTML: экран с кодом 404', await until(async () => /404/.test(await visible()) && /Server bilan aloqa/.test(await visible())));
  await open('hang');
  ok('API висит: сразу виден «Yuklanmoqda…», не пустой корень', await until(async () => /Yuklanmoqda/.test(await visible()), 3000));
  await open('html', false);
  const t = await visible();
  ok('Сломанные /assets/ (JS не загрузился): в корне запасной текст с подсказкой, не пусто', /Jenius yuklanmoqda/.test(t) && /assets/.test(t), t.slice(0, 100).replace(/\n/g, ' | '));
  ok('Запасной текст не нарушает CSP (нет inline style/script)', csp().filter(s => !s.includes('/assets/')).length === 0, String(csp().length) + ' CSP-сообщений');
  await open('html'); await sleep(500);
  ok('Нет нарушений CSP на нормальной загрузке', csp().length === 0);
  ok('Ни в одном сценарии корень не пуст (итог)', results.every(Boolean));
} catch (e) { console.error('ОШИБКА теста:', e.message); results.push(false); }
cleanup();
console.log(`${results.filter(Boolean).length}/${results.length} PASS`); process.exit(results.every(Boolean) ? 0 : 1);
