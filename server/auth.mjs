// Пароли (scrypt), сессии, cookie, защита от перебора, проверка Host/Origin.
import crypto from 'node:crypto';
import {nicknameAllowed} from './nickname.mjs';

export class HttpError extends Error {
  constructor(status, error, extra = {}, headers = {}) { super(error); this.status = status; this.body = {error, ...extra}; this.headers = headers; }
}
export const MSG = {badLogin: 'Login yoki parol noto‘g‘ri', badNick: 'Bu nik qabul qilinmaydi'};
export const SESSION_MS = 30 * 86400000, TOUCH_MS = 86400000;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
export const PW_MIN = 8, PW_MAX = 256;

export function validateCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Login va parol matn bo‘lishi kerak');
  if (username.length > 100 || password.length > 2048) throw new HttpError(400, 'Juda uzun ma’lumot');
  const nick = username.normalize('NFKC');
  if (!USERNAME_RE.test(nick)) throw new HttpError(400, 'Login 3–20 ta lotin harfi, raqam yoki _ bo‘lsin');
  const pw = password.normalize('NFC'), len = [...pw].length;
  if (len < PW_MIN) throw new HttpError(400, `Parol kamida ${PW_MIN} belgidan iborat bo‘lsin`);
  if (len > PW_MAX) throw new HttpError(400, `Parol ${PW_MAX} belgidan oshmasin`);
  if (pw.toLowerCase() === nick.toLowerCase()) throw new HttpError(400, 'Parol login bilan bir xil bo‘lmasin');
  if (!nicknameAllowed(nick)) throw new HttpError(400, MSG.badNick);
  return {nick, pw};
}

// Не больше `max` одновременных scrypt (у ноутбука 2 ядра); длинная очередь -> 503.
export function makeHasher({scrypt = {}, concurrency = 2, maxQueue = 20} = {}) {
  const params = {N: scrypt.N ?? 2 ** 15, r: scrypt.r ?? 8, p: scrypt.p ?? 1, keylen: 32};
  let running = 0; const queue = [];
  const run = (pw, salt, prm) => new Promise((resolve, reject) => {
    const maxmem = Math.max(64 * 1024 * 1024, 256 * prm.N * prm.r);
    crypto.scrypt(pw, salt, prm.keylen, {N: prm.N, r: prm.r, p: prm.p, maxmem}, (e, key) => e ? reject(e) : resolve(key));
  });
  const slot = () => new Promise((resolve, reject) => {
    if (running < concurrency) { running++; return resolve(); }
    if (queue.length >= maxQueue) return reject(new HttpError(503, 'Server band, birozdan keyin urinib ko‘ring', {}, {'Retry-After': '5'}));
    queue.push(resolve);
  });
  const release = () => { const next = queue.shift(); if (next) next(); else running--; };
  async function limited(fn) { await slot(); try { return await fn(); } finally { release(); } }
  const dummySalt = crypto.randomBytes(16);
  return {
    params,
    hash: pw => limited(async () => { const salt = crypto.randomBytes(16); return {salt, hash: await run(pw, salt, params), params: JSON.stringify(params)}; }),
    async verify(pw, user) { // user может быть null: тогда считаем по фиктивной соли (одинаковое время)
      const prm = user ? JSON.parse(user.pw_params) : params;
      const key = await limited(() => run(pw, user ? Buffer.from(user.pw_salt) : dummySalt, prm));
      return !!user && key.length === user.pw_hash.length && crypto.timingSafeEqual(key, Buffer.from(user.pw_hash));
    }
  };
}

export const sha256 = t => crypto.createHash('sha256').update(t).digest();

export function makeSessions({store, now, cookieSecure}) {
  const NAME = cookieSecure ? '__Host-jenius_sid' : 'jenius_sid';
  const cookieStr = (token, maxAge) => `${NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${cookieSecure ? '; Secure' : ''}`;
  return {
    cookieStr, NAME,
    // Вызывать внутри транзакции: repo — репозиторий этой транзакции. Блокировка строки игрока не даёт двум входам
    // одновременно «подрезать» список сессий (максимум 10 на игрока).
    async create(userId, repo) { // каждый вход — новый токен; в БД только sha256
      const token = crypto.randomBytes(32).toString('base64url'), t = now();
      await repo.lockUser(userId);
      await repo.purgeSessions(t); await repo.insSession(sha256(token), userId, t, t + SESSION_MS); await repo.capSessions(userId);
      return {token, cookie: cookieStr(token, SESSION_MS / 1000)};
    },
    tokenFrom(req) {
      for (const part of String(req.headers.cookie || '').split(';')) {
        const i = part.indexOf('='); if (i < 0) continue;
        if (part.slice(0, i).trim() === NAME) { const v = part.slice(i + 1).trim(); return /^[A-Za-z0-9_-]{20,64}$/.test(v) ? v : null; }
      }
      return null;
    },
    // -> {userId, username, cookie?} | null. Каждый шаг — один SQL-запрос; повторы (два запроса сразу) безопасны:
    // продление и удаление просроченной сессии идемпотентны.
    async lookup(token) {
      if (!token) return null;
      const h = sha256(token), row = await store.repo.session(h), t = now();
      if (!row) return null;
      const expires = Number(row.expires_at), seen = Number(row.last_seen);
      if (expires <= t) { await store.repo.delSession(h); return null; }
      let cookie;
      if (t - seen > TOUCH_MS) { await store.repo.touchSession(t, t + SESSION_MS, h); cookie = cookieStr(token, SESSION_MS / 1000); }
      return {userId: Number(row.user_id), username: row.username, cookie};
    },
    async destroy(token) { if (token) await store.repo.delSession(sha256(token)); },
    clearCookie: () => cookieStr('', 0)
  };
}

// Ограничитель в памяти (сбрасывается при рестарте). Размер Map ограничен.
export function makeLimiter(now, maxKeys = 5000) {
  const m = new Map(), inflight = new Map(); // inflight ограничен числом одновременных запросов
  const prune = t => { for (const [k, v] of m) { v.hits = v.hits.filter(x => t - x < v.win); if (!v.hits.length) m.delete(k); } };
  return {
    retryAfter(key, max, win) { // секунды ожидания, 0 = можно
      const v = m.get(key), t = now(); if (!v) return 0;
      v.hits = v.hits.filter(x => t - x < win); v.win = win;
      return v.hits.length >= max ? Math.ceil((v.hits[0] + win - t) / 1000) : 0;
    },
    hit(key, win) {
      const t = now(); if (m.size >= maxKeys && !m.has(key)) prune(t);
      if (m.size >= maxKeys && !m.has(key)) m.delete(m.keys().next().value);
      const v = m.get(key) || {hits: [], win}; v.win = win; v.hits.push(t); m.set(key, v);
    },
    clear: key => m.delete(key), // убирает только записанные неудачи; резервы (inflight) не трогает
    // Резерв ДО долгой работы (scrypt): активные попытки считаются наравне с прошлыми неудачами,
    // поэтому пачка параллельных запросов не обгонит лимит. specs = [[key,max,win],...]; проверка и резерв — синхронно (атомарно).
    // -> {retryAfter} при отказе, иначе {release()} (идемпотентный; вызвать в finally).
    reserve(specs) {
      const t = now();
      for (const [key, max, win] of specs) {
        const v = m.get(key), hits = v ? v.hits.filter(x => t - x < win) : [], n = hits.length + (inflight.get(key) || 0);
        if (n >= max) return {retryAfter: hits.length ? Math.ceil((hits[0] + win - t) / 1000) : 1};
      }
      for (const [key] of specs) inflight.set(key, (inflight.get(key) || 0) + 1);
      let done = false;
      return {release() {
        if (done) return; done = true;
        for (const [key] of specs) { const n = (inflight.get(key) || 1) - 1; if (n > 0) inflight.set(key, n); else inflight.delete(key); }
      }};
    }
  };
}

// Host/Origin. По умолчанию (локально): 127.0.0.1/localhost/[::1] с портом сервера + ALLOWED_HOSTS.
// Vercel: local=false (только явный список, без localhost), httpsOnly=true (Origin обязан быть https://).
// Точное совпадение: никаких подстановок вроде *.vercel.app.
export function makeHostCheck({allowedHosts = [], getPort = () => 0, local = true, httpsOnly = false}) {
  const extra = allowedHosts.map(h => h.toLowerCase());
  const hosts = () => { const p = getPort(); return new Set([...(local ? [`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`] : []), ...extra]); };
  return {
    hostOk: req => hosts().has(String(req.headers.host || '').toLowerCase()),
    originOk: req => { // Origin обязателен для POST и должен быть http(s):// + разрешённый хост
      const o = String(req.headers.origin || '').toLowerCase(); if (!o) return false;
      const set = hosts(); return [...set].some(h => o === `https://${h}` || (!httpsOnly && o === `http://${h}`));
    }
  };
}
