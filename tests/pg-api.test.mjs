// API поверх НАСТОЯЩЕГО PostgreSQL (PGlite) через серверную функцию Vercel: те же правила, что и в SQLite-версии.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Jar, signup, uniqueName, PW, startLevel, playLesson, finishLevel, correctGiven, wrongGiven} from './helpers.mjs';
import {bootPg, patchPg, pgState} from './pg-env.mjs';
import {sha256} from '../server/auth.mjs';
import {courseQuestions} from '../shared/data.mjs';

const DAY = 86400000, SID = '__Host-jenius_sid';
const shared = await bootPg();
test.after(() => shared.close());
const me = async jar => (await jar.get('/api/me')).data;

test('register: nick/password rules, salted scrypt hash, sha256 session token, secure cookie by default', async () => {
  const env = shared, jar = new Jar(env), name = uniqueName('pg');
  assert.equal((await jar.post('/api/register', {username: 'ab', password: PW})).status, 400, 'nick too short');
  assert.equal((await jar.post('/api/register', {username: name, password: 'short12'})).status, 400, '7 chars < minimum 8');
  assert.equal((await jar.post('/api/register', {username: name, password: name})).status, 400, 'password = nickname');
  assert.equal((await jar.post('/api/register', {username: 'bad name!', password: PW})).status, 400);
  const ok = await jar.post('/api/register', {username: name, password: 'exactly8'});
  assert.equal(ok.status, 200); assert.equal(ok.data.user.username, name); assert.equal(ok.data.state.activeCourse, null);
  const sc = ok.headers.getSetCookie()[0];
  for (const re of [/^__Host-jenius_sid=/, /HttpOnly/, /SameSite=Strict/, /Path=\//, /Max-Age=2592000/, /; Secure/]) assert.match(sc, re);
  const {rows} = await env.driver.query('SELECT token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.username_key=$1', [name.toLowerCase()]);
  assert.deepEqual(Buffer.from(rows[0].token_hash), sha256(jar.cookies.get(SID)), 'only sha256 of the token is stored');
  // два игрока с одинаковым паролем: разная соль и разный хеш; пароль нигде не лежит открытым текстом
  const other = uniqueName('pg'); await new Jar(env).post('/api/register', {username: other, password: 'exactly8'});
  const u = (await env.driver.query('SELECT pw_hash,pw_salt,pw_params FROM users WHERE username_key IN ($1,$2) ORDER BY id', [name.toLowerCase(), other.toLowerCase()])).rows;
  assert.equal(u.length, 2); assert.notDeepEqual(Buffer.from(u[0].pw_hash), Buffer.from(u[1].pw_hash)); assert.notDeepEqual(Buffer.from(u[0].pw_salt), Buffer.from(u[1].pw_salt));
  assert.equal(Buffer.from(u[0].pw_hash).length, 32); assert.equal(JSON.parse(u[0].pw_params).keylen, 32);
  const dump = JSON.stringify((await env.driver.query('SELECT * FROM users')).rows.map(r => Object.values(r).map(v => v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : v)));
  assert.ok(!dump.includes('exactly8'));
  assert.equal((await new Jar(env).post('/api/register', {username: name.toUpperCase(), password: PW})).status, 409, 'nick is unique case-insensitively');
});

test('concurrent registration of the same nick: exactly one account', async () => {
  const name = uniqueName('race'), rs = await Promise.all(Array.from({length: 5}, () => new Jar(shared).post('/api/register', {username: name, password: PW})));
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 409, 409, 409, 409]);
  assert.equal(Number((await shared.driver.query('SELECT count(*) AS n FROM users WHERE username_key=$1', [name.toLowerCase()])).rows[0].n), 1);
  assert.equal(Number((await shared.driver.query('SELECT count(*) AS n FROM progress p JOIN users u ON u.id=p.user_id WHERE u.username_key=$1', [name.toLowerCase()])).rows[0].n), 1);
});

test('login / logout / generic error / new token every login', async () => {
  const env = shared, {name, jar} = await signup(env), first = jar.cookies.get(SID);
  const wrong = await new Jar(env).post('/api/login', {username: name, password: 'wrong-password'}, {headers: {'x-real-ip': '10.1.1.1'}});
  const ghost = await new Jar(env).post('/api/login', {username: 'nobody_here_x', password: 'wrong-password'}, {headers: {'x-real-ip': '10.1.1.2'}});
  assert.equal(wrong.status, 401); assert.deepEqual(wrong.data, ghost.data, 'same message for unknown nick and wrong password');
  const j2 = new Jar(env), ok = await j2.post('/api/login', {username: name.toUpperCase(), password: PW});
  assert.equal(ok.status, 200); assert.equal(ok.data.user.username, name); assert.notEqual(j2.cookies.get(SID), first);
  assert.equal((await j2.post('/api/logout', {})).status, 200); assert.equal(j2.cookies.size, 0, 'cookie cleared');
  assert.equal((await j2.get('/api/me')).status, 401);
  assert.equal((await jar.get('/api/me')).status, 200, 'other session is untouched by logout');
  const stale = new Jar(env); stale.cookies.set(SID, jar.cookies.get(SID)); await stale.post('/api/logout', {});
  assert.equal((await jar.get('/api/me')).status, 401, 'logout deleted the server-side session');
  assert.equal((await new Jar(env).post('/api/login', {username: name, password: PW}, {raw: true})).status, 400, 'invalid JSON');
});

test('session: renewal after a day, expiry after 30 days, at most 10 sessions per user (even for parallel logins)', async () => {
  const env = await bootPg({driver: shared.driver}), {name, jar} = await signup(env);
  try {
    const row = async () => (await env.driver.query('SELECT s.expires_at,s.last_seen FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.username_key=$1', [name.toLowerCase()])).rows;
    const [s0] = await row(); env.clock.t += 3600000;
    const quick = await jar.get('/api/me'); assert.equal(quick.headers.getSetCookie().length, 0, 'no renewal within a day');
    env.clock.t += 2 * DAY; const renew = await jar.get('/api/me');
    assert.equal(renew.status, 200); assert.match(renew.headers.getSetCookie()[0], /Max-Age=2592000/);
    const [s1] = await row(); assert.ok(s1.expires_at > s0.expires_at && s1.last_seen > s0.last_seen, 'renewed in the database');
    const keep = jar.cookies.get(SID);
    env.clock.t += 31 * DAY;
    const dead = await jar.get('/api/me'); assert.equal(dead.status, 401); assert.match(dead.headers.getSetCookie()[0], /Max-Age=0/);
    assert.equal((await row()).length, 0, 'expired session deleted'); assert.ok(keep);
    const burst = await Promise.all(Array.from({length: 14}, () => new Jar(env).post('/api/login', {username: name, password: PW}, {headers: {'x-real-ip': '10.2.2.2'}})));
    assert.ok(burst.every(r => r.status === 200 || r.status === 429)); assert.ok(burst.filter(r => r.status === 200).length >= 1);
    assert.ok((await row()).length <= 10, 'session cap');
  } finally { await env.close({keepDb: true}); }
});

test('progression: en and ru are separate courses with one shared wallet (hearts/coins/streak)', async () => {
  const env = shared, {jar, name} = await signup(env, uniqueName('pr'), {}, {course: 'en'});
  assert.equal((await startLevel(jar, 3)).status, 403, 'level 3 is locked');
  const done = await finishLevel(jar, 1); assert.equal(done.data.result.outcome, 'done'); assert.ok(done.data.result.reward > 0);
  const en = (await me(jar)).state; assert.deepEqual(en.courses.en.completed[0], [1]); assert.equal(en.coins, done.data.result.reward); assert.equal(en.streak, 1);
  assert.equal((await startLevel(jar, 3)).status, 403, 'still locked');
  assert.equal((await jar.post('/api/course', {course: 'ru'})).status, 200);
  const ru0 = (await me(jar)).state; assert.deepEqual(ru0.courses.ru.completed, [[], [], [], []]); assert.equal(ru0.coins, en.coins, 'wallet is shared'); assert.equal(ru0.activeCourse, 'ru');
  const ru = await finishLevel(jar, 1); assert.equal(ru.data.result.outcome, 'done');
  const both = (await me(jar)).state;
  assert.deepEqual(both.courses.ru.completed[0], [1]); assert.deepEqual(both.courses.en.completed[0], [1]);
  assert.equal(both.coins, en.coins + ru.data.result.reward); assert.equal(both.streak, 1, 'one streak for both courses');
  const stored = await pgState(env, name); assert.equal(stored.courses.ru.completed[0].length, 1);
  assert.equal((await jar.post('/api/course', {course: 'de'})).data.error, 'bad_course');
  const q = courseQuestions('ru', 0, 1, false); assert.ok(q.length === 5);
});

test('hearts: wrong answers cost shared hearts, no_hearts ends the lesson, en and ru see the same hearts', async () => {
  const env = shared, {jar, name} = await signup(env, uniqueName('ht')), lvl = 1;
  assert.ok(courseQuestions('en', 0, lvl, false).some(q => !q.type.startsWith('write')));
  await patchPg(env, name, s => { s.hearts = 1; });
  const s = await startLevel(jar, lvl); assert.equal(s.status, 200);
  let last; for (let i = 0; i < 5; i++) { last = await jar.post('/api/lesson/answer', {lessonId: s.data.lesson.id, index: i, given: wrongGiven()}); if (last.data.result.outcome !== 'continue') break; }
  assert.equal(last.data.result.outcome, 'no_hearts'); assert.equal(last.data.state.hearts, 0);
  assert.equal((await startLevel(jar, lvl)).status, 403, 'no hearts: cannot start');
  await jar.post('/api/course', {course: 'ru'}); assert.equal((await me(jar)).state.hearts, 0, 'ru shares the same hearts');
  assert.equal((await startLevel(jar, lvl)).data.error, 'no_hearts');
});

test('fuzzy Uzbek (write-uz) works on PostgreSQL the same as in SQLite: a typo is accepted with a note', async () => {
  const {gradeAnswer} = await import('../server/grade.mjs');
  let found;
  for (let level = 1; level <= 50 && !found; level++) courseQuestions('en', 0, level, false).forEach((q, idx) => {
    if (found || q.type !== 'write-uz') return;
    const a = gradeAnswer(q, 'x', 'en').answer, typo = a.slice(0, -1) + (a.at(-1) === 'a' ? 'o' : 'a'), g = gradeAnswer(q, typo, 'en');
    if (g.ok && g.typo) found = {level, idx, typo, a};
  });
  assert.ok(found, 'a write-uz question with an accepted typo exists');
  const env = shared, u = await signup(env, uniqueName('fz')); await patchPg(env, u.name, s => { s.completed[0] = Array.from({length: found.level - 1}, (_, i) => i + 1); });
  const st = await startLevel(u.jar, found.level, 0); assert.equal(st.status, 200, JSON.stringify(st.data));
  const lesson = st.data.lesson;
  for (let i = 0; i < found.idx; i++) assert.equal((await u.jar.post('/api/lesson/answer', {lessonId: lesson.id, index: i, given: correctGiven(lesson, i)})).data.result.correct, true);
  const r = await u.jar.post('/api/lesson/answer', {lessonId: lesson.id, index: found.idx, given: found.typo});
  assert.equal(r.data.result.correct, true); assert.ok(r.data.result.note, 'typo note'); assert.ok(r.data.result.typo);
  const hard = await signup(env, uniqueName('fz2')); await patchPg(env, hard.name, s => { s.completed[0] = Array.from({length: found.level - 1}, (_, i) => i + 1); });
  const l2 = (await startLevel(hard.jar, found.level, 0)).data.lesson;
  for (let i = 0; i < found.idx; i++) await hard.jar.post('/api/lesson/answer', {lessonId: l2.id, index: i, given: correctGiven(l2, i)});
  assert.equal((await hard.jar.post('/api/lesson/answer', {lessonId: l2.id, index: found.idx, given: 'zzzzzzz'})).data.result.correct, false);
});

test('lesson answer idempotence: 8 parallel copies of the final answer give ONE reward and replays', async () => {
  const env = shared, {jar, name} = await signup(env), s = await startLevel(jar, 1), lesson = s.data.lesson;
  for (let i = 0; i < 4; i++) assert.equal((await jar.post('/api/lesson/answer', {lessonId: lesson.id, index: i, given: correctGiven(lesson, i)})).data.result.outcome, 'continue');
  const body = {lessonId: lesson.id, index: 4, given: correctGiven(lesson, 4)};
  const rs = await Promise.all(Array.from({length: 8}, () => jar.post('/api/lesson/answer', body)));
  assert.ok(rs.every(r => r.status === 200)); assert.equal(rs.filter(r => !r.data.replay).length, 1, 'exactly one real answer'); assert.equal(rs.filter(r => r.data.replay).length, 7);
  const reward = rs.find(r => !r.data.replay).data.result.reward; assert.ok(reward > 0);
  const st = await pgState(env, name); assert.equal(st.coins, reward, 'rewarded once'); assert.deepEqual(st.courses.en.completed[0], [1]);
  const solo = await signup(env), done = await finishLevel(solo.jar, 1); assert.equal(done.data.result.reward, reward, 'same reward as an ordinary run');
  assert.equal((await jar.post('/api/lesson/answer', {...body, index: 3})).data.error, 'lesson_not_active', 'finished lesson accepts no more new answers');
});

test('shop: parallel purchases from TWO function instances cannot double-spend', async () => {
  const a = await bootPg({driver: shared.driver}), b = await bootPg({driver: shared.driver});
  try {
    const {jar, name} = await signup(a), jb = new Jar(b); jb.cookies = new Map(jar.cookies);
    await patchPg(a, name, s => { s.hearts = 2; s.coins = 150; });
    const rs = await Promise.all([jar.post('/api/shop/buy', {item: 'heart'}), jb.post('/api/shop/buy', {item: 'heart'}), jar.post('/api/shop/buy', {item: 'heart'}), jb.post('/api/shop/buy', {item: 'heart'})]);
    assert.deepEqual(rs.map(r => r.data.purchase.ok).sort(), [false, false, false, true]);
    const st = await pgState(a, name); assert.equal(st.coins, 0); assert.equal(st.hearts, 3);
    await patchPg(a, name, s => { s.coins = 300; });
    const fr = await Promise.all([jar.post('/api/shop/buy', {item: 'freeze'}), jb.post('/api/shop/buy', {item: 'freeze'})]);
    assert.deepEqual(fr.map(r => r.data.purchase.ok).sort(), [false, true]); assert.equal((await pgState(a, name)).coins, 0);
    assert.equal((await jar.post('/api/shop/buy', {item: 5})).status, 400); assert.equal((await new Jar(a).post('/api/shop/buy', {item: 'heart'})).status, 401);
  } finally { await a.close({keepDb: true}); await b.close({keepDb: true}); }
});

test('revision counter grows only when the state really changes; unchanged reads write nothing', async () => {
  const env = shared, {jar, name} = await signup(env), rev = async () => Number((await env.driver.query('SELECT p.rev FROM progress p JOIN users u ON u.id=p.user_id WHERE u.username_key=$1', [name.toLowerCase()])).rows[0].rev);
  const r0 = await rev(); await jar.get('/api/me'); await jar.get('/api/me'); assert.equal(await rev(), r0);
  await jar.post('/api/course', {course: 'ru'}); assert.equal(await rev(), r0 + 1);
});
