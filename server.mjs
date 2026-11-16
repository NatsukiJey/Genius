import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {createReadStream, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {openDb, makeTx} from './server/db.mjs';
import {HttpError, MSG, USERNAME_RE, validateCredentials, makeHasher, makeSessions, makeLimiter, makeHostCheck} from './server/auth.mjs';
import {makeGame} from './server/game.mjs';
import {sanitizeLocal} from './server/migrate-local.mjs';
import {freshState} from './shared/engine.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 16 * 1024, MIN = 60000, HOUR = 3600000, WIN15 = 15 * MIN;
// SPA-страницы: все отдают dist/index.html (React сам решает, что показать). /api/* сюда НИКОГДА не попадает.
const PAGES = new Set(['/', '/index.html', '/login', '/register']);
// Сборка Vite кладёт файлы только в /assets/<имя>.js|css. Слэшей в имени нет, поэтому обход каталога невозможен.
const ASSET_RE = /^\/assets\/[\w.-]+\.(js|css)$/;
const ASSET_TYPES = {js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8'};
// Только эти 6 путей и MIME; никакого поиска по каталогу, поэтому обход через .. невозможен.
const AUDIO = new Map([['/audio/background.mp3', 'audio/mpeg'], ['/audio/click.wav', 'audio/wav'], ['/audio/correct.wav', 'audio/wav'], ['/audio/lose.wav', 'audio/wav'], ['/audio/select.wav', 'audio/wav'], ['/audio/win.wav', 'audio/wav']]);
const CSP = "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

// opts: dbPath (':memory:' ok), now(), allowedHosts[], scrypt{N,r,p}, cookieSecure, trustProxy,
//       distDir (папка сборки Vite, по умолчанию ./dist), limits{loginPair,loginIp,registerIp}, telegram{token,chatId}, fetch, log
export function createServer(opts = {}) {
  const now = opts.now || Date.now;
  // Активный клиент — ТОЛЬКО собранный React (dist). Старая папка public/ (legacy) нигде не используется.
  const distDir = path.resolve(opts.distDir ?? path.join(root, 'dist'));
  const db = openDb(opts.dbPath ?? path.join(root, 'data', 'jenius.db')), tx = makeTx(db);
  const hasher = makeHasher({scrypt: opts.scrypt, concurrency: opts.hashConcurrency ?? 2, maxQueue: opts.hashQueue ?? 20});
  const sessions = makeSessions({db, tx, now, cookieSecure: !!opts.cookieSecure});
  const game = makeGame({db});
  const lim = makeLimiter(now), reportLim = new Map();
  const L = {loginPair: 5, loginIp: 30, registerIp: 5, ...opts.limits};
  const telegram = opts.telegram || {}, doFetch = opts.fetch || fetch, log = opts.log || (m => console.error(m));
  let server;
  const hostCheck = makeHostCheck({allowedHosts: opts.allowedHosts || [], getPort: () => server.address()?.port ?? 0});
  const userByKey = db.prepare('SELECT * FROM users WHERE username_key=?');
  const insUser = db.prepare('INSERT INTO users(username,username_key,pw_hash,pw_salt,pw_params,created_at) VALUES(?,?,?,?,?,?)');

  const clientIp = req => {
    if (opts.trustProxy) { const f = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim(); if (f) return f; }
    return req.socket.remoteAddress || '?';
  };
  const retry = (r) => new HttpError(429, 'Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring.', {retryAfter: r}, {'Retry-After': String(r)});
  const me = (id, t) => tx(() => game.me(id, t)).body;

  async function readJson(req) {
    if (Number(req.headers['content-length']) > MAX_BODY) throw new HttpError(413, 'So‘rov juda katta', {}, {Connection: 'close'});
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new HttpError(413, 'So‘rov juda katta', {}, {Connection: 'close'}); chunks.push(c); }
    let v; try { v = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON noto‘g‘ri'); }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'JSON obyekt bo‘lishi kerak');
    return v;
  }

  const handlers = {
    async register(ctx) {
      const {nick, pw} = validateCredentials(ctx.body.username, ctx.body.password), key = nick.toLowerCase();
      const rk = 'reg:' + ctx.ip, ra = lim.retryAfter(rk, L.registerIp, HOUR); if (ra) throw retry(ra);
      lim.hit(rk, HOUR);
      if (userByKey.get(key)) throw new HttpError(409, 'Bu login band');
      const h = await hasher.hash(pw); // scrypt — ДО транзакции
      const t = now();
      let imported = false, importNote = null, state = freshState();
      if (ctx.body.importLocal !== undefined && ctx.body.importLocal !== null) {
        const r = sanitizeLocal(ctx.body.importLocal, t);
        if (r.state) { state = r.state; imported = true; } else importNote = 'invalid';
      }
      let id, sess;
      try {
        ({id, sess} = tx(() => {
          const id = Number(insUser.run(nick, key, h.hash, h.salt, h.params, t).lastInsertRowid);
          game.createProgress(id, state, t);
          return {id, sess: sessions.create(id)};
        }));
      } catch (e) { if (/UNIQUE/i.test(String(e.message))) throw new HttpError(409, 'Bu login band'); throw e; }
      return {status: 200, cookie: sess.cookie, body: {...me(id, t), user: {username: nick}, imported, importNote}};
    },

    async login(ctx) {
      const {username, password} = ctx.body;
      if (typeof username !== 'string' || typeof password !== 'string' || username.length > 100 || password.length > 2048) throw new HttpError(400, MSG.badLogin);
      const key = username.normalize('NFKC').toLowerCase(), pk = `lp:${ctx.ip}|${key}`, ik = 'li:' + ctx.ip;
      // Резервируем попытку ДО scrypt: параллельные запросы считаются сразу, а не после хеша.
      const slot = lim.reserve([[pk, L.loginPair, WIN15], [ik, L.loginIp, WIN15]]);
      if (slot.retryAfter) throw retry(slot.retryAfter);
      let user;
      try {
        user = USERNAME_RE.test(key) ? userByKey.get(key) : null;
        const good = await hasher.verify(password.normalize('NFC'), user || null);
        slot.release(); // 503 от hasher не считается неудачей: уйдёт в finally без hit
        if (!good) { lim.hit(pk, WIN15); lim.hit(ik, WIN15); throw new HttpError(401, MSG.badLogin); }
        lim.clear(pk); // успех сбрасывает только записанные неудачи пары; чужие резервы остаются. login НИКОГДА не меняет прогресс
      } finally { slot.release(); }
      const t = now(), sess = tx(() => sessions.create(user.id));
      return {status: 200, cookie: sess.cookie, body: {...me(user.id, t), user: {username: user.username}}};
    },

    async logout(ctx) { sessions.destroy(ctx.token); return {status: 200, cookie: sessions.clearCookie(), body: {ok: true}}; },
    async me(ctx) { return {status: 200, body: {...me(ctx.auth.userId, now()), user: {username: ctx.auth.username}}}; },
    async course(ctx) { return wrap(ctx, 'course'); },
    async tier(ctx) { return wrap(ctx, 'tier'); },
    async start(ctx) { return wrap(ctx, 'start'); },
    async answer(ctx) { return wrap(ctx, 'answer'); },
    async retry(ctx) { return wrap(ctx, 'retry'); },
    async abandon(ctx) { return wrap(ctx, 'abandon'); },
    async buy(ctx) { return wrap(ctx, 'buy'); },

    // Google вход пока не настроен: честно сообщаем enabled:false. Никаких ключей/секретов в ответе.
    async providers() { return {status: 200, body: {google: {enabled: false}}}; },
    async report(ctx) {
      const message = typeof ctx.body.message === 'string' ? ctx.body.message.trim() : '';
      const t = now(); for (const [ip, time] of reportLim) if (t - time > MIN) reportLim.delete(ip);
      if (reportLim.has(ctx.ip)) throw new HttpError(429, 'Bir daqiqadan keyin qayta urinib ko‘ring.');
      if (message.length < 10 || message.length > 2000) throw new HttpError(400, 'Xabar 10–2000 belgidan iborat bo‘lsin.');
      if (!telegram.token || !telegram.chatId) throw new HttpError(503, 'Telegram hali sozlanmagan.');
      reportLim.set(ctx.ip, t);
      try {
        const up = await doFetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({chat_id: telegram.chatId, text: `🐛 Jenius — xatolik xabari\n\n${message}`}), signal: AbortSignal.timeout(12000)});
        const r = await up.json();
        if (!r.ok) throw 0;
        return {status: 200, body: {ok: true, messageId: r.result.message_id}};
      } catch { throw new HttpError(502, 'Xabar yuborilmadi. Internetni tekshirib qayta urinib ko‘ring.'); }
    }
  };
  function wrap(ctx, name) { const r = tx(() => game[name](ctx.auth.userId, ctx.body, now())); return {status: r.status, body: r.body}; }

  // method+path -> [handler, needsAuth]
  const routes = {
    'GET /api/me': ['me', true], 'POST /api/register': ['register'], 'POST /api/login': ['login'], 'POST /api/logout': ['logout'],
    'POST /api/course': ['course', true], 'POST /api/tier': ['tier', true], 'POST /api/lesson/start': ['start', true], 'POST /api/lesson/answer': ['answer', true],
    'POST /api/lesson/retry': ['retry', true], 'POST /api/lesson/abandon': ['abandon', true], 'POST /api/shop/buy': ['buy', true],
    'POST /api/report': ['report'], 'GET /api/auth/providers': ['providers']
  };
  const apiPaths = new Set(Object.keys(routes).map(k => k.split(' ')[1]));

  function send(res, status, body, headers = {}) {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers});
    res.end(JSON.stringify(body));
  }

  async function api(req, res, pathname) {
    const route = routes[`${req.method} ${pathname}`];
    if (!route) { if (apiPaths.has(pathname)) return send(res, 405, {error: 'Method not allowed'}, {Allow: 'GET, POST'}); return send(res, 404, {error: 'Not found'}); }
    try {
      const ctx = {ip: clientIp(req), body: {}, token: sessions.tokenFrom(req)};
      if (req.method === 'POST') {
        if (!hostCheck.originOk(req) || req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Origin ruxsat etilmagan');
        if (!/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) throw new HttpError(415, 'Content-Type application/json bo‘lishi kerak');
        ctx.body = await readJson(req);
      }
      let cookie;
      if (route[1]) {
        ctx.auth = sessions.lookup(ctx.token);
        if (!ctx.auth) throw new HttpError(401, 'Kirish talab qilinadi', {}, {'Set-Cookie': sessions.clearCookie()});
        cookie = ctx.auth.cookie;
      }
      const r = await handlers[route[0]](ctx);
      cookie = r.cookie || cookie;
      send(res, r.status, r.body, cookie ? {'Set-Cookie': cookie} : {});
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, e.body, e.headers);
      log(`server error: ${e && e.name}: ${e && e.message}`); // тела запросов и пароли не логируем
      send(res, 500, {error: 'Server xatosi'});
    }
  }

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
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', CSP);
    if (!hostCheck.hostOk(req)) { res.writeHead(421, {'Content-Type': 'text/plain; charset=utf-8'}); return res.end('Misdirected Request'); }
    let pathname; try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { res.writeHead(400); return res.end(); }
    if (pathname.startsWith('/api/')) return api(req, res, pathname);
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

  server = http.createServer((req, res) => { handle(req, res).catch(e => { log(`server error: ${e && e.name}`); if (!res.headersSent) res.writeHead(500); res.end(); }); });
  return {
    server, db,
    listen: (port = 0, host = '127.0.0.1') => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server.address().port)); }),
    close: () => new Promise(resolve => { server.close(() => { try { db.close(); } catch {} resolve(); }); server.closeAllConnections(); })
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
