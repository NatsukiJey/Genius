// Адаптер Vercel: превращает серверную функцию (req, res) в вызов того же ядра API (server/app.mjs), что и локальный сервер.
// Важно для serverless: нет server.listen, нет записи на диск, нет node:sqlite (этот файл его не импортирует),
// хранилище — ТОЛЬКО PostgreSQL по DATABASE_URL. Без DATABASE_URL честный 503, а не «память» или временный SQLite.
import {createApp, securityHeaders, redact} from './app.mjs';
import {makeHostCheck} from './auth.mjs';
import {makePgStore, pgPoolDriver} from './store-pg.mjs';

const bareHost = v => String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
// Разрешённые хосты: явный ALLOWED_HOSTS + точные адреса, которые Vercel сам кладёт в окружение. Подстановки (*) отбрасываются.
export function vercelHosts(env) {
  const list = [...String(env.ALLOWED_HOSTS || '').split(','), env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL].map(bareHost);
  return [...new Set(list.filter(h => /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(h)))];
}

export const SETUP_503 = {error: 'Baza ulanmagan: Vercel loyihasida DATABASE_URL sozlanmagan. VERCEL-SETUP.md dagi qadamlarni bajaring.', setup: 'database_url_missing'};

// opts (для тестов): env, createDriver() -> драйвер БД, now, scrypt, fetch, log, limits
export function createVercelHandler(opts = {}) {
  const env = opts.env || process.env, log = opts.log || (m => console.error(m));
  const hosts = vercelHosts(env), httpsOnly = env.VERCEL_ENV !== 'development';
  const hostCheck = makeHostCheck({allowedHosts: hosts, local: false, httpsOnly});
  const secrets = [env.DATABASE_URL, env.DATABASE_URL_UNPOOLED, env.POSTGRES_URL, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID];
  let appPromise = null;
  const getApp = () => appPromise ||= (async () => {
    const driver = await (opts.createDriver ? opts.createDriver() : pgPoolDriver(env.DATABASE_URL));
    return createApp({
      store: makePgStore(driver), now: opts.now, scrypt: opts.scrypt, fetch: opts.fetch, limits: opts.limits, log, secrets,
      allowedHosts: hosts, hostLocal: false, httpsOnly, ipHeader: 'x-real-ip',
      cookieSecure: env.COOKIE_SECURE !== '0', // на Vercel Secure-cookie по умолчанию
      telegram: {token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID}
    });
  })().catch(e => { appPromise = null; throw e; });

  const json = (res, status, body) => { res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(body)); };
  async function handler(req, res) {
    securityHeaders(res);
    if (!hostCheck.hostOk(req)) { res.writeHead(421, {'Content-Type': 'text/plain; charset=utf-8'}); return res.end('Misdirected Request'); }
    let pathname; try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { res.writeHead(400); return res.end(); }
    if (!pathname.startsWith('/api/')) return json(res, 404, {error: 'Not found'}); // страницы и аудио отдаёт Vercel из dist
    if (!opts.createDriver && !env.DATABASE_URL) return json(res, 503, SETUP_503);
    try { return await (await getApp()).api(req, res, pathname); }
    catch (e) { log(`server error: ${e && e.name}${e && e.code ? ' ' + e.code : ''}: ${redact(e && e.message, secrets)}`); if (!res.headersSent) json(res, 500, {error: 'Server xatosi'}); else res.end(); }
  }
  handler.close = async () => { if (appPromise) { try { (await appPromise).close(); } catch {} } };
  return handler;
}
