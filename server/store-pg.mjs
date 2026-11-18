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

// Ошибка «соединение с базой умерло/зависло» (Neon закрывает простаивающие сокеты, Vercel замораживает функцию, сокет остаётся мёртвым).
// Такая ошибка на ПЕРВОМ шаге (BEGIN / одиночный идемпотентный запрос) означает: сервер ничего не выполнил или выполнение безопасно повторить.
const CONN_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNABORTED', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', '57P01', '57P02', '57P03', '08000', '08003', '08006', '08001', '08004', '08007', '08P01']);
const CONN_MSG = /Connection terminated|Connection ended|connection error|timeout exceeded when trying to connect|Query read timeout|ECONNRESET|socket hang up|Client was closed|Cannot use a pool after calling end/i;
export function isConnError(e) { return !!e && (CONN_CODES.has(String(e.code || '')) || CONN_MSG.test(String(e.message || ''))); }
// Безопасная для клиента классификация причины (без текста ошибки, адреса и учётных данных): уходит в тело 503 и в лог.
export function dbReason(e) {
  const code = String(e && e.code || ''), msg = String(e && e.message || '');
  if (code === '42P01') return 'db_schema';
  if (/^28/.test(code)) return 'db_auth';
  if (/timeout|read timeout/i.test(msg) || code === 'ETIMEDOUT') return 'db_timeout';
  if (isConnError(e) || /^(08|53|57|ECONN|ENOTFOUND|EAI_AGAIN|ENETUNREACH)/.test(code)) return 'db_connection';
  return null;
}

// pg.Pool -> драйвер. pg грузится динамически: только когда реально нужен PostgreSQL.
// opts.createPool(config) — для тестов (подмена пула); opts.sleep — пауза между попытками (тесты).
// Надёжность на Vercel+Neon:
//  - query_timeout/connectionTimeoutMillis: молча умерший сокет не виснет до таймаута функции, а быстро даёт ошибку соединения;
//  - keepAlive: ядро ОС само замечает обрыв;
//  - transaction(): если соединение не отвечает на BEGIN (транзакция ещё не началась, ничего не выполнено) — оно выбрасывается
//    и транзакция начинается заново на свежем соединении. Любой сбой ПОСЛЕ успешного BEGIN НЕ повторяется (никаких слепых повторов
//    регистрации/покупки: результат COMMIT мог быть неизвестен) — ошибка уходит вверх как 503;
//  - query(): одиночные запросы — это чтения и идемпотентные записи (сессии, счётчики), один повтор на свежем соединении безопасен.
const GUARD = Symbol('errorGuard');
export async function pgPoolDriver(connectionString, {max = 5, createPool, sleep = ms => new Promise(r => setTimeout(r, ms)), beginAttempts = 3, queryAttempts = 2} = {}) {
  const pg = createPool ? null : (await import('pg')).default;
  // BIGINT (миллисекунды, id) -> обычное число: значения далеко до 2^53
  const types = pg && {getTypeParser: (oid, fmt) => oid === 20 ? Number : pg.types.getTypeParser(oid, fmt)};
  const config = {connectionString, max, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000, query_timeout: 5000, keepAlive: true, keepAliveInitialDelayMillis: 10000, types};
  const pool = createPool ? createPool(config) : new pg.Pool(config);
  pool.on('error', () => {}); // ошибка простаивающего соединения не должна ронять процесс; текст не логируем (в нём бывает адрес базы)
  const stats = {begin_retries: 0, query_retries: 0};
  return {
    stats,
    async query(sql, params) {
      for (let a = 1; ; a++) {
        try { return await pool.query(sql, params); }
        catch (e) { if (a >= queryAttempts || !isConnError(e)) throw e; stats.query_retries++; await sleep(100 * a); }
      }
    },
    async transaction(fn) {
      let c;
      for (let a = 1; ; a++) { // этап 1: получить РАБОЧЕЕ соединение (connect + BEGIN). Здесь повтор безопасен.
        let cand = null; // слушатель error на занятом соединении обязателен: без него ошибка вне запроса роняет процесс
        try { cand = await pool.connect(); if (!cand[GUARD]) { cand[GUARD] = true; cand.on('error', () => {}); } await cand.query('BEGIN'); c = cand; break; }
        catch (e) {
          if (cand) try { cand.release(true); } catch {} // мёртвое соединение выбрасываем из пула, а не возвращаем
          if (a >= beginAttempts || !isConnError(e)) throw e;
          stats.begin_retries++; await sleep(100 * a);
        }
      }
      let broken = false;
      try {
        const r = await fn({query: (s, p) => c.query(s, p), exec: s => c.query(s)});
        await c.query('COMMIT'); return r;
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch { broken = true; }
        if (isConnError(e)) broken = true;
        throw e;
      } finally { c.release(broken); }
    },
    close: () => pool.end()
  };
}
