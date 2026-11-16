// HTTP-адаптер Vercel (server/vercel.mjs = api/index.mjs): маршрутизация /api/*, Host/Origin, уже прочитанные тела,
// честный 503 без DATABASE_URL, секреты не попадают в ответы и логи, нет записи на диск и нет node:sqlite в пути функции.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Jar, signup, uniqueName, PW, rawRequest} from './helpers.mjs';
import {bootPg, pgState} from './pg-env.mjs';
import {createVercelHandler, vercelHosts, SETUP_503} from '../server/vercel.mjs';
import {pgliteDriver} from './pg-helpers.mjs';

const code = t => t.replace(/(^|\s)\/\/.*$/gm, '$1'); // без комментариев
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = await bootPg();
test.after(() => env.close());

// Вызывает функцию так, как это делает Vercel: объект запроса + объект ответа, без http-сервера.
async function call(handler, {method = 'POST', url, headers = {}, body, consumed = false, host = env.host}) {
  const stream = new Readable({read() {}});
  const req = Object.assign(stream, {method, url, headers: {host, ...headers}, socket: {remoteAddress: '127.0.0.1'}});
  const raw = body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  if (consumed) { req.body = body; stream.push(null); stream.resume(); await once(stream, 'end'); }
  else { if (raw !== undefined) stream.push(raw); stream.push(null); }
  const res = {headers: {}, status: 0, chunks: [], headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s, h = {}) { this.status = s; for (const k in h) this.headers[k.toLowerCase()] = h[k]; this.headersSent = true; },
    end(b) { if (b !== undefined) this.chunks.push(b); this.done(); }};
  const finished = new Promise(r => { res.done = r; });
  handler(req, res); await finished;
  const text = res.chunks.join(''); let json = null; try { json = JSON.parse(text); } catch {}
  return {status: res.status, headers: res.headers, text, json};
}
const JSONH = {'content-type': 'application/json', origin: env.origin};

test('routing: /api/* dispatched by the function on the same origin; pages/unknown/index are not served by it', async () => {
  const get = p => fetch(env.base + p);
  assert.equal((await get('/api/me')).status, 401);
  const prov = await get('/api/auth/providers'); assert.equal(prov.status, 200); assert.deepEqual(await prov.json(), {google: {enabled: false}});
  assert.equal(prov.headers.get('cache-control'), 'no-store'); assert.equal(prov.headers.get('x-content-type-options'), 'nosniff'); assert.match(prov.headers.get('content-security-policy'), /default-src 'self'/);
  for (const p of ['/api/nope', '/api/', '/api/index', '/api/me/extra', '/login', '/', '/audio/click.wav', '/assets/a.js']) { const r = await get(p); assert.equal(r.status, 404, p); assert.match(r.headers.get('content-type'), /json/); }
  const g = await get('/api/login'); assert.equal(g.status, 405); assert.equal(g.headers.get('allow'), 'GET, POST');
  assert.equal((await fetch(env.base + '/api/me', {method: 'POST', headers: {Origin: env.origin, 'Content-Type': 'application/json'}, body: '{}'})).status, 405);
  // все 13 маршрутов отвечают (не 404)
  const jar = (await signup(env)).jar;
  for (const [m, p, b] of [['GET', '/api/me'], ['POST', '/api/course', {course: 'en'}], ['POST', '/api/tier', {tier: 0}], ['POST', '/api/lesson/start', {tier: 0, level: 1}], ['POST', '/api/lesson/abandon', {lessonId: 'x'}], ['POST', '/api/lesson/retry', {lessonId: 'x'}], ['POST', '/api/lesson/answer', {lessonId: 'x', index: 0, given: 'a'}], ['POST', '/api/shop/buy', {item: 'heart'}], ['POST', '/api/logout', {}]]) assert.notEqual((await jar.req(m, p, b)).status, 404, p);
});

test('Host/Origin: exact allow-list from ALLOWED_HOSTS + server-managed VERCEL_* values; wildcards and forwarded headers are ignored', async () => {
  const e = {ALLOWED_HOSTS: 'App.Example.com, *.vercel.app, https://b.example.com/, bad host', VERCEL_URL: 'proj-abc123.vercel.app', VERCEL_BRANCH_URL: 'proj-git-feat.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'proj.vercel.app'};
  assert.deepEqual(vercelHosts(e).sort(), ['app.example.com', 'b.example.com', 'proj-abc123.vercel.app', 'proj-git-feat.vercel.app', 'proj.vercel.app']);
  assert.deepEqual(vercelHosts({}), []);
  const d = await pgliteDriver(), {migratePg} = await import('../server/migrate-pg.mjs'); await migratePg(d);
  const h = createVercelHandler({env: {...e, VERCEL_ENV: 'production'}, createDriver: async () => d, scrypt: {N: 1024}, log: () => {}});
  try {
    const hdr = (host, origin) => ({host, headers: {'content-type': 'application/json', ...(origin ? {origin} : {})}});
    for (const host of ['proj.vercel.app', 'proj-abc123.vercel.app', 'proj-git-feat.vercel.app', 'app.example.com']) assert.equal((await call(h, {url: '/api/login', body: {username: 'ghost_zzz', password: 'wrong-pass-1'}, ...hdr(host, 'https://' + host)})).status, 401, host);
    for (const host of ['other.vercel.app', 'evil.example.com', 'proj.vercel.app.evil.com', 'localhost:3000', '127.0.0.1', '']) assert.equal((await call(h, {url: '/api/me', method: 'GET', host})).status, 421, 'host ' + host);
    assert.equal((await call(h, {url: '/api/me', method: 'GET', host: 'evil.com', headers: {'x-forwarded-host': 'proj.vercel.app', forwarded: 'host=proj.vercel.app'}})).status, 421, 'forwarded headers are not trusted');
    const post = (origin, extra = {}) => call(h, {url: '/api/login', body: {username: 'ghost_zzz', password: 'wrong-pass-1'}, host: 'proj.vercel.app', headers: {'content-type': 'application/json', ...(origin ? {origin} : {}), ...extra}});
    assert.equal((await post('http://proj.vercel.app')).status, 403, 'production requires https origin');
    for (const o of [undefined, 'https://other.vercel.app', 'https://proj.vercel.app.evil.com', 'null', 'https://evil.com']) assert.equal((await post(o)).status, 403, 'origin ' + o);
    assert.equal((await post('https://proj.vercel.app', {'sec-fetch-site': 'cross-site'})).status, 403);
    assert.equal((await post('https://proj.vercel.app', {'content-type': 'text/plain'})).status, 415);
  } finally { await h.close(); }
});

test('consumed bodies: Vercel may already have read the stream and parsed req.body (object, string, Buffer)', async () => {
  const name = uniqueName('cb');
  const creds = {username: name, password: PW};
  const viaObject = await call(env.handler, {url: '/api/register', headers: JSONH, body: creds, consumed: true, host: env.host});
  assert.equal(viaObject.status, 200, viaObject.text); assert.equal(viaObject.json.user.username, name);
  const sid = viaObject.headers['set-cookie']; assert.match(sid, /^__Host-jenius_sid=/);
  const login = body => call(env.handler, {url: '/api/login', headers: {...JSONH, 'x-real-ip': '192.0.2.200'}, body, consumed: true});
  assert.equal((await login(creds)).status, 200); assert.equal((await login(JSON.stringify(creds))).status, 200, 'parsed to string'); assert.equal((await login(Buffer.from(JSON.stringify(creds)))).status, 200, 'raw Buffer');
  assert.equal((await call(env.handler, {url: '/api/login', headers: {...JSONH, 'x-real-ip': '192.0.2.200'}, body: creds})).status, 200, 'unconsumed stream still works');
  for (const bad of ['{nope', '[1,2]', '"str"', Buffer.from('null')]) assert.equal((await login(bad)).status, 400, String(bad));
  assert.equal((await call(env.handler, {url: '/api/login', headers: JSONH, consumed: true})).status, 400, 'consumed with no body');
  assert.equal((await login({username: name, password: 'x'.repeat(20000)})).status, 413, 'oversized parsed body');
  const bigRaw = await call(env.handler, {url: '/api/login', headers: JSONH, body: JSON.stringify({username: name, password: 'x'.repeat(20000)})}); assert.equal(bigRaw.status, 413);
  const throwing = Object.assign(new Readable({read() {}}), {method: 'POST', url: '/api/login', headers: {host: env.host, ...JSONH}, socket: {}});
  Object.defineProperty(throwing, 'body', {get() { throw new Error('bad body'); }}); throwing.push(null); throwing.resume(); await once(throwing, 'end');
  const res = {headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(s) { this.status = s; }, end() { this.done(); }}; const fin = new Promise(r => { res.done = r; });
  env.handler(throwing, res); await fin; assert.equal(res.status, 400, 'a throwing req.body getter is a clean 400');
  // игровой запрос с авторизацией через consumed body
  const jar = new Jar(env); jar.cookies.set('__Host-jenius_sid', sid.split(';')[0].split('=')[1]);
  const course = await call(env.handler, {url: '/api/course', headers: {...JSONH, cookie: jar.header}, body: {course: 'ru'}, consumed: true}); assert.equal(course.status, 200); assert.equal(course.json.state.activeCourse, 'ru');
  assert.equal((await pgState(env, name)).activeCourse, 'ru');
});

test('missing DATABASE_URL: honest 503 setup message for every /api path; no fake in-memory or temp database', async () => {
  const logs = [], h = createVercelHandler({env: {VERCEL_URL: 'proj.vercel.app', VERCEL_ENV: 'production'}, log: m => logs.push(m)});
  const hdr = {host: 'proj.vercel.app'};
  for (const [method, url, body] of [['GET', '/api/me'], ['POST', '/api/login', {username: 'abc', password: 'password1'}], ['POST', '/api/register', {username: 'abcdef', password: 'password1'}], ['GET', '/api/auth/providers'], ['POST', '/api/course', {course: 'en'}]]) {
    const r = await call(h, {method, url, body, ...hdr, headers: {origin: 'https://proj.vercel.app', 'content-type': 'application/json'}});
    assert.equal(r.status, 503, url); assert.deepEqual(r.json, SETUP_503); assert.match(r.json.error, /DATABASE_URL/); assert.equal(r.headers['cache-control'], 'no-store'); assert.equal(r.headers['x-content-type-options'], 'nosniff');
  }
  assert.equal((await call(h, {method: 'GET', url: '/api/me', host: 'evil.com'})).status, 421, 'host check still first');
  assert.equal(logs.length, 0);
  const src = readFileSync(path.join(root, 'server', 'vercel.mjs'), 'utf8'); assert.doesNotMatch(code(src), /:memory:|tmpdir|DatabaseSync|node:sqlite/);
});

test('secure cookie by default on Vercel; COOKIE_SECURE=0 turns it off (vercel dev over http)', async () => {
  const mk = async extra => { const d = await pgliteDriver(), {migratePg} = await import('../server/migrate-pg.mjs'); await migratePg(d); return {d, h: createVercelHandler({env: {VERCEL_URL: 'proj.vercel.app', VERCEL_ENV: 'production', ...extra}, createDriver: async () => d, scrypt: {N: 1024}, log: () => {}})}; };
  const reg = h => call(h, {url: '/api/register', host: 'proj.vercel.app', headers: {origin: 'https://proj.vercel.app', 'content-type': 'application/json'}, body: {username: uniqueName('ck'), password: PW}});
  const a = await mk({}), b = await mk({COOKIE_SECURE: '0'});
  try {
    const ca = (await reg(a.h)).headers['set-cookie']; assert.match(ca, /^__Host-jenius_sid=.*; HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000; Secure$/);
    const cb = (await reg(b.h)).headers['set-cookie']; assert.match(cb, /^jenius_sid=/); assert.doesNotMatch(cb, /Secure/);
  } finally { await a.d.close(); await b.d.close(); }
});

test('errors never leak secrets: database errors become 503/500 with no URL/password in the response or the log; Telegram token is redacted', async () => {
  const logs = [], secret = 'postgres://neon_user:SUPERSECRETPW@ep-x.neon.tech/db';
  const boom = code => ({query: async () => { const e = new Error(`connect failed ${secret} token ${'bo' + 't123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ'}`); e.code = code; throw e; }, transaction: async () => { throw Object.assign(new Error(secret), {code}); }});
  const mk = code => createVercelHandler({env: {DATABASE_URL: secret, VERCEL_URL: 'proj.vercel.app', VERCEL_ENV: 'preview'}, createDriver: async () => boom(code), log: m => logs.push(m), scrypt: {N: 1024}});
  const req = h => call(h, {url: '/api/login', host: 'proj.vercel.app', headers: {origin: 'https://proj.vercel.app', 'content-type': 'application/json'}, body: {username: 'abcdef', password: 'password1'}});
  const down = await req(mk('ECONNREFUSED')); assert.equal(down.status, 503); assert.match(down.json.error, /Baza vaqtincha/);
  const odd = await req(mk('XX000')); assert.equal(odd.status, 500); assert.equal(odd.json.error, 'Server xatosi');
  const bad = await call(createVercelHandler({env: {DATABASE_URL: secret, VERCEL_URL: 'proj.vercel.app'}, createDriver: async () => { throw new Error('cannot init ' + secret); }, log: m => logs.push(m)}), {method: 'GET', url: '/api/me', host: 'proj.vercel.app'});
  assert.equal(bad.status, 500);
  const all = JSON.stringify([down, odd, bad]) + logs.join('\n');
  for (const s of ['SUPERSECRETPW', 'neon_user', 'neon.tech', 'postgres://', 'ABCDEFGHIJKLMNOP']) assert.ok(!all.includes(s), 'leaked ' + s);
  assert.ok(logs.length >= 3);
});

test('database not migrated yet: a clear 503 telling to run db:migrate (not a 500, not a fake success)', async () => {
  const fresh = await bootPg({migrate: false});
  try {
    const r = await new Jar(fresh).post('/api/login', {username: 'abcdef', password: 'password1'}, {headers: {'x-real-ip': '192.0.2.5'}});
    assert.equal(r.status, 503); assert.match(r.data.error, /db:migrate/);
    const j = new Jar(fresh); j.cookies.set('__Host-jenius_sid', 'a'.repeat(43)); const m = await j.get('/api/me'); assert.equal(m.status, 503);
  } finally { await fresh.close(); }
});

test('function path is serverless-clean: no node:sqlite / server.mjs / fs / process.chdir anywhere in the import graph of api/index.mjs', () => {
  const seen = new Set(), queue = [path.join(root, 'api', 'index.mjs')], texts = {};
  while (queue.length) {
    const f = queue.pop(); if (seen.has(f)) continue; seen.add(f);
    const t = readFileSync(f, 'utf8'); texts[f] = t;
    for (const m of t.matchAll(/(?:from|import\()\s*'(\.[^']+)'/g)) queue.push(path.resolve(path.dirname(f), m[1]));
  }
  const rel = [...seen].map(f => path.relative(root, f)).sort();
  for (const must of ['api/index.mjs', 'server/vercel.mjs', 'server/app.mjs', 'server/game.mjs', 'server/store-pg.mjs', 'server/limiter.mjs', 'server/repo.mjs', 'shared/engine.mjs']) assert.ok(rel.includes(must), 'graph has ' + must);
  for (const bad of ['server.mjs', 'server/db.mjs', 'server/store-sqlite.mjs', 'server/migrate-pg.mjs', 'server/import-sqlite.mjs']) assert.ok(!rel.includes(bad), 'graph must not include ' + bad);
  for (const [f, t] of Object.entries(texts)) {
    assert.doesNotMatch(code(t), /node:sqlite|DatabaseSync|node:fs|writeFile|appendFile|createWriteStream|mkdirSync|\bmkdir\(|rmSync|unlinkSync|renameSync|tmpdir|process\.chdir|:memory:/, path.relative(root, f));
    assert.doesNotMatch(code(t), /\.listen\(|createServer\(/, 'no server.listen in ' + path.relative(root, f));
  }
});

test('REAL serverless run with disk writes FORBIDDEN (node --permission, no --allow-fs-write): register/login/course/lesson/me on PGlite', () => {
  const out = execFileSync(process.execPath, ['--permission', `--allow-fs-read=${root}`, '--allow-net', '--no-warnings', path.join(root, 'tests', 'fixtures', 'serverless-child.mjs'), root], {cwd: root, encoding: 'utf8', timeout: 120000});
  assert.deepEqual(JSON.parse(out.trim().split('\n').pop()), {outcome: 'done', login: 200, me: 200, coins: 20});
});
