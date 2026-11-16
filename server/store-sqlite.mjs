// Локальное хранилище: SQLite (node:sqlite). Этот файл грузится ТОЛЬКО локальным server.mjs, никогда функцией Vercel.
// Одно соединение, а внутри транзакции теперь есть await, поэтому ВСЕ операции идут через один мьютекс (очередь):
// пока открыта транзакция, никакой другой запрос к базе не вклинивается.
import {openDb} from './db.mjs';
import {makeRepo} from './repo.mjs';
import {makeMemoryLimiter} from './limiter.mjs';

export function openSqliteStore(dbPath) {
  const db = openDb(dbPath), cache = new Map();
  const exec = async (sql, params = []) => {
    let st = cache.get(sql); if (!st) { st = db.prepare(sql); cache.set(sql, st); }
    return st.all(...params.map(v => v === undefined ? null : v));
  };
  const direct = makeRepo(exec, {pg: false});
  let tail = Promise.resolve();
  const lock = fn => { const run = tail.then(() => fn()); tail = run.then(() => {}, () => {}); return run; };
  const repo = Object.fromEntries(Object.entries(direct).map(([k, f]) => [k, (...a) => lock(() => f(...a))]));
  return {
    kind: 'sqlite', db, repo,
    tx: fn => lock(async () => {
      db.exec('BEGIN IMMEDIATE');
      try { const r = await fn(direct); db.exec('COMMIT'); return r; }
      catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
    }),
    makeLimiter: now => makeMemoryLimiter(now),
    close: () => { try { db.close(); } catch {} }
  };
}
