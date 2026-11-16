// Общее ядро API (/api/*): им пользуются и локальный server.mjs (SQLite), и функция Vercel api/index.mjs (PostgreSQL).
// Здесь НЕТ ни http.createServer, ни node:sqlite, ни записи на диск. Хранилище приходит снаружи (opts.store).
import {HttpError, MSG, USERNAME_RE, validateCredentials, makeHasher, makeSessions, makeHostCheck} from './auth.mjs';
import {makeGame} from './game.mjs';
import {sanitizeLocal} from './migrate-local.mjs';
import {freshState} from '../shared/engine.mjs';

export const MAX_BODY = 16 * 1024;
const MIN = 60000, HOUR = 3600000, WIN15 = 15 * MIN;
export const CSP = "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
export function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('Content-Security-Policy', CSP);
}

// Секреты никогда не попадают в логи: вырезаем адреса баз, токены Telegram и точные значения из окружения.
export function redact(text, secrets = []) {
  let t = String(text ?? '');
  const parts = [];
  for (const s of secrets) {
    if (!s) continue; const v = String(s); if (v.length >= 6) parts.push(v);
    try { const u = new URL(v); for (const p of [u.hostname, u.username, decodeURIComponent(u.password)]) if (p) parts.push(p); } catch {} // части адреса БД: хост, логин, пароль
  }
  for (const s of parts) if (s.length >= 3) t = t.split(s).join('[hidden]');
  return t.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, '[url]').replace(/bot\d{6,}:[\w-]{20,}/g, 'bot[hidden]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}\b/g, '[addr]').replace(/\[[0-9a-f:]+\]:\d{1,5}/gi, '[addr]'); // IP:порт из сообщений драйвера
}

// IPv4 как есть; IPv6 -> префикс /64 (один клиент легко меняет младшие 64 бита). Мусор -> 'unknown' (общий ключ, строже).
export function ipKey(raw) {
  const v = String(raw || '').split(',')[0].trim().toLowerCase();
  if (!/^[0-9a-f:.]{2,45}$/.test(v)) return 'unknown';
  const m4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v); if (m4) return m4[1];
  if (!v.includes(':')) return /^\d{1,3}(\.\d{1,3}){3}$/.test(v) ? v : 'unknown';
  let [head, tail = null] = v.split('::'); if (v.split('::').length > 2) return 'unknown';
  const h = head ? head.split(':') : [], t = tail === null ? [] : (tail ? tail.split(':') : []);
  if (tail === null && h.length !== 8) return 'unknown';
  const g = tail === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  if (g.length !== 8 || g.some(x => !/^[0-9a-f]{1,4}$/.test(x))) return 'unknown';
  return g.slice(0, 4).map(x => x.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

// Ошибки базы -> честные 503 (без текста ошибки и без адреса базы).
export function dbHttpError(e) {
  const code = String(e && e.code || '');
  if (code === '42P01') return new HttpError(503, 'Baza sxemasi tayyor emas: `npm run db:migrate` ni bir marta ishga tushiring (VERCEL-SETUP.md).');
  if (/^(08|28|3D|53|57)/.test(code) || /^(ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ENETUNREACH)/.test(code) || /timeout|Connection terminated/i.test(String(e && e.message))) return new HttpError(503, 'Baza vaqtincha mavjud emas. Birozdan keyin urinib ko‘ring.', {}, {'Retry-After': '5'});
  return null;
}

// opts: store (обязателен), now(), scrypt{N,r,p}, limits{loginPair,loginIp,registerIp}, limiter, telegram{token,chatId}, fetch, log,
//       cookieSecure, trustProxy, ipHeader (напр. 'x-real-ip' на Vercel), allowedHosts[], hostLocal, httpsOnly, getPort, secrets[]
export function createApp(opts) {
  const {store} = opts, now = opts.now || Date.now;
  const hasher = makeHasher({scrypt: opts.scrypt, concurrency: opts.hashConcurrency ?? 2, maxQueue: opts.hashQueue ?? 20});
  const sessions = makeSessions({store, now, cookieSecure: !!opts.cookieSecure});
  const game = makeGame(), lim = opts.limiter || store.makeLimiter(now);
  const L = {loginPair: 5, loginIp: 30, registerIp: 5, ...opts.limits};
  const telegram = opts.telegram || {}, doFetch = opts.fetch || fetch;
  const secrets = [...(opts.secrets || []), telegram.token, telegram.chatId];
  const log = opts.log || (m => console.error(m));
  const hostCheck = makeHostCheck({allowedHosts: opts.allowedHosts || [], getPort: opts.getPort || (() => 0), local: opts.hostLocal !== false, httpsOnly: !!opts.httpsOnly});

  const clientIp = req => {
    if (opts.ipHeader) return ipKey(req.headers[opts.ipHeader]);
    if (opts.trustProxy) { const f = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim(); if (f) return f; }
    return req.socket?.remoteAddress || '?';
  };
  const retry = r => new HttpError(429, 'Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring.', {retryAfter: r}, {'Retry-After': String(r)});
  const me = (id, t) => store.tx(async repo => (await game.me(repo, id, t)).body);

  // Тело запроса. Vercel может уже прочитать поток и положить результат в req.body (Buffer/строка/объект): тогда берём его.
  async function readJson(req) {
    const tooBig = () => new HttpError(413, 'So‘rov juda katta', {}, {Connection: 'close'});
    if (Number(req.headers['content-length']) > MAX_BODY) throw tooBig();
    let v;
    if (req.readableEnded || req.complete && req.readable === false) {
      let b; try { b = req.body; } catch { throw new HttpError(400, 'JSON noto‘g‘ri'); }
      if (b === undefined || b === null) throw new HttpError(400, 'JSON noto‘g‘ri');
      if (Buffer.isBuffer(b) || typeof b === 'string') { if (Buffer.byteLength(b) > MAX_BODY) throw tooBig(); try { v = JSON.parse(Buffer.from(b).toString('utf8')); } catch { throw new HttpError(400, 'JSON noto‘g‘ri'); } }
      else { if (Buffer.byteLength(JSON.stringify(b) ?? '') > MAX_BODY) throw tooBig(); v = b; }
    } else {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > MAX_BODY) throw tooBig(); chunks.push(c); }
      try { v = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON noto‘g‘ri'); }
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'JSON obyekt bo‘lishi kerak');
    return v;
  }

  const handlers = {
    async register(ctx) {
      const {nick, pw} = validateCredentials(ctx.body.username, ctx.body.password), key = nick.toLowerCase();
      const ra = await lim.consume('reg:' + ctx.ip, L.registerIp, HOUR); if (ra) throw retry(ra);
      if (await store.repo.userByKey(key)) throw new HttpError(409, 'Bu login band');
      const h = await hasher.hash(pw); // scrypt — ДО транзакции
      const t = now();
      let imported = false, importNote = null, state = freshState();
      if (ctx.body.importLocal !== undefined && ctx.body.importLocal !== null) {
        const r = sanitizeLocal(ctx.body.importLocal, t);
        if (r.state) { state = r.state; imported = true; } else importNote = 'invalid';
      }
      const {id, sess} = await store.tx(async repo => {
        const id = await repo.insertUser({nick, key, hash: h.hash, salt: h.salt, params: h.params, t});
        if (id === null) throw new HttpError(409, 'Bu login band'); // одновременная регистрация того же ника
        await game.createProgress(repo, id, state, t);
        return {id, sess: await sessions.create(id, repo)};
      });
      return {status: 200, cookie: sess.cookie, body: {...await me(id, t), user: {username: nick}, imported, importNote}};
    },

    async login(ctx) {
      const {username, password} = ctx.body;
      if (typeof username !== 'string' || typeof password !== 'string' || username.length > 100 || password.length > 2048) throw new HttpError(400, MSG.badLogin);
      const key = username.normalize('NFKC').toLowerCase(), pk = `lp:${ctx.ip}|${key}`, ik = 'li:' + ctx.ip;
      // Резервируем попытку ДО scrypt: параллельные запросы считаются сразу, а не после хеша.
      const slot = await lim.reserve([[pk, L.loginPair, WIN15], [ik, L.loginIp, WIN15]]);
      if (slot.retryAfter) throw retry(slot.retryAfter);
      let user;
      try {
        user = USERNAME_RE.test(key) ? await store.repo.userByKey(key) : null;
        const good = await hasher.verify(password.normalize('NFC'), user || null);
        // 503 от hasher не считается неудачей: уйдёт в finally без hit. Успех сбрасывает только записанные неудачи пары.
        if (!good) { await slot.done({hit: [[pk, WIN15], [ik, WIN15]]}); throw new HttpError(401, MSG.badLogin); }
        await slot.done({clear: [pk]}); // login НИКОГДА не меняет прогресс
      } finally { await slot.release(); }
      const t = now(), sess = await store.tx(repo => sessions.create(user.id, repo));
      return {status: 200, cookie: sess.cookie, body: {...await me(user.id, t), user: {username: user.username}}};
    },

    async logout(ctx) { await sessions.destroy(ctx.token); return {status: 200, cookie: sessions.clearCookie(), body: {ok: true}}; },
    async me(ctx) { return {status: 200, body: {...await me(ctx.auth.userId, now()), user: {username: ctx.auth.username}}}; },
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
      const rk = 'rp:' + ctx.ip, tooMany = new HttpError(429, 'Bir daqiqadan keyin qayta urinib ko‘ring.');
      if (await lim.retryAfter(rk, 1, MIN)) throw tooMany;
      if (message.length < 10 || message.length > 2000) throw new HttpError(400, 'Xabar 10–2000 belgidan iborat bo‘lsin.');
      if (!telegram.token || !telegram.chatId) throw new HttpError(503, 'Telegram hali sozlanmagan.');
      if (await lim.consume(rk, 1, MIN)) throw tooMany; // проверка + запись одним атомарным шагом
      try {
        const up = await doFetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({chat_id: telegram.chatId, text: `🐛 Jenius — xatolik xabari\n\n${message}`}), signal: AbortSignal.timeout(12000)});
        const r = await up.json();
        if (!r.ok) throw 0;
        return {status: 200, body: {ok: true, messageId: r.result.message_id}};
      } catch { throw new HttpError(502, 'Xabar yuborilmadi. Internetni tekshirib qayta urinib ko‘ring.'); }
    }
  };
  async function wrap(ctx, name) { const r = await store.tx(repo => game[name](repo, ctx.auth.userId, ctx.body, now())); return {status: r.status, body: r.body}; }

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
        ctx.auth = await sessions.lookup(ctx.token);
        if (!ctx.auth) throw new HttpError(401, 'Kirish talab qilinadi', {}, {'Set-Cookie': sessions.clearCookie()});
        cookie = ctx.auth.cookie;
      }
      const r = await handlers[route[0]](ctx);
      cookie = r.cookie || cookie;
      send(res, r.status, r.body, cookie ? {'Set-Cookie': cookie} : {});
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, e.body, e.headers);
      const d = dbHttpError(e);
      log(`server error: ${e && e.name}${e && e.code ? ' ' + e.code : ''}: ${redact(e && e.message, secrets)}`); // тела запросов, пароли и адреса баз не логируем
      if (d) return send(res, d.status, d.body, d.headers);
      send(res, 500, {error: 'Server xatosi'});
    }
  }

  return {api, hostCheck, store, log, secrets, close: () => store.close()};
}
