import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boot, FIXTURE_ASSET_JS, FIXTURE_ASSET_CSS, Jar, signup, uniqueName, PW, startLevel, playLesson, finishLevel, patchState, rawRequest, correctGiven, wrongGiven, T0} from './helpers.mjs';
import {makeHasher, makeLimiter, sha256} from '../server/auth.mjs';

const DAY = 86400000, MIN = 60000;

test('register: password length, username format, case-insensitive duplicates, no plaintext, real salt', async () => {
  const env = await boot();
  try {
    const j = new Jar(env), n = uniqueName('pw');
    assert.equal((await j.post('/api/register', {username: n, password: 'abc1234'})).status, 400, '7 chars rejected');
    assert.equal((await j.post('/api/register', {username: n, password: PW.repeat(30)})).status, 400, 'too long');
    assert.equal((await j.post('/api/register', {username: 'ab', password: PW})).status, 400, 'short nick');
    assert.equal((await j.post('/api/register', {username: 'bad name!', password: PW})).status, 400);
    assert.equal((await j.post('/api/register', {username: n, password: n + n})).status, 200, '8+ chars accepted');
    const k = new Jar(env);
    assert.equal((await k.post('/api/register', {username: n.toUpperCase(), password: PW})).status, 409, 'Ali/ali same');
    assert.equal((await new Jar(env).post('/api/register', {username: n + 'x', password: 'abcdefgh'})).status, 200, 'exactly 8 ok');
    const a = await signup(env), b = await signup(env);
    const rows = env.app.db.prepare('SELECT pw_hash,pw_salt FROM users WHERE username_key IN (?,?)').all(a.name.toLowerCase(), b.name.toLowerCase());
    assert.notDeepEqual(Buffer.from(rows[0].pw_hash), Buffer.from(rows[1].pw_hash), 'same password, different hashes');
    const dump = JSON.stringify(env.app.db.prepare('SELECT * FROM users').all().map(r => Object.values(r).map(v => v instanceof Uint8Array ? Buffer.from(v).toString('latin1') + Buffer.from(v).toString('hex') : v)));
    assert.ok(!dump.includes(PW), 'no plaintext password in db');
    assert.equal((await new Jar(env).post('/api/register', {username: uniqueName(), password: 12345678})).status, 400, 'non-string password');
  } finally { await env.app.close(); }
});

test('offensive, leet, repeated-letter and reserved nicknames are rejected; normal ones pass', async () => {
  const env = await boot();
  try {
    for (const bad of ['fuck', 'fvck', 'f4ck', 'F4CK_me', 'fvvck99', 'Sh1t', 'fuuuuck', 'f_u_c_k', 'pidor99', 'admin', 'Adm1n', 'JENIUS', 'moderator'])
      assert.equal((await new Jar(env).post('/api/register', {username: bad, password: PW})).status, 400, bad);
    const r = await new Jar(env).post('/api/register', {username: 'x_fuck_y', password: PW});
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'Bu nik qabul qilinmaydi', 'single generic message');
    // «gay» — самоназвание, не брань: допускается; оскорбительная форма остаётся запрещённой.
    for (const good of ['Passenger', 'classmate', 'Dilnoza_7', 'gay', 'Gay_Pride'])
      assert.equal((await new Jar(env).post('/api/register', {username: good, password: PW})).status, 200, good);
  } finally { await env.app.close(); }
});

test('login burst: attempts are reserved BEFORE hashing, so parallel wrong guesses cannot exceed the limit', async () => {
  const env = await boot({scrypt: {N: 2 ** 14}, limits: {registerIp: 100000, loginPair: 5, loginIp: 100000}});
  try {
    const {name} = await signup(env);
    const burst = await Promise.all(Array.from({length: 15}, (_, i) => new Jar(env).post('/api/login', {username: name, password: 'wrong-pass-' + i})));
    const codes = burst.map(r => r.status);
    assert.equal(codes.filter(c => c === 401).length, 5, 'exactly 5 guesses reach scrypt: ' + codes);
    assert.equal(codes.filter(c => c === 429).length, 10);
    assert.ok(burst.filter(r => r.status === 429).every(r => Number(r.headers.get('retry-after')) > 0));
    assert.equal((await new Jar(env).post('/api/login', {username: name, password: PW})).status, 429, 'locked even for the right password');
    env.clock.t += 16 * MIN;
    assert.equal((await new Jar(env).post('/api/login', {username: name, password: PW})).status, 200);
  } finally { await env.app.close(); }
});

test('login burst: per-IP rule is bounded across different usernames too', async () => {
  const env = await boot({scrypt: {N: 2 ** 14}, limits: {registerIp: 100000, loginPair: 5, loginIp: 4}});
  try {
    const burst = await Promise.all(Array.from({length: 12}, (_, i) => new Jar(env).post('/api/login', {username: 'ghost_user' + i, password: 'wrong-pass-1'})));
    const codes = burst.map(r => r.status);
    assert.equal(codes.filter(c => c === 401).length, 4, String(codes));
    assert.equal(codes.filter(c => c === 429).length, 8);
  } finally { await env.app.close(); }
});

test('limiter.reserve: success (clear) does not erase concurrent reservations; release is idempotent', () => {
  let t = 1000; const lim = makeLimiter(() => t), spec = [['k', 3, 60000]];
  const a = lim.reserve(spec), b = lim.reserve(spec), c = lim.reserve(spec);
  assert.ok(a.release && b.release && c.release);
  assert.ok(lim.reserve(spec).retryAfter > 0, 'third in flight fills the quota');
  a.release(); a.release(); lim.clear('k'); // «один вход удался»
  const d = lim.reserve(spec); assert.ok(d.release, 'one slot freed (idempotent release did not free two)');
  assert.ok(lim.reserve(spec).retryAfter > 0, 'b and c reservations still counted after clear()');
  b.release(); c.release(); d.release();
  for (let i = 0; i < 3; i++) lim.hit('k', 60000);
  assert.ok(lim.reserve(spec).retryAfter > 0, 'recorded failures count too');
  t += 61000; assert.ok(lim.reserve(spec).release, 'window expired');
});

test('login/session: generic error, throttle, fresh token, hashed token, cookie flags, expiry, logout', async () => {
  const env = await boot();
  try {
    const {name, jar, res} = await signup(env);
    const setCookie = res.headers.getSetCookie()[0];
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/); assert.match(setCookie, /Path=\//); assert.match(setCookie, /Max-Age=2592000/); assert.doesNotMatch(setCookie, /Secure/);
    const token1 = jar.cookies.get('jenius_sid');
    const row = env.app.db.prepare('SELECT token_hash FROM sessions').get();
    assert.deepEqual(Buffer.from(row.token_hash), sha256(token1), 'db stores sha256 only');
    assert.ok(!JSON.stringify(env.app.db.prepare('SELECT * FROM sessions').all().map(r => Buffer.from(r.token_hash).toString('base64url'))).includes(token1));
    const wrong = await new Jar(env).post('/api/login', {username: name, password: 'wrong-password'});
    const ghost = await new Jar(env).post('/api/login', {username: 'nobody_here', password: 'wrong-password'});
    assert.equal(wrong.status, 401); assert.equal(ghost.status, 401);
    assert.deepEqual(wrong.data, ghost.data, 'same error for unknown nick and wrong password');
    const j2 = new Jar(env); assert.equal((await j2.post('/api/login', {username: name.toUpperCase(), password: PW})).status, 200);
    assert.notEqual(j2.cookies.get('jenius_sid'), token1, 'new token on every login');
    // throttle: 5 failures then 429 (even with the right password)
    const t = new Jar(env);
    for (let i = 0; i < 4; i++) assert.equal((await t.post('/api/login', {username: name, password: 'nope-nope-' + i})).status, 401);
    const fifth = await t.post('/api/login', {username: name, password: 'nope-nope-5'}); assert.equal(fifth.status, 401);
    const sixth = await t.post('/api/login', {username: name, password: PW});
    assert.equal(sixth.status, 429); assert.ok(Number(sixth.headers.get('retry-after')) > 0);
    env.clock.t += 16 * MIN; // window passes
    assert.equal((await t.post('/api/login', {username: name, password: PW})).status, 200);
    // expiry
    env.clock.t += 31 * DAY;
    assert.equal((await jar.get('/api/me')).status, 401, 'expired session');
    // logout kills the old cookie
    const k = new Jar(env); await k.post('/api/login', {username: name, password: PW});
    const old = k.header; assert.equal((await k.get('/api/me')).status, 200);
    const out = await k.post('/api/logout', {}); assert.equal(out.status, 200);
    const replay = await new Jar(env).req('GET', '/api/me', undefined, {headers: {Cookie: old}});
    assert.equal(replay.status, 401);
  } finally { await env.app.close(); }
});

test('sliding session renewal re-issues the cookie after a day', async () => {
  const env = await boot();
  try {
    const {jar} = await signup(env);
    env.clock.t += 2 * DAY;
    const r = await jar.get('/api/me'); assert.equal(r.status, 200);
    assert.match(r.headers.getSetCookie()[0] || '', /jenius_sid=/);
    env.clock.t += 29 * DAY; assert.equal((await jar.get('/api/me')).status, 200, 'renewed beyond original 30 days');
  } finally { await env.app.close(); }
});

test('Host / Origin / Content-Type / size / invalid JSON protections', async () => {
  const env = await boot();
  try {
    const {jar, name} = await signup(env);
    assert.equal((await jar.post('/api/tier', {tier: 1}, {origin: null})).status, 403, 'no Origin');
    assert.equal((await jar.post('/api/tier', {tier: 1}, {origin: 'http://evil.example'})).status, 403, 'foreign Origin');
    assert.equal((await jar.post('/api/tier', {tier: 1}, {headers: {'Sec-Fetch-Site': 'cross-site'}})).status, 403);
    assert.equal((await jar.post('/api/tier', '{"tier":1}', {raw: true, contentType: 'text/plain'})).status, 415);
    assert.equal((await jar.post('/api/tier', '{"tier":', {raw: true})).status, 400, 'invalid JSON');
    assert.equal((await jar.post('/api/tier', '[1]', {raw: true})).status, 400, 'array body');
    assert.equal((await jar.post('/api/tier', {tier: 1, junk: 'x'.repeat(20000)})).status, 413, 'body too big');
    assert.equal((await new Jar(env).post('/api/login', {username: name, password: 'x'}, {origin: null})).status, 403, 'login needs Origin too');
    const rep = await rawRequest(env, {path: '/api/me', headers: {Host: 'evil.example'}});
    assert.equal(rep.status, 421, 'foreign Host refused');
    const rep2 = await rawRequest(env, {path: '/', headers: {Host: 'evil.example'}}); assert.equal(rep2.status, 421);
    assert.equal((await jar.post('/api/report', {message: 'x'.repeat(20)}, {origin: null})).status, 403, 'report needs Origin');
    assert.equal((await jar.post('/api/report', {message: 'x'.repeat(20)})).status, 503, 'telegram not configured');
    assert.equal((await jar.get('/api/me')).headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(env.base + '/telegram-config.json')).status, 404);
    assert.equal((await fetch(env.base + '/login')).status, 200);
    assert.equal((await new Jar(env).get('/api/me')).status, 401);
  } finally { await env.app.close(); }
});

test('allowed Hosts from option are accepted', async () => {
  const env = await boot({allowedHosts: ['192.168.1.5:4173']});
  try {
    const r = await rawRequest(env, {path: '/api/me', headers: {Host: '192.168.1.5:4173'}});
    assert.equal(r.status, 401);
  } finally { await env.app.close(); }
});

test('lessons: no skipping, server awards +20 / +30, no replay farming', async () => {
  const env = await boot();
  try {
    const {jar} = await signup(env);
    assert.equal((await startLevel(jar, 2)).status, 403, 'cannot skip level');
    let last;
    for (let l = 1; l <= 10; l++) { last = await finishLevel(jar, l); assert.equal(last.data.result.outcome, 'done'); assert.equal(last.data.result.reward, l === 10 ? 30 : 20, 'reward level ' + l); }
    assert.equal(last.data.state.coins, 9 * 20 + 30);
    assert.equal(last.data.state.completed[0].length, 10);
    assert.equal(last.data.state.streak, 1);
    const again = await finishLevel(jar, 3); assert.equal(again.data.result.reward, 0, 'replaying gives nothing');
    assert.equal(again.data.state.coins, 210);
    // replaying the final answer request must not pay twice
    const s = await startLevel(jar, 11); const L = s.data.lesson;
    for (let i = 0; i < 4; i++) await jar.post('/api/lesson/answer', {lessonId: L.id, index: i, given: correctGiven(L, i)});
    const a1 = await jar.post('/api/lesson/answer', {lessonId: L.id, index: 4, given: correctGiven(L, 4)});
    const a2 = await jar.post('/api/lesson/answer', {lessonId: L.id, index: 4, given: correctGiven(L, 4)});
    assert.equal(a1.data.result.reward, 20); assert.equal(a2.status, 200); assert.equal(a2.data.replay, true);
    assert.equal(a2.data.state.coins, 230, 'paid once');
    const a3 = await jar.post('/api/lesson/answer', {lessonId: L.id, index: 4, given: 'another'});
    assert.equal(a3.status, 409, 'different answer after finish');
  } finally { await env.app.close(); }
});

test('answers: grading on server, hearts only for choice/assemble, idempotent retry, review/retry flow', async () => {
  const env = await boot();
  try {
    const {jar} = await signup(env);
    const L = (await startLevel(jar, 1)).data.lesson;
    // q0 choice (wrong -> -1 heart)
    const w0 = await jar.post('/api/lesson/answer', {lessonId: L.id, index: 0, given: wrongGiven()});
    assert.equal(w0.data.result.correct, false); assert.equal(w0.data.state.hearts, 4); assert.ok(w0.data.result.answer);
    const w0b = await jar.post('/api/lesson/answer', {lessonId: L.id, index: 0, given: wrongGiven()});
    assert.equal(w0b.status, 200); assert.equal(w0b.data.replay, true); assert.equal(w0b.data.state.hearts, 4, 'retry of lost response: no second penalty');
    assert.deepEqual(w0b.data.result, w0.data.result);
    assert.equal((await jar.post('/api/lesson/answer', {lessonId: L.id, index: 3, given: 'x'})).status, 409, 'out of order');
    assert.equal((await jar.post('/api/lesson/answer', {lessonId: L.id, index: 1, given: 'x'.repeat(201)})).status, 400, 'given too long');
    assert.equal((await jar.post('/api/lesson/answer', {lessonId: 'nope', index: 1, given: 'x'})).status, 409);
    await jar.post('/api/lesson/answer', {lessonId: L.id, index: 1, given: correctGiven(L, 1)});
    // q2 write-en wrong -> no heart loss
    const w2 = await jar.post('/api/lesson/answer', {lessonId: L.id, index: 2, given: wrongGiven()});
    assert.equal(w2.data.state.hearts, 4, 'typing mistake keeps hearts');
    await jar.post('/api/lesson/answer', {lessonId: L.id, index: 3, given: correctGiven(L, 3)});
    // q4 write-uz: small typo accepted by fuzzy grading
    const right = correctGiven(L, 4), typo = right.length >= 7 ? right.slice(0, -1) : right;
    const f = await jar.post('/api/lesson/answer', {lessonId: L.id, index: 4, given: typo});
    assert.equal(f.data.result.outcome, 'review', 'mistakes -> review phase, no reward');
    assert.equal(f.data.state.coins, 0); assert.equal(f.data.lesson.phase, 'review');
    assert.equal((await jar.post('/api/lesson/answer', {lessonId: L.id, index: 0, given: correctGiven(L, 0)})).status, 409, 'not active in review');
    const rt = await jar.post('/api/lesson/retry', {lessonId: L.id}); assert.equal(rt.status, 200); assert.equal(rt.data.state.hearts, 4, 'hearts not returned');
    assert.equal(rt.data.lesson.index, 0);
    const end = await playLesson(jar, rt.data.lesson);
    assert.equal(end.data.result.outcome, 'done'); assert.equal(end.data.state.coins, 20); assert.equal(end.data.lesson, null);
    assert.equal((await jar.post('/api/lesson/retry', {lessonId: L.id})).status, 409);
  } finally { await env.app.close(); }
});

test('hearts: zero hearts blocks start; regeneration follows the fake clock', async () => {
  const env = await boot();
  try {
    const {jar} = await signup(env);
    let L = (await startLevel(jar, 1)).data.lesson, res;
    for (const i of [0, 1, 2, 3, 4]) res = await jar.post('/api/lesson/answer', {lessonId: L.id, index: i, given: wrongGiven()});
    assert.equal(res.data.state.hearts, 2); assert.equal(res.data.result.outcome, 'review');
    L = (await jar.post('/api/lesson/retry', {lessonId: L.id})).data.lesson;
    for (const i of [0, 1]) res = await jar.post('/api/lesson/answer', {lessonId: L.id, index: i, given: wrongGiven()});
    assert.equal(res.data.state.hearts, 0); assert.equal(res.data.result.outcome, 'no_hearts'); assert.equal(res.data.lesson, null);
    const blocked = await startLevel(jar, 1); assert.equal(blocked.status, 403); assert.equal(blocked.data.error, 'no_hearts');
    env.clock.t += 29 * MIN; assert.equal((await jar.get('/api/me')).data.state.hearts, 0);
    env.clock.t += 2 * MIN; const me = await jar.get('/api/me'); assert.equal(me.data.state.hearts, 1, '30 min later +1 heart');
    assert.equal((await startLevel(jar, 1)).status, 200);
    env.clock.t += 5 * 30 * MIN; assert.equal((await jar.get('/api/me')).data.state.hearts, 5);
  } finally { await env.app.close(); }
});

async function examReady(env) {
  const u = await signup(env);
  patchState(env, u.name, s => { s.completed[0] = Array.from({length: 50}, (_, i) => i + 1); s.tier = 0; });
  return u;
}
test('exam: 7/10 sets cooldown, early start 403, after 5 min allowed, pass at 8, abandon sets cooldown', async () => {
  const env = await boot();
  try {
    const {jar} = await examReady(env);
    let L = (await startLevel(jar, 50, 0, true)).data.lesson; assert.equal(L.total, 10);
    const r = await playLesson(jar, L, new Set([2, 4, 7])); // три ошибки ввода (без потери жизни) => 7/10
    assert.equal(r.data.result.outcome, 'exam_failed'); assert.equal(r.data.state.hearts, 5);
    const early = await startLevel(jar, 50, 0, true); assert.equal(early.status, 403); assert.equal(early.data.error, 'cooldown');
    env.clock.t += 5 * MIN + 1000;
    L = (await startLevel(jar, 50, 0, true)).data.lesson;
    const ok = await playLesson(jar, L, new Set([2, 4])); assert.equal(ok.data.result.outcome, 'exam_passed'); assert.equal(ok.data.state.passed[0], true);
    assert.equal(ok.data.state.coins, 0, 'exam never pays');
    // abandon => cooldown
    env.clock.t += 6 * MIN;
    L = (await startLevel(jar, 50, 0, true)).data.lesson;
    assert.equal((await jar.post('/api/lesson/abandon', {lessonId: L.id})).status, 200);
    assert.equal((await startLevel(jar, 50, 0, true)).status, 403);
    assert.equal((await startLevel(jar, 51, 0, true)).status, 400);
  } finally { await env.app.close(); }
});

test('exam: not available before 50 levels; stale exam (>30 min) counts as abandoned', async () => {
  const env = await boot();
  try {
    const a = await signup(env); assert.equal((await startLevel(a.jar, 50, 0, true)).status, 403);
    const {jar} = await examReady(env);
    await startLevel(jar, 50, 0, true);
    env.clock.t += 31 * MIN;
    const me = await jar.get('/api/me'); assert.equal(me.data.lesson, null);
    assert.ok(me.data.state.retryAt[0] > env.clock.t - 1, 'cooldown after stale exam');
    assert.equal((await startLevel(jar, 50, 0, true)).status, 403);
    env.clock.t += 6 * MIN; assert.equal((await startLevel(jar, 50, 0, true)).status, 200);
  } finally { await env.app.close(); }
});

test('shop: prices through API, no negative coins, concurrent buys cannot double-spend', async () => {
  const env = await boot();
  try {
    const {jar, name} = await signup(env);
    assert.equal((await jar.post('/api/shop/buy', {item: 'heart'})).data.purchase.ok, false, 'full hearts');
    patchState(env, name, s => { s.hearts = 2; s.coins = 100; });
    const poor = await jar.post('/api/shop/buy', {item: 'heart'});
    assert.equal(poor.data.purchase.ok, false); assert.equal(poor.data.state.coins, 100);
    assert.equal((await jar.post('/api/shop/buy', {item: 'bogus'})).data.purchase.ok, false);
    assert.equal((await jar.post('/api/shop/buy', {item: 5})).status, 400);
    patchState(env, name, s => { s.coins = 150; });
    const [x, y] = await Promise.all([jar.post('/api/shop/buy', {item: 'heart'}), jar.post('/api/shop/buy', {item: 'heart'})]);
    assert.deepEqual([x.data.purchase.ok, y.data.purchase.ok].sort(), [false, true]);
    const st = (await jar.get('/api/me')).data.state; assert.equal(st.coins, 0); assert.equal(st.hearts, 3);
    patchState(env, name, s => { s.coins = 300; });
    const f1 = await jar.post('/api/shop/buy', {item: 'freeze'}), f2 = await jar.post('/api/shop/buy', {item: 'freeze'});
    assert.equal(f1.data.purchase.ok, true); assert.equal(f2.data.purchase.ok, false); assert.equal(f2.data.state.coins, 0);
  } finally { await env.app.close(); }
});

test('state tampering is impossible: no state-write routes, extra fields ignored', async () => {
  const env = await boot();
  try {
    const {jar} = await signup(env);
    for (const m of ['PUT', 'PATCH', 'POST']) assert.ok([404, 405].includes((await jar.req(m, '/api/state', {coins: 99999, hearts: 5})).status), m + ' /api/state');
    assert.equal((await jar.req('PUT', '/api/me', {coins: 9})).status, 405);
    const t = await jar.post('/api/tier', {tier: 2, coins: 99999, hearts: 99, completed: [[1, 2, 3], [], [], []], state: {coins: 5}});
    assert.equal(t.status, 200); assert.equal(t.data.state.tier, 2); assert.equal(t.data.state.coins, 0); assert.equal(t.data.state.completed[0].length, 0);
    assert.equal((await jar.post('/api/tier', {tier: 9})).status, 400);
    assert.equal((await jar.post('/api/tier', {tier: '1'})).status, 400);
    assert.equal((await jar.post('/api/tier', {tier: 0})).status, 200);
    const s = await jar.post('/api/lesson/start', {tier: 0, level: 1, exam: false, coins: 5, state: {coins: 999}});
    assert.equal(s.data.state.coins, 0);
    assert.equal((await jar.post('/api/lesson/start', {tier: 1, level: 1})).status, 409, 'tier mismatch');
    assert.equal((await jar.post('/api/lesson/start', {tier: 0, level: 1.5})).status, 400);
    assert.equal((await jar.post('/api/lesson/start', {tier: 0, level: 1, exam: 'yes'})).status, 400);
    assert.equal((await new Jar(env).post('/api/shop/buy', {item: 'heart'})).status, 401);
  } finally { await env.app.close(); }
});

test('two devices: shared progress, last lesson start wins (409), data survives refetch', async () => {
  const env = await boot();
  try {
    const {jar: a, name} = await signup(env);
    const b = new Jar(env); assert.equal((await b.post('/api/login', {username: name, password: PW})).status, 200);
    await finishLevel(a, 1);
    const seen = await b.get('/api/me'); assert.deepEqual(seen.data.state.completed[0], [1]); assert.equal(seen.data.state.coins, 20);
    const A = (await startLevel(a, 2)).data.lesson;
    const B = (await startLevel(b, 2)).data.lesson; assert.notEqual(A.id, B.id);
    const stale = await a.post('/api/lesson/answer', {lessonId: A.id, index: 0, given: correctGiven(A, 0)});
    assert.equal(stale.status, 409); assert.equal(stale.data.error, 'lesson_superseded'); assert.ok(stale.data.state, 'state included for resync');
    assert.equal((await a.post('/api/lesson/abandon', {lessonId: A.id})).status, 409, 'stale tab cannot abandon newer lesson');
    assert.equal((await b.get('/api/me')).data.lesson.id, B.id);
    const ok = await b.post('/api/lesson/answer', {lessonId: B.id, index: 0, given: correctGiven(B, 0)}); assert.equal(ok.status, 200);
    assert.equal((await a.get('/api/me')).data.lesson.index, 1, 'other device resumes mid-lesson');
  } finally { await env.app.close(); }
});

test('streak: one per day, resets after missing days (server clock)', async () => {
  const env = await boot();
  try {
    const {jar} = await signup(env);
    await finishLevel(jar, 1); const same = await finishLevel(jar, 2); assert.equal(same.data.state.streak, 1);
    env.clock.t += DAY; assert.equal((await finishLevel(jar, 3)).data.state.streak, 2);
    env.clock.t += 3 * DAY; assert.equal((await jar.get('/api/me')).data.state.streak, 0);
  } finally { await env.app.close(); }
});

test('persistence: accounts, progress and sessions survive a server restart (file db)', async () => {
  const dbPath = new URL('./.data/restart.db', import.meta.url).pathname;
  let env = await boot({dbPath});
  const name = uniqueName('rs');
  const {jar} = await signup(env, name);
  await finishLevel(jar, 1); await jar.post('/api/tier', {tier: 1});
  const cookie = jar.header; await env.app.close();
  env = await boot({dbPath});
  try {
    const old = new Jar(env); old.cookies = new Map([[...cookie.split('=')].slice(0, 2)]);
    const me = await old.get('/api/me'); assert.equal(me.status, 200, 'session cookie still valid after restart'); assert.equal(me.data.user.username, name);
    assert.equal(me.data.state.coins, 20); assert.equal(me.data.state.tier, 1);
    const fresh = new Jar(env); assert.equal((await fresh.post('/api/login', {username: name, password: PW})).status, 200);
    assert.deepEqual((await fresh.get('/api/me')).data.state.completed[0], [1]);
    assert.equal((await new Jar(env).post('/api/register', {username: name, password: PW})).status, 409, 'account persisted');
  } finally { await env.app.close(); }
});

test('local progress import: registration only, sanitized and capped, never on login', async () => {
  const env = await boot();
  try {
    const good = {version: 1, tier: 1, hearts: 3, coins: 999999, regenAt: T0 + 10 * DAY, completed: [[1, 2, 3], [], [], []], passed: [true, false, false, false], retryAt: [T0 + 99 * DAY, 0, 0, 0], streak: 500, lastDay: '2999-01-01', freeze: 7};
    const r = await signup(env, uniqueName('im'), {importLocal: good});
    assert.equal(r.res.data.imported, true);
    const s = r.res.data.state;
    assert.equal(s.coins, 60, 'coins capped to what 3 levels can earn'); assert.equal(s.passed[0], false, 'passed needs 50 levels');
    assert.equal(s.streak, 0); assert.equal(s.lastDay, null); assert.equal(s.freeze, 0); assert.ok(s.retryAt[0] <= T0 + 5 * MIN); assert.equal(s.hearts, 3);
    assert.ok(s.regenAt <= T0 + 30 * MIN);
    for (const bad of [{...good, completed: [[1, 3], [], [], []]}, {...good, completed: [[2, 1], [], [], []]}, {...good, version: 2}, {...good, completed: [Array.from({length: 51}, (_, i) => i + 1), [], [], []]}, 'junk', [], {...good, tier: 9}]) {
      const x = await signup(env, uniqueName('im'), {importLocal: bad});
      assert.equal(x.res.data.imported, false); assert.equal(x.res.data.importNote, 'invalid'); assert.equal(x.res.data.state.coins, 0); assert.equal(x.res.data.state.completed[0].length, 0);
    }
    // login never imports
    const j = new Jar(env); const l = await j.post('/api/login', {username: r.name, password: PW, importLocal: {...good, coins: 1}});
    assert.equal(l.status, 200); assert.equal(l.data.state.coins, 60); assert.equal(l.data.imported, undefined);
    assert.equal((await j.get('/api/me')).data.state.coins, 60);
    const big = await signup(env, uniqueName('im'), {importLocal: {...good, completed: [Array.from({length: 50}, (_, i) => i + 1), Array.from({length: 50}, (_, i) => i + 1), [], []], passed: [true, true, false, false], coins: 1e9}});
    assert.equal(big.res.data.state.coins, 2100); assert.equal(big.res.data.state.passed[1], true);
    assert.equal((await new Jar(env).post('/api/register', {username: uniqueName('im'), password: PW, importLocal: {version: 1, junk: 'x'.repeat(20000)}})).status, 413);
  } finally { await env.app.close(); }
});

test('register throttle per IP and bounded password-hash concurrency', async () => {
  const env = await boot({limits: {registerIp: 5, loginPair: 5, loginIp: 100}});
  try {
    for (let i = 0; i < 5; i++) assert.equal((await new Jar(env).post('/api/register', {username: uniqueName('rl'), password: PW})).status, 200);
    const r = await new Jar(env).post('/api/register', {username: uniqueName('rl'), password: PW});
    assert.equal(r.status, 429); assert.ok(r.headers.get('retry-after'));
    env.clock.t += 61 * MIN; assert.equal((await new Jar(env).post('/api/register', {username: uniqueName('rl'), password: PW})).status, 200);
  } finally { await env.app.close(); }
  const h = makeHasher({scrypt: {N: 1024}, concurrency: 1, maxQueue: 1});
  const results = await Promise.allSettled([h.hash('password-one'), h.hash('password-two'), h.hash('password-three')]);
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'fulfilled', 'rejected']);
  assert.equal(results[2].reason.status, 503);
});

// «client source» проверки форм/ключей перенесены в tests/ui/auth.test.jsx (настоящий рендер React-форм) и tests/static.test.mjs.
test('server serves the auth pages and the built client assets; legacy module paths are gone', async () => {
  const env = await boot();
  try {
    for (const p of ['/', '/login', '/register', `/assets/${FIXTURE_ASSET_JS}`, `/assets/${FIXTURE_ASSET_CSS}`]) assert.equal((await fetch(env.base + p)).status, 200, p);
    for (const p of ['/app.mjs', '/engine.mjs', '/data.mjs', '/style.css', '/sound.mjs', '/keys.mjs', '/public/app.mjs', '/shared/engine.mjs']) assert.equal((await fetch(env.base + p)).status, 404, 'legacy/shared path must not be served: ' + p);
    for (const p of ['/server.mjs', '/server/db.mjs', '/data/jenius.db', '/PLAN-accounts.md']) assert.equal((await fetch(env.base + p)).status, 404, p);
  } finally { await env.app.close(); }
});
