// Тестовая среда: НАСТОЯЩАЯ серверная функция Vercel (server/vercel.mjs, как api/index.mjs) за http-сервером,
// а хранилище — реальный PostgreSQL (PGlite). Cookie-«банку» и помощников берём из tests/helpers.mjs без изменений.
import http from 'node:http';
import {createVercelHandler} from '../server/vercel.mjs';
import {migratedPglite} from './pg-helpers.mjs';
import {T0} from './helpers.mjs';

export {T0};
// opts: driver (общая БД для нескольких функций), clock, limits, env, fetch, log, migrate=false (пустая база без схемы)
export async function bootPg(opts = {}) {
  const driver = opts.driver || (opts.migrate === false ? (await import('./pg-helpers.mjs')).pgliteDriver() : migratedPglite());
  const drv = await driver, clock = opts.clock || {t: T0}, logs = [];
  let handler;
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, host = `127.0.0.1:${port}`;
  handler = createVercelHandler({
    env: {DATABASE_URL: 'postgres://placeholder.invalid/db', VERCEL_URL: host, VERCEL_ENV: 'development', ...opts.env},
    createDriver: async () => drv, now: () => clock.t, scrypt: {N: 1024}, fetch: opts.fetch,
    log: m => { logs.push(String(m)); }, limits: {registerIp: 100000, loginPair: 5, loginIp: 100000, ...opts.limits}
  });
  return {
    handler, server, port, driver: drv, clock, logs, host, base: `http://${host}`, origin: `http://${host}`,
    close: async ({keepDb = false} = {}) => { await new Promise(r => { server.close(r); server.closeAllConnections(); }); if (!keepDb) await drv.close(); }
  };
}
// Прямое изменение состояния игрока в БД (аналог patchState из helpers.mjs, но SQL-ом в PostgreSQL).
export async function patchPg(env, name, fn, course = 'en') {
  const {rows: [row]} = await env.driver.query('SELECT p.state,u.id FROM progress p JOIN users u ON u.id=p.user_id WHERE u.username_key=$1', [name.toLowerCase()]);
  const stored = JSON.parse(row.state), F = ['tier', 'completed', 'passed', 'retryAt'];
  const flat = {...stored, ...Object.fromEntries(F.map(k => [k, stored.courses[course][k]]))};
  fn(flat);
  const s = {...flat}; s.courses = stored.courses; for (const k of F) { s.courses[course][k] = flat[k]; delete s[k]; }
  await env.driver.query('UPDATE progress SET state=$1,rev=rev+1 WHERE user_id=$2', [JSON.stringify(s), row.id]);
}
export const pgState = async (env, name) => JSON.parse((await env.driver.query('SELECT p.state FROM progress p JOIN users u ON u.id=p.user_id WHERE u.username_key=$1', [name.toLowerCase()])).rows[0].state);
