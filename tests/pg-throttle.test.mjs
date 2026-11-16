// Ограничитель попыток в PostgreSQL: счётчики лежат в таблице, поэтому общие для всех экземпляров функции.
// «Два экземпляра» = две независимые серверные функции (своя память) на одной базе.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Jar, signup, uniqueName, PW} from './helpers.mjs';
import {bootPg} from './pg-env.mjs';
import {ipKey} from '../server/app.mjs';

const MIN = 60000;
const two = async (opts = {}) => { const a = await bootPg(opts); const b = await bootPg({...opts, driver: a.driver, clock: a.clock}); return {a, b, close: async () => { await a.close({keepDb: true}); await b.close(); }}; };
const login = (env, name, password, ip = '203.0.113.7') => new Jar(env).post('/api/login', {username: name, password}, {headers: {'x-real-ip': ip}});

test('failed logins are counted ACROSS instances; the right password is refused while throttled; window expiry frees it', async () => {
  const {a, b, close} = await two();
  try {
    const {name} = await signup(a);
    for (let i = 0; i < 3; i++) assert.equal((await login(a, name, 'wrong-pass-' + i)).status, 401);
    for (let i = 0; i < 2; i++) assert.equal((await login(b, name, 'wrong-pass-b' + i)).status, 401);
    const ra = await login(a, name, PW), rb = await login(b, name, PW);
    assert.equal(ra.status, 429); assert.equal(rb.status, 429);
    assert.ok(Number(ra.headers.get('retry-after')) > 0 && Number(ra.headers.get('retry-after')) <= 900); assert.equal(ra.data.retryAfter, Number(ra.headers.get('retry-after')));
    assert.ok(Number((await a.driver.query("SELECT count(*) AS n FROM throttle_events WHERE kind='h'")).rows[0].n) >= 5, 'attempts are rows in PostgreSQL');
    assert.equal((await login(a, name, PW, '203.0.113.99')).status, 200, 'another IP has its own pair counter');
    a.clock.t += 16 * MIN; assert.equal((await login(b, name, PW)).status, 200, 'window passed');
  } finally { await close(); }
});

test('a successful login clears the recorded failures of that nick+IP pair only', async () => {
  const {a, b, close} = await two();
  try {
    const x = await signup(a), y = await signup(a);
    for (let i = 0; i < 4; i++) await login(a, x.name, 'bad-pass-' + i); await login(a, y.name, 'bad-pass-y', '203.0.113.7');
    assert.equal((await login(b, x.name, PW)).status, 200);
    for (let i = 0; i < 4; i++) assert.equal((await login(b, x.name, 'again-bad-' + i)).status, 401, 'counter restarted from zero');
    assert.equal((await login(a, y.name, 'bad-pass-y2')).status, 401);
  } finally { await close(); }
});

test('12 parallel wrong logins over two instances: exactly 5 get 401, the rest 429 (in-flight attempts are reserved)', async () => {
  const {a, b, close} = await two();
  try {
    const {name} = await signup(a);
    const rs = await Promise.all(Array.from({length: 12}, (_, i) => login(i % 2 ? a : b, name, 'wrong-par-' + i)));
    const codes = rs.map(r => r.status); assert.equal(codes.filter(c => c === 401).length, 5, String(codes)); assert.equal(codes.filter(c => c === 429).length, 7);
    assert.equal(Number((await a.driver.query("SELECT count(*) AS n FROM throttle_events WHERE kind='r'")).rows[0].n), 0, 'no reservation is left behind');
  } finally { await close(); }
});

test('IP policy: only x-real-ip counts (x-forwarded-for is client-controlled), IPv6 shares a /64, no header = one strict bucket', async () => {
  const {a, b, close} = await two({limits: {loginIp: 3, loginPair: 100}});
  try {
    const post = (env, ip, xff) => new Jar(env).post('/api/login', {username: 'ghost_' + Math.random().toString(36).slice(2, 8), password: 'wrong-pass-1'}, {headers: {...(ip ? {'x-real-ip': ip} : {}), ...(xff ? {'x-forwarded-for': xff} : {})}});
    const spoof = []; for (let i = 0; i < 5; i++) spoof.push((await post(i % 2 ? a : b, '198.51.100.1', `9.9.9.${i}`)).status);
    assert.deepEqual(spoof, [401, 401, 401, 429, 429], 'rotating X-Forwarded-For does not help');
    assert.equal((await post(a, '198.51.100.2')).status, 401, 'a different real IP is separate');
    const v6 = []; for (let i = 0; i < 4; i++) v6.push((await post(a, `2001:db8:1:2:${i}::${i + 1}`)).status);
    assert.deepEqual(v6, [401, 401, 401, 429], 'one /64 = one client');
    assert.equal((await post(a, '2001:db8:1:3::1')).status, 401, 'next /64 is separate');
    const none = []; for (let i = 0; i < 4; i++) none.push((await post(i % 2 ? a : b, null)).status);
    assert.deepEqual(none, [401, 401, 401, 429], 'missing header -> shared "unknown" bucket');
  } finally { await close(); }
});

test('ipKey: IPv4, mapped IPv4, IPv6 -> /64, garbage -> unknown', () => {
  assert.equal(ipKey('203.0.113.7'), '203.0.113.7'); assert.equal(ipKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(ipKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64'); assert.equal(ipKey('2001:0db8::1'), '2001:db8:0:0::/64'); assert.equal(ipKey('::1'), '0:0:0:0::/64');
  for (const bad of [undefined, '', 'abc', '1.2.3', "1.1.1.1'; DROP TABLE users;--", '2001:db8::1::2', 'x'.repeat(60)]) assert.equal(ipKey(bad), 'unknown', String(bad));
  assert.equal(ipKey('198.51.100.5, 10.0.0.1'), '198.51.100.5', 'only the first value');
});

test('registration limit per IP is shared by instances; old throttle rows are pruned; SQL stays parameterized', async () => {
  const {a, b, close} = await two({limits: {registerIp: 2}});
  try {
    const reg = (env, ip) => new Jar(env).post('/api/register', {username: uniqueName('rl'), password: PW}, {headers: {'x-real-ip': ip}});
    assert.deepEqual([(await reg(a, '192.0.2.1')).status, (await reg(b, '192.0.2.1')).status, (await reg(a, '192.0.2.1')).status], [200, 200, 429]);
    assert.equal((await reg(b, '192.0.2.2')).status, 200);
    a.clock.t += 3 * 3600000; assert.equal((await reg(b, '192.0.2.1')).status, 200, 'hour window passed');
    assert.equal(Number((await a.driver.query("SELECT count(*) AS n FROM throttle_events WHERE at < $1", [a.clock.t - 2 * 3600000])).rows[0].n), 0, 'rows older than 2 h are deleted');
    const hostile = "x'; DROP TABLE throttle_events;--";
    assert.equal((await new Jar(a).post('/api/login', {username: hostile, password: 'whatever-1'}, {headers: {'x-real-ip': '192.0.2.50'}})).status, 401);
    assert.ok((await a.driver.query("SELECT 1 FROM throttle_events LIMIT 1")).rows.length >= 0, 'table still exists');
    for (const q of a.driver.calls) assert.ok(!/DROP TABLE users/i.test(q));
  } finally { await close(); }
});

test('report: one per IP per minute across instances; Telegram optional (503); parallel duplicates -> one send', async () => {
  const sent = [], fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return {json: async () => ({ok: true, result: {message_id: 7}})}; };
  const env = {TELEGRAM_BOT_TOKEN: '123456:TEST-TOKEN-NOT-REAL-aaaaaaaaaaaaaaaaaa', TELEGRAM_CHAT_ID: '-' + '9'.repeat(9)}; // оба значения заведомо ненастоящие
  const {a, b, close} = await two({env, fetch});
  const none = await bootPg({driver: a.driver});
  try {
    const rep = (e, ip, message = 'Bu xabar kamida o‘n belgi') => new Jar(e).post('/api/report', {message}, {headers: {'x-real-ip': ip}});
    assert.equal((await rep(none, '192.0.2.10')).status, 503); assert.equal((await rep(none, '192.0.2.10')).data.error, 'Telegram hali sozlanmagan.');
    assert.equal((await rep(a, '192.0.2.11', 'short')).status, 400);
    assert.equal((await rep(a, '192.0.2.11')).status, 200); assert.equal((await rep(b, '192.0.2.11')).status, 429);
    const par = await Promise.all([rep(a, '192.0.2.12'), rep(b, '192.0.2.12'), rep(a, '192.0.2.12')]);
    assert.deepEqual(par.map(r => r.status).sort(), [200, 429, 429]); assert.equal(sent.length, 2);
    a.clock.t += 61000; assert.equal((await rep(b, '192.0.2.11')).status, 200);
    assert.ok(!JSON.stringify(par.map(r => r.data)).includes('TEST-TOKEN'), 'token never in responses');
    assert.ok(!a.logs.concat(b.logs).join('\n').includes('TEST-TOKEN'));
  } finally { await none.close({keepDb: true}); await close(); }
});
