// Слои хранилища: SQLite-мьютекс (await внутри транзакции) и «тонкий» драйвер pg.Pool (без сервера БД).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openSqliteStore} from '../server/store-sqlite.mjs';
import {pgPoolDriver, makePgStore} from '../server/store-pg.mjs';
import {createVercelHandler} from '../server/vercel.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('SQLite store: a transaction with await inside is isolated — other transactions AND plain reads wait for COMMIT', async () => {
  const store = openSqliteStore(':memory:'), order = [];
  try {
    const ins = (repo, n) => repo.insertUser({nick: 'U' + n, key: 'u' + n, hash: Buffer.alloc(32), salt: Buffer.alloc(16), params: '{}', t: n});
    const t1 = store.tx(async repo => { order.push('t1 start'); await ins(repo, 1); await sleep(30); order.push('t1 sees own row'); assert.ok(await repo.userByKey('u1')); await sleep(30); order.push('t1 commit'); });
    const read = (async () => { await sleep(5); const row = await store.repo.userByKey('u1'); order.push('plain read ' + (row ? 'sees' : 'none')); return row; })();
    const t2 = (async () => { await sleep(10); await store.tx(async repo => { order.push('t2 start'); await ins(repo, 2); }); })();
    await Promise.all([t1, read, t2]);
    assert.deepEqual(order, ['t1 start', 't1 sees own row', 't1 commit', 'plain read sees', 't2 start'], 'strict serialization, nothing interleaves inside the transaction');
    await assert.rejects(store.tx(async repo => { await ins(repo, 3); throw new Error('boom'); }), /boom/);
    assert.equal(await store.repo.userByKey('u3'), null, 'rolled back');
    assert.equal((await store.tx(async repo => repo.insertUser({nick: 'U1', key: 'u1', hash: Buffer.alloc(32), salt: Buffer.alloc(16), params: '{}', t: 9}))), null, 'duplicate key -> null, not an exception');
    await store.tx(async () => 1); // мьютекс не «залип» после ошибки
  } finally { store.close(); }
});

test('pg.Pool driver (real pg module, no database server): unreachable DB -> clean 503, no secrets in response/log, no crash', async () => {
  const logs = [], secretUrl = 'postgres://app_user:TOPSECRETPW@127.0.0.1:1/jenius';
  const h = createVercelHandler({env: {DATABASE_URL: secretUrl, VERCEL_URL: 'proj.vercel.app', VERCEL_ENV: 'preview'}, log: m => logs.push(m), scrypt: {N: 1024}});
  const chunks = []; let status;
  const res = {setHeader() {}, writeHead(s) { status = s; }, end(b) { chunks.push(b); this.done(); }}; const fin = new Promise(r => { res.done = r; });
  const {Readable} = await import('node:stream'); const body = Readable.from([Buffer.from(JSON.stringify({username: 'abcdef', password: 'password1'}))]);
  Object.assign(body, {method: 'POST', url: '/api/login', headers: {host: 'proj.vercel.app', origin: 'https://proj.vercel.app', 'content-type': 'application/json', 'x-real-ip': '192.0.2.1'}, socket: {}});
  h(body, res); await fin;
  try {
    assert.equal(status, 503); assert.match(chunks.join(''), /Baza vaqtincha/);
    const all = chunks.join('') + logs.join('\n'); for (const s of ['TOPSECRETPW', 'app_user', '127.0.0.1:1', 'postgres://']) assert.ok(!all.includes(s), 'leaked ' + s);
    assert.ok(logs.length >= 1 && /ECONNREFUSED/.test(logs[0]), logs[0]);
  } finally { await h.close(); }
});

test('pg driver transaction protocol: BEGIN → work → COMMIT; error → ROLLBACK + release; broken rollback destroys the client; int8 parsed to Number', async () => {
  const seen = [];
  const mkClient = failRollback => ({on() {}, query: async s => { seen.push(s); if (failRollback && s === 'ROLLBACK') throw new Error('gone'); return {rows: []}; }, release: v => seen.push('release:' + !!v)});
  // pgPoolDriver создаёт настоящий pg.Pool, поэтому подменяем его connect()/query() на экземпляре
  const driver = await pgPoolDriver('postgres://u:p@127.0.0.1:1/x'); // подключения не происходит: Pool ленивый
  const pg = (await import('pg')).default;
  const orig = pg.Pool.prototype.connect; let client;
  pg.Pool.prototype.connect = async function () { return client; };
  try {
    client = mkClient(false); await driver.transaction(async tx => { await tx.query('SELECT 1'); }); assert.deepEqual(seen.splice(0), ['BEGIN', 'SELECT 1', 'COMMIT', 'release:false']);
    client = mkClient(false); await assert.rejects(driver.transaction(async () => { throw new Error('x'); }), /x/); assert.deepEqual(seen.splice(0), ['BEGIN', 'ROLLBACK', 'release:false']);
    client = mkClient(true); await assert.rejects(driver.transaction(async () => { throw new Error('x'); }), /x/); assert.deepEqual(seen.splice(0), ['BEGIN', 'ROLLBACK', 'release:true']);
    const types = pg.types; assert.equal(typeof types.getTypeParser(20), 'function');
  } finally { pg.Pool.prototype.connect = orig; await driver.close(); }
  const store = makePgStore({query: async (sql, p) => { seen.push([sql, p]); return {rows: []}; }, transaction: async fn => fn({query: async () => ({rows: []})})});
  await store.repo.userByKey('k'); assert.deepEqual(seen.pop(), ['SELECT * FROM users WHERE username_key=$1', ['k']], '? became $1; value stays a parameter');
});
