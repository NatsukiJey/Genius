// Хранилище PostgreSQL (Neon). Работает через маленький «драйвер»:
//   driver.query(sql, params) -> {rows}          (одиночный запрос, autocommit)
//   driver.transaction(async tx => ..)           (tx.query / tx.exec; BEGIN..COMMIT/ROLLBACK делает драйвер)
// Боевой драйвер — pg.Pool (pgPoolDriver), в тестах — настоящий PostgreSQL в WASM (PGlite) с тем же интерфейсом.
// Блокировки: прогресс читается FOR UPDATE (строка игрока заблокирована до конца транзакции),
// счётчики попыток — pg_advisory_xact_lock (см. limiter.mjs), миграции — один общий advisory-lock.
import {makeRepo} from './repo.mjs';
import {makePgLimiter} from './limiter.mjs';

const toPg = sql => { let n = 0; return sql.replace(/\?/g, () => `$${++n}`); };
const norm = r => r.rows;

export function makePgStore(driver) {
  const exec = (q) => async (sql, params = []) => norm(await q(toPg(sql), params.map(v => v === undefined ? null : v)));
  const repo = makeRepo(exec((s, p) => driver.query(s, p)), {pg: true});
  return {
    kind: 'pg', repo,
    tx: fn => driver.transaction(tx => fn(makeRepo(exec((s, p) => tx.query(s, p)), {pg: true}))),
    makeLimiter(now) { return makePgLimiter(this, now); },
    close: () => driver.close?.()
  };
}

// pg.Pool -> драйвер. pg грузится динамически: только когда реально нужен PostgreSQL.
export async function pgPoolDriver(connectionString, {max = 5} = {}) {
  const pg = (await import('pg')).default;
  // BIGINT (миллисекунды, id) -> обычное число: значения далеко до 2^53
  const types = {getTypeParser: (oid, fmt) => oid === 20 ? Number : pg.types.getTypeParser(oid, fmt)};
  const pool = new pg.Pool({connectionString, max, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000, types});
  pool.on('error', () => {}); // ошибка простаивающего соединения не должна ронять процесс; текст не логируем (в нём бывает адрес базы)
  return {
    query: (sql, params) => pool.query(sql, params),
    async transaction(fn) {
      const c = await pool.connect();
      let broken = false;
      try {
        await c.query('BEGIN');
        const r = await fn({query: (s, p) => c.query(s, p), exec: s => c.query(s)});
        await c.query('COMMIT'); return r;
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch { broken = true; }
        throw e;
      } finally { c.release(broken); }
    },
    close: () => pool.end()
  };
}
