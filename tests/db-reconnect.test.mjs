// Инцидент «server unavailable» на Vercel+Neon: простаивающее соединение умерло (сокет закрыт/молча завис), пока функция была заморожена.
// Проверяем драйвер pgPoolDriver с поддельным пулом поверх НАСТОЯЩЕГО PostgreSQL (PGlite) и инъекцией сбоев:
//  - сбой на BEGIN (мёртвое соединение) -> соединение выбрасывается, транзакция идёт заново РОВНО один раз;
//  - сбой ПОСЛЕ BEGIN/на COMMIT -> НИКАКИХ повторов (регистрация/покупка не воспроизводятся вслепую), 503 с безопасной причиной;
//  - одиночные запросы (чтения/идемпотентные записи) повторяются один раз.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pgPoolDriver, isConnError, dbReason} from '../server/store-pg.mjs';
import {migratedPglite} from './pg-helpers.mjs';
import {bootPg} from './pg-env.mjs';
import {Jar, PW, uniqueName, correctGiven} from './helpers.mjs';

const dead = () => Object.assign(new Error('Connection terminated unexpectedly'), {});
// Пул поверх PGlite. faults: очередь {on:'BEGIN'|'COMMIT'|'query', err, hang?}; каждый сбой срабатывает один раз.
async function fakePoolOver(base, faults = []) {
  const log = {released: [], begins: 0, connects: 0, queries: []};
  const hit = (kind, sql) => { const i = faults.findIndex(f => f.on === kind && (!f.sql || f.sql.test(sql))); return i >= 0 ? faults.splice(i, 1)[0] : null; };
  const mk = () => ({
    _l: {}, on(ev) { this._l[ev] = true; },
    async query(sql, p) {
      if (sql === 'BEGIN') { log.begins++; const f = hit('BEGIN', sql); if (f) throw f.err; }
      if (sql === 'COMMIT') { const f = hit('COMMIT', sql); if (f) { await base.db.query('ROLLBACK'); throw f.err; } }
      const f = hit('query', sql); if (f) throw f.err;
      return base.db.query(sql, p);
    },
    release(v) { log.released.push(!!v); }
  });
  const pool = {on() {}, connect: async () => { log.connects++; return mk(); },
    query: async (sql, p) => { log.queries.push(sql); const f = hit('pool', sql); if (f) throw f.err; return base.db.query(sql, p); }, end: async () => {}};
  return {pool, log, faults};
}
const mkDriver = async (faults) => {
  const base = await migratedPglite(); const fp = await fakePoolOver(base, faults);
  const driver = await pgPoolDriver('postgres://u:p@h/x', {createPool: () => fp.pool, sleep: async () => {}});
  return {driver, base, ...fp};
};

test('classification: dead sockets/timeouts are connection errors; SQL errors are not; reasons are safe codes', () => {
  for (const m of ['Connection terminated unexpectedly', 'Query read timeout', 'timeout exceeded when trying to connect', 'Client has encountered a connection error and is not queryable']) assert.ok(isConnError(new Error(m)), m);
  assert.ok(isConnError(Object.assign(new Error('x'), {code: 'ECONNRESET'})));
  assert.ok(!isConnError(Object.assign(new Error('duplicate key'), {code: '23505'})));
  assert.equal(dbReason(new Error('Query read timeout')), 'db_timeout');
  assert.equal(dbReason(dead()), 'db_connection');
  assert.equal(dbReason(Object.assign(new Error('relation'), {code: '42P01'})), 'db_schema');
  assert.equal(dbReason(Object.assign(new Error('pw'), {code: '28P01'})), 'db_auth');
  assert.equal(dbReason(new Error('boom')), null);
});

test('dead idle connection (BEGIN fails): client is destroyed, transaction restarts on a fresh one, work runs exactly once', async () => {
  const {driver, log} = await mkDriver([{on: 'BEGIN', err: dead()}]);
  let runs = 0;
  const r = await driver.transaction(async tx => { runs++; return (await tx.query('SELECT 7 AS n')).rows[0].n; });
  assert.equal(r, 7); assert.equal(runs, 1); assert.equal(log.connects, 2);
  assert.deepEqual(log.released, [true, false], 'dead client is released as broken, good one normally'); assert.equal(driver.stats.begin_retries, 1);
});

test('hung socket (BEGIN query timeout) is also retried on a fresh connection', async () => {
  const {driver} = await mkDriver([{on: 'BEGIN', err: new Error('Query read timeout')}, {on: 'BEGIN', err: new Error('Query read timeout')}]);
  assert.equal(await driver.transaction(async () => 'ok'), 'ok'); assert.equal(driver.stats.begin_retries, 2);
});

test('connection dies AFTER BEGIN or at COMMIT: NOT retried (no blind replay), rolled back, client destroyed', async () => {
  for (const when of ['mid', 'commit']) {
    const faults = when === 'mid' ? [{on: 'query', sql: /INSERT/, err: dead()}] : [{on: 'COMMIT', err: dead()}];
    const {driver, base, log} = await mkDriver(faults); let runs = 0;
    await assert.rejects(driver.transaction(async tx => { runs++; await tx.query("INSERT INTO throttle_events(key,kind,at,win) VALUES('k','h',1,1)"); }), /Connection terminated/);
    assert.equal(runs, 1, when + ': work ran once'); assert.equal(driver.stats.begin_retries, 0);
    assert.equal(log.released.at(-1), true, when + ': broken client destroyed');
    const n = (await base.db.query("SELECT count(*) AS n FROM throttle_events WHERE key='k'")).rows[0].n; assert.equal(Number(n), 0, when + ': nothing committed');
  }
});

test('non-connection error at BEGIN is not retried; attempts are bounded', async () => {
  const a = await mkDriver([{on: 'BEGIN', err: Object.assign(new Error('permission denied'), {code: '42501'})}]);
  await assert.rejects(a.driver.transaction(async () => 1), /permission denied/); assert.equal(a.log.connects, 1);
  const b = await mkDriver([1, 2, 3, 4].map(() => ({on: 'BEGIN', err: dead()})));
  await assert.rejects(b.driver.transaction(async () => 1), /Connection terminated/); assert.equal(b.log.connects, 3, 'at most 3 attempts');
});

test('single queries (reads / idempotent writes) retry once on a dead connection; SQL errors do not', async () => {
  const a = await mkDriver([{on: 'pool', err: dead()}]);
  assert.equal((await a.driver.query('SELECT 1 AS n')).rows[0].n, 1); assert.equal(a.driver.stats.query_retries, 1);
  const b = await mkDriver([{on: 'pool', err: dead()}, {on: 'pool', err: dead()}]);
  await assert.rejects(b.driver.query('SELECT 1'), /Connection terminated/);
  const c = await mkDriver([{on: 'pool', err: Object.assign(new Error('syntax'), {code: '42601'})}]);
  await assert.rejects(c.driver.query('SELECT 1'), /syntax/); assert.equal(c.driver.stats.query_retries, 0);
});

test('HTTP: register + lesson answer survive a dead pooled connection with exactly ONE user and ONE reward/heart change', async () => {
  const base = await migratedPglite(), faults = []; const fp = await fakePoolOver(base, faults);
  const driver = await pgPoolDriver('postgres://u:p@h/x', {createPool: () => fp.pool, sleep: async () => {}});
  const env = await bootPg({driver}); const name = uniqueName('rc');
  try {
    faults.push({on: 'BEGIN', err: dead()}); // следующая транзакция (создание пользователя) попадёт на мёртвое соединение
    const jar = new Jar(env); const reg = await jar.post('/api/register', {username: name, password: PW});
    assert.equal(reg.status, 200, JSON.stringify(reg.data));
    assert.equal(Number((await base.db.query('SELECT count(*) AS n FROM users WHERE username_key=$1', [name.toLowerCase()])).rows[0].n), 1);
    await jar.post('/api/course', {course: 'en'});
    const s = await jar.post('/api/lesson/start', {tier: 0, level: 1}); assert.equal(s.status, 200);
    const lesson = s.data.lesson; const given = correctGiven({...lesson, course: 'en'}, 0);
    faults.push({on: 'BEGIN', err: dead()}, {on: 'pool', err: dead()}); // мёртвое соединение и при проверке сессии, и при транзакции ответа
    const a1 = await jar.post('/api/lesson/answer', {lessonId: lesson.id, index: 0, given}); assert.equal(a1.status, 200, JSON.stringify(a1.data));
    assert.equal(a1.data.lesson.index, 1);
    const a2 = await jar.post('/api/lesson/answer', {lessonId: lesson.id, index: 0, given}); // повтор того же ответа (потерянный ответ сети)
    assert.equal(a2.status, 200); assert.equal(a2.data.replay, true); assert.equal(a2.data.lesson.index, 1, 'no second advance');
    assert.equal(a2.data.state.hearts, a1.data.state.hearts, 'no extra heart loss');
  } finally { await env.close({keepDb: true}); }
});

test('HTTP: when the connection stays dead, API answers 503 with a SAFE reason + retryable flag, never a 500, and leaks no secrets', async () => {
  const base = await migratedPglite(), faults = []; const fp = await fakePoolOver(base, faults);
  const driver = await pgPoolDriver('postgres://app_user:TOPSECRETPW@db.example.neon.tech/x', {createPool: () => fp.pool, sleep: async () => {}});
  const env = await bootPg({driver, env: {DATABASE_URL: 'postgres://app_user:TOPSECRETPW@db.example.neon.tech/x'}});
  try {
    for (let i = 0; i < 6; i++) faults.push({on: 'BEGIN', err: new Error('Connection terminated unexpectedly to db.example.neon.tech:5432')});
    const jar = new Jar(env); const r = await jar.post('/api/register', {username: uniqueName('dd'), password: PW});
    assert.equal(r.status, 503); assert.equal(r.data.reason, 'db_connection'); assert.equal(r.data.retryable, true); assert.equal(r.headers.get('retry-after'), '5');
    assert.equal(Number((await base.db.query('SELECT count(*) AS n FROM users')).rows[0].n), 0, 'nothing was created');
    const all = JSON.stringify(r.data) + env.logs.join('\n'); for (const s of ['TOPSECRETPW', 'app_user', 'neon.tech']) assert.ok(!all.includes(s), 'leaked ' + s);
    assert.ok(env.logs.some(l => /POST \/api\/register db_connection/.test(l)), env.logs.join('|'));
  } finally { await env.close({keepDb: true}); }
});
