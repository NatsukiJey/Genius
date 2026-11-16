import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {createReadStream, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {openSqliteStore} from './server/store-sqlite.mjs';
import {createApp, securityHeaders} from './server/app.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
// SPA-страницы: все отдают dist/index.html (React сам решает, что показать). /api/* сюда НИКОГДА не попадает.
const PAGES = new Set(['/', '/index.html', '/login', '/register']);
// Сборка Vite кладёт файлы только в /assets/<имя>.js|css. Слэшей в имени нет, поэтому обход каталога невозможен.
const ASSET_RE = /^\/assets\/[\w.-]+\.(js|css)$/;
const ASSET_TYPES = {js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8'};
// Только эти 6 путей и MIME; никакого поиска по каталогу, поэтому обход через .. невозможен.
const AUDIO = new Map([['/audio/background.mp3', 'audio/mpeg'], ['/audio/click.wav', 'audio/wav'], ['/audio/correct.wav', 'audio/wav'], ['/audio/lose.wav', 'audio/wav'], ['/audio/select.wav', 'audio/wav'], ['/audio/win.wav', 'audio/wav']]);

// opts: dbPath (':memory:' ok), now(), allowedHosts[], scrypt{N,r,p}, cookieSecure, trustProxy,
//       distDir (папка сборки Vite, по умолчанию ./dist), limits{loginPair,loginIp,registerIp}, telegram{token,chatId}, fetch, log
export function createServer(opts = {}) {
  // Активный клиент — ТОЛЬКО собранный React (dist). Старая папка public/ (legacy) нигде не используется.
  const distDir = path.resolve(opts.distDir ?? path.join(root, 'dist'));
  // Локально хранилище — SQLite (файл data/jenius.db). Вся логика API — в server/app.mjs (её же использует Vercel-функция).
  const store = openSqliteStore(opts.dbPath ?? path.join(root, 'data', 'jenius.db'));
  let server;
  const app = createApp({...opts, store, getPort: () => server.address()?.port ?? 0, hostLocal: true});
  const {hostCheck} = app;

  // Один байтовый диапазон: a-b, a- или -n. Несколько диапазонов/кривой заголовок -> весь файл (200).
  function parseRange(h, size) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(h || '').trim());
    if (!m || (m[1] === '' && m[2] === '')) return null;
    if (m[1] === '') { const n = Number(m[2]); if (n === 0) return 'bad'; return n >= size ? null : {start: size - n, end: size - 1}; }
    const start = Number(m[1]); let end = m[2] === '' ? size - 1 : Number(m[2]);
    if (m[2] !== '' && end < start) return null;
    if (start >= size) return 'bad';
    return {start, end: Math.min(end, size - 1)};
  }
  async function serveAudio(req, res, pathname) {
    const file = path.join(distDir, pathname.slice(1));
    let size; try { size = (await stat(file)).size; } catch { res.writeHead(404); return res.end('Not found'); }
    const base = {'Content-Type': AUDIO.get(pathname), 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600'};
    const range = req.headers.range ? parseRange(req.headers.range, size) : null;
    if (range === 'bad') { res.writeHead(416, {...base, 'Content-Range': `bytes */${size}`, 'Content-Length': 0}); return res.end(); }
    const r = range || {start: 0, end: size - 1};
    res.writeHead(range ? 206 : 200, {...base, 'Content-Length': size ? r.end - r.start + 1 : 0, ...(range ? {'Content-Range': `bytes ${r.start}-${r.end}/${size}`} : {})});
    if (req.method === 'HEAD' || !size) return res.end();
    const stream = createReadStream(file, {start: r.start, end: r.end});
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  async function handle(req, res) {
    securityHeaders(res);
    if (!hostCheck.hostOk(req)) { res.writeHead(421, {'Content-Type': 'text/plain; charset=utf-8'}); return res.end('Misdirected Request'); }
    let pathname; try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { res.writeHead(400); return res.end(); }
    if (pathname.startsWith('/api/')) return app.api(req, res, pathname);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    if (AUDIO.has(pathname)) return serveAudio(req, res, pathname);
    if (ASSET_RE.test(pathname)) return serveDist(req, res, pathname.slice(1), ASSET_TYPES[pathname.split('.').pop()], 'public, max-age=31536000, immutable');
    if (PAGES.has(pathname)) return serveDist(req, res, 'index.html', 'text/html; charset=utf-8', 'no-cache');
    res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'}); res.end('Not found');
  }

  // Отдаёт один файл из dist. resolve+startsWith — второй замок поверх регулярки.
  async function serveDist(req, res, rel, type, cache) {
    try {
      const file = path.resolve(distDir, rel);
      if (!file.startsWith(distDir + path.sep)) throw new Error('outside');
      const bytes = await readFile(file);
      res.writeHead(200, {'Content-Type': type, 'Cache-Control': cache, 'Content-Length': bytes.length});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'}); res.end(req.method === 'HEAD' ? undefined : 'Not found'); }
  }

  server = http.createServer((req, res) => { handle(req, res).catch(e => { app.log(`server error: ${e && e.name}`); if (!res.headersSent) res.writeHead(500); res.end(); }); });
  return {
    server, db: store.db,
    listen: (port = 0, host = '127.0.0.1') => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server.address().port)); }),
    close: () => new Promise(resolve => { server.close(() => { app.close(); resolve(); }); server.closeAllConnections(); })
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const distDir = path.join(root, 'dist');
  // В разработке (npm run dev:server) клиент отдаёт Vite, поэтому dist не нужен: JENIUS_DEV=1.
  if (process.env.JENIUS_DEV !== '1' && !existsSync(path.join(distDir, 'index.html'))) {
    console.error('XATO: dist/index.html topilmadi. Avval `npm run build` ni ishga tushiring (React klientni yig‘ish).');
    process.exit(1);
  }
  // Токен и chat id берём из переменных окружения; файл telegram-config.json (в .gitignore) — запасной вариант.
  let telegram = {}; try { telegram = JSON.parse(await readFile(path.join(root, 'telegram-config.json'), 'utf8')); } catch {}
  if (process.env.TELEGRAM_BOT_TOKEN) telegram = {...telegram, token: process.env.TELEGRAM_BOT_TOKEN};
  if (process.env.TELEGRAM_CHAT_ID) telegram = {...telegram, chatId: process.env.TELEGRAM_CHAT_ID};
  const port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1';
  const app = createServer({
    dbPath: process.env.DB_PATH || path.join(root, 'data', 'jenius.db'), telegram, distDir,
    allowedHosts: (process.env.ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
    cookieSecure: process.env.COOKIE_SECURE === '1', trustProxy: process.env.TRUST_PROXY === '1'
  });
  await app.listen(port, host);
  console.log(`Jenius ready: http://${host}:${port}`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) console.warn('DIQQAT: server tarmoqqa ochiq. HTTPS bo‘lmasa parol va cookie ochiq yuboriladi. README’ni o‘qing.');
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
}
