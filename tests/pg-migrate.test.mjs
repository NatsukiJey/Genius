// Схема, миграции и транзакции PostgreSQL — на настоящем PostgreSQL (PGlite). Плюс необязательный перенос из SQLite.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pgliteDriver} from './pg-helpers.mjs';
import {bootPg, pgState} from './pg-env.mjs';
import {boot, signup, finishLevel, Jar, PW} from './helpers.mjs';
import {migratePg, listMigrations} from '../server/migrate-pg.mjs';
import {makePgStore} from '../server/store-pg.mjs';
import {importSqliteToPg} from '../server/import-sqlite.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');
const scratch = () => { mkdirSync(path.join(here, '.data'), {recursive: true}); return mkdtempSync(path.join(here, '.data', 'mig-')); };
const q = async (d, sql, p) => (await d.query(sql, p)).rows;

test('migration creates the schema with the right types, constraints and schema_migrations; second run changes nothing', async () => {
  const d = await pgliteDriver();
  try {
    assert.deepEqual(await migratePg(d), {applied: ['001_init.sql'], current: 1});
    const cols = await q(d, "SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'");
    const t = (tb, c) => cols.find(x => x.table_name === tb && x.column_name === c)?.data_type;
    assert.equal(t('users', 'pw_hash'), 'bytea'); assert.equal(t('users', 'pw_salt'), 'bytea'); assert.equal(t('sessions', 'token_hash'), 'bytea');
    assert.equal(t('users', 'created_at'), 'bigint'); assert.equal(t('progress', 'state'), 'text'); assert.equal(t('lessons', 'course'), 'text'); assert.equal(t('throttle_events', 'at'), 'bigint');
    assert.deepEqual([...new Set(cols.map(c => c.table_name))].sort(), ['lessons', 'progress', 'schema_migrations', 'sessions', 'throttle_events', 'users']);
    const uniq = await q(d, "SELECT indexdef FROM pg_indexes WHERE tablename='users'"); assert.ok(uniq.some(r => /UNIQUE.*username_key/.test(r.indexdef)), 'username_key is unique');
    assert.equal((await q(d, 'SELECT version,name FROM schema_migrations')).length, 1);
    assert.deepEqual(await migratePg(d), {applied: [], current: 1}); assert.equal((await q(d, 'SELECT count(*) AS n FROM schema_migrations'))[0].n, 1);
    // сам SQL тоже идемпотентен (IF NOT EXISTS): повторный прогон файла вручную не падает
    await d.transaction(async tx => { await tx.exec(readFileSync(path.join(root, 'migrations', '001_init.sql'), 'utf8')); });
    // параллельные запуски (два деплоя сразу) не конфликтуют
    const parallel = await Promise.all([migratePg(d), migratePg(d), migratePg(d)]); assert.ok(parallel.every(r => r.applied.length === 0));
    const calls = d.calls.join('\n'); assert.match(calls, /pg_advisory_xact_lock/, 'migration takes the advisory lock');
  } finally { await d.close(); }
});

test('a failing migration rolls back EVERYTHING it did (all-or-nothing) and records no version; fixing it then works', async () => {
  const dir = scratch(), d = await pgliteDriver();
  try {
    writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE IF NOT EXISTS a(id INT PRIMARY KEY);');
    writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE b(id INT); SELECT * FROM table_that_does_not_exist;');
    writeFileSync(path.join(dir, 'README.md'), 'ignored'); writeFileSync(path.join(dir, 'x_notes.sql'), 'DROP TABLE users;');
    assert.deepEqual((await listMigrations(dir)).map(m => m.name), ['001_a.sql', '002_bad.sql']);
    await assert.rejects(migratePg(d, {dir}), /table_that_does_not_exist/);
    const tables = (await q(d, "SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).map(r => r.table_name);
    assert.ok(!tables.includes('a') && !tables.includes('b') && !tables.includes('schema_migrations'), String(tables));
    writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE b(id INT);');
    assert.deepEqual((await migratePg(d, {dir})).applied, ['001_a.sql', '002_bad.sql']);
    assert.deepEqual((await q(d, 'SELECT version FROM schema_migrations ORDER BY version')).map(r => r.version), [1, 2]);
  } finally { await d.close(); }
});

test('transactions: an error in the middle of register/tx rolls back every statement; FOR UPDATE + advisory locks are used; values are always parameters', async () => {
  const env = await bootPg();
  try {
    const store = makePgStore(env.driver);
    await assert.rejects(store.tx(async repo => { await repo.insertUser({nick: 'Rolled', key: 'rolled', hash: Buffer.alloc(32), salt: Buffer.alloc(16), params: '{}', t: 1}); throw new Error('boom'); }), /boom/);
    assert.equal((await q(env.driver, "SELECT count(*) AS n FROM users WHERE username_key='rolled'"))[0].n, 0, 'rolled back');
    assert.equal(await store.repo.userByKey('rolled'), null);
    const {name, jar} = await signup(env); await jar.get('/api/me'); await new Jar(env).post('/api/login', {username: name, password: 'bad-bad-bad'}, {headers: {'x-real-ip': '192.0.2.9'}});
    const calls = env.driver.calls;
    assert.ok(calls.some(c => /FROM progress WHERE user_id=\$1 FOR UPDATE/.test(c)), 'player row is locked before it is read');
    assert.ok(calls.some(c => /FROM users WHERE id=\$1 FOR UPDATE/.test(c)), 'user row is locked when sessions are created');
    assert.ok(calls.some(c => /pg_advisory_xact_lock\(hashtextextended\(\$1,0\)\)/.test(c)), 'throttle counters take advisory locks');
    assert.ok(calls.every(c => !c.includes(name) && !c.includes(PW)), 'user data is never concatenated into SQL');
    assert.ok(calls.every(c => !/\?/.test(c)), 'all placeholders converted to $n');
  } finally { await env.close(); }
});

test('db:migrate script refuses to run without DATABASE_URL; build/install never run migrations', () => {
  const clean = {...process.env}; for (const k of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL']) delete clean[k];
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'db-migrate.mjs')], {env: clean, encoding: 'utf8'});
  assert.equal(r.status, 1); assert.match(r.stderr, /DATABASE_URL/);
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')), vj = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(pkg.scripts['db:migrate'], 'node scripts/db-migrate.mjs'); assert.equal(pkg.scripts.build, 'vite build');
  for (const k of ['build', 'check', 'test', 'start', 'preview', 'postinstall', 'prebuild', 'postbuild', 'prepare']) assert.doesNotMatch(pkg.scripts[k] || '', /db:|migrate/, k);
  assert.doesNotMatch(JSON.stringify(vj), /migrate/);
  const imp = spawnSync(process.execPath, [path.join(root, 'scripts', 'import-sqlite.mjs'), '--from', 'x.db'], {env: clean, encoding: 'utf8'}); assert.equal(imp.status, 1); assert.match(imp.stderr, /--yes/, 'import needs explicit --yes');
});

test('OPTIONAL explicit import of local SQLite accounts into an EMPTY PostgreSQL: logins, progress and lesson survive; sessions do not', async () => {
  const dir = scratch(), file = path.join(dir, 'local.db');
  const local = await boot({dbPath: file, scrypt: {N: 1024}});
  let u1, u2;
  try {
    u1 = await signup(local); await finishLevel(u1.jar, 1);
    u2 = await signup(local, undefined, {}, {course: 'ru'}); const st = await u2.jar.post('/api/lesson/start', {tier: 0, level: 1}); assert.equal(st.status, 200);
  } finally { await local.app.close(); }
  const src = new DatabaseSync(file, {readOnly: true}), d = await pgliteDriver(); await migratePg(d);
  try {
    assert.deepEqual(await importSqliteToPg(src, d), {users: 2, lessons: 2});
    await assert.rejects(importSqliteToPg(src, d), /bo‘sh emas/, 'non-empty database is never touched');
    assert.equal((await q(d, 'SELECT count(*) AS n FROM sessions'))[0].n, 0, 'sessions are not copied');
    const env = await bootPg({driver: d});
    try {
      const j = new Jar(env); assert.equal((await j.post('/api/login', {username: u1.name, password: PW})).status, 200, 'old password still works (scrypt hash moved as is)');
      const me = (await j.get('/api/me')).data.state; assert.deepEqual(me.courses.en.completed[0], [1]); assert.ok(me.coins > 0);
      const j2 = new Jar(env); const r2 = await j2.post('/api/login', {username: u2.name, password: PW}); assert.equal(r2.status, 200); assert.equal(r2.data.state.activeCourse, 'ru'); assert.equal(r2.data.lesson.course, 'ru', 'active lesson moved');
      const fresh = await signup(env); assert.equal((await fresh.jar.get('/api/me')).status, 200);
      const ids = (await q(d, 'SELECT id FROM users ORDER BY id')).map(r => r.id); assert.equal(new Set(ids).size, 3, 'id sequence continues after the import');
      assert.equal((await pgState(env, u1.name)).coins, me.coins);
    } finally { await env.close(); }
    const old = src.prepare('SELECT count(*) AS n FROM users').get().n; assert.equal(old, 2, 'the local database was only read');
  } finally { src.close(); }
});
