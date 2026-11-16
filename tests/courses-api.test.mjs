import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, mkdtempSync, rmSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {boot, signup, Jar, uniqueName, PW, T0, startLevel, playLesson, finishLevel, correctGiven, wrongGiven, patchState} from './helpers.mjs';
import {courseQuestions, answerOf, promptOf, WORDS_RU} from '../shared/data.mjs';
import {downgradeState} from '../shared/engine.mjs';

const MIN = 60000, DAY = 86400000;
const here = path.dirname(fileURLToPath(import.meta.url));
const full = () => Array.from({length: 50}, (_, i) => i + 1);
const course = (jar, c) => jar.post('/api/course', {course: c});
const me = async jar => (await jar.get('/api/me')).data;
async function ruUser(env, tier = 0) { const u = await signup(env, undefined, {}, {course: 'ru'}); await u.jar.post('/api/tier', {tier}); return u; }

test('new account: no course -> start/tier are 409 no_course, then it must pick a course and a tier', async () => {
  const env = await boot();
  try {
    const {jar, res} = await signup(env, undefined, {}, {course: null});
    assert.equal(res.data.state.activeCourse, null); assert.equal(res.data.lesson, null); assert.equal(res.data.state.tier, null);
    assert.equal((await startLevel(jar, 1)).status, 409); assert.equal((await startLevel(jar, 1)).data.error, 'no_course');
    assert.equal((await jar.post('/api/tier', {tier: 0})).data.error, 'no_course');
    assert.equal((await jar.post('/api/lesson/start', {tier: 0, level: 1, course: 'ru'})).data.error, 'no_course');
    const c = await course(jar, 'ru'); assert.equal(c.status, 200); assert.equal(c.data.state.activeCourse, 'ru'); assert.equal(c.data.state.tier, null, 'tier still to be chosen for this course');
    assert.equal((await jar.post('/api/tier', {tier: 2})).data.state.tier, 2);
    const s = await startLevel(jar, 1, 2); assert.equal(s.status, 200); assert.equal(s.data.lesson.course, 'ru');
  } finally { await env.app.close(); }
});

test('/api/course: authenticated, validated, idempotent', async () => {
  const env = await boot();
  try {
    assert.equal((await new Jar(env).post('/api/course', {course: 'ru'})).status, 401);
    const {jar} = await signup(env);
    for (const bad of [{}, {course: 'de'}, {course: ''}, {course: null}, {course: 1}, {course: ['ru']}, {course: {}}, {course: '__proto__'}, {course: 'constructor'}, {course: 'RU'}, {course: 'ru '}]) {
      const r = await jar.post('/api/course', bad); assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.data.error, 'bad_course'); assert.equal(r.data.state.activeCourse, 'en');
    }
    assert.equal((await jar.req('GET', '/api/course')).status, 405);
    assert.equal((await jar.post('/api/course', {course: 'ru'}, {origin: 'http://evil.example'})).status, 403);
    assert.equal((await me(jar)).state.activeCourse, 'en');
    const r = await course(jar, 'en'); assert.equal(r.status, 200); assert.equal(r.data.abandoned ?? null, null);
    // choosing the same course while a lesson is running does NOT abandon it
    const s = await startLevel(jar, 1); const same = await course(jar, 'en');
    assert.equal(same.data.lesson.id, s.data.lesson.id); assert.equal(same.data.abandoned ?? null, null);
  } finally { await env.app.close(); }
});

test('mismatched course in tier/start is 409 course_mismatch and changes nothing', async () => {
  const env = await boot();
  try {
    const {jar} = await signup(env);
    const t = await jar.post('/api/tier', {tier: 1, course: 'ru'}); assert.equal(t.status, 409); assert.equal(t.data.error, 'course_mismatch'); assert.equal(t.data.state.tier, null);
    const s = await jar.post('/api/lesson/start', {tier: 0, level: 1, course: 'ru'}); assert.equal(s.status, 409); assert.equal(s.data.error, 'course_mismatch'); assert.equal(s.data.lesson, null);
    assert.equal((await jar.post('/api/lesson/start', {tier: 0, level: 1, course: 'en'})).status, 200);
  } finally { await env.app.close(); }
});

test('Russian lesson: server serves Russian questions, awards +20 once, English progress untouched', async () => {
  const env = await boot();
  try {
    const {jar} = await ruUser(env);
    const s = await startLevel(jar, 1); assert.equal(s.data.lesson.course, 'ru');
    const items = courseQuestions('ru', 0, 1, false);
    const leaves = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') for (const x of Object.values(v)) leaves(x, out); return out; };
    const noLeak = (data, where) => { const text = leaves(data), joined = JSON.stringify(data);
      for (const q of items) for (const a of [q.word.t, q.word.uz, ...q.choices]) { assert.ok(!text.includes(a), where + ' leaks "' + a + '"'); if (a.length >= 5) assert.ok(!joined.includes(a), where + ' contains "' + a + '"'); } };
    noLeak(s.data, 'start response'); noLeak(await me(jar), '/api/me');
    const done = await playLesson(jar, s.data.lesson); assert.equal(done.data.result.outcome, 'done'); assert.equal(done.data.result.reward, 20);
    assert.equal(done.data.state.coins, 20); assert.deepEqual(done.data.state.completed[0], [1]);
    const replay = await finishLevel(jar, 1); assert.equal(replay.data.result.reward, 0); assert.equal(replay.data.state.coins, 20, 'no replay farming');
    const en = await course(jar, 'en'); assert.deepEqual(en.data.state.completed, [[], [], [], []], 'English progress untouched'); assert.equal(en.data.state.coins, 20, 'shared wallet');
    assert.deepEqual(en.data.state.courses.ru.completed[0], [1]);
    // client-supplied rewards/state are ignored
    const e = await startLevel(jar, 1); const x = await jar.post('/api/lesson/answer', {lessonId: e.data.lesson.id, index: 0, given: correctGiven(e.data.lesson, 0), reward: 999, coins: 999, course: 'ru', state: {coins: 999}});
    assert.equal(x.data.state.coins, 20); assert.equal(e.data.lesson.course, 'en');
  } finally { await env.app.close(); }
});

test('shared wallet: hearts, coins, streak and purchases are one pool; switching never refills or farms', async () => {
  const env = await boot();
  try {
    const {jar, name} = await ruUser(env);
    // one correct day of ru lessons, then a streak of 1 visible in en too
    await finishLevel(jar, 1);
    let en = await course(jar, 'en'); await jar.post('/api/tier', {tier: 0}); assert.equal(en.data.state.streak, 1); assert.equal(en.data.state.coins, 20);
    await finishLevel(jar, 1); assert.equal((await me(jar)).state.streak, 1, 'same day: still one streak day across courses');
    assert.equal((await me(jar)).state.coins, 40);
    // lose hearts in en with wrong choice answers -> gone in ru as well
    const l = (await startLevel(jar, 2)).data.lesson;
    const r = await jar.post('/api/lesson/answer', {lessonId: l.id, index: 0, given: wrongGiven()}); assert.equal(r.data.state.hearts, 4);
    const ru = await course(jar, 'ru'); assert.equal(ru.data.state.hearts, 4, 'heart lost in en is gone in ru'); assert.ok(ru.data.state.regenAt);
    assert.equal(ru.data.abandoned.cooldown, false);
    const regen = ru.data.state.regenAt;
    for (let i = 0; i < 5; i++) { await course(jar, i % 2 ? 'ru' : 'en'); } // flip a lot
    const s = (await me(jar)).state; assert.equal(s.hearts, 4); assert.equal(s.regenAt, regen, 'switching does not touch regen'); assert.equal(s.coins, 40);
    // buy once -> shared
    patchState(env, name, st => { st.coins = 1000; }); const b = await jar.post('/api/shop/buy', {item: 'heart'}); assert.equal(b.data.purchase.ok, true);
    const other = await course(jar, s.activeCourse === 'en' ? 'ru' : 'en'); assert.equal(other.data.state.hearts, 5); assert.equal(other.data.state.coins, 850);
    assert.equal((await jar.post('/api/shop/buy', {item: 'heart'})).data.purchase.ok, false, 'already full');
    // zero hearts block starting in BOTH courses
    patchState(env, name, st => { st.hearts = 0; st.regenAt = env.clock.t + 30 * MIN; });
    for (const c of ['en', 'ru']) { await course(jar, c); await jar.post('/api/tier', {tier: 0}); const x = await startLevel(jar, 1); assert.equal(x.status, 403); assert.equal(x.data.error, 'no_hearts'); }
    // streak is shared across days
    patchState(env, name, st => { st.hearts = 5; st.regenAt = null; });
    env.clock.t += DAY; await course(jar, 'ru'); await finishLevel(jar, 2); assert.equal((await me(jar)).state.streak, 2);
    await course(jar, 'en'); assert.equal((await me(jar)).state.streak, 2);
  } finally { await env.app.close(); }
});

test('exam cooldowns, passes and completion are per course', async () => {
  const env = await boot();
  try {
    const u = await signup(env, undefined, {}, {course: 'en'}); const {jar, name} = u;
    patchState(env, name, s => { s.completed[0] = full(); s.tier = 0; }, 'en');
    patchState(env, name, s => { s.completed[0] = full(); s.tier = 0; }, 'ru');
    // fail the English exam (7/10): English cooldown only
    const ex = (await startLevel(jar, 50, 0, true)).data.lesson;
    const f = await playLesson(jar, ex, new Set([1, 3, 5])); assert.equal(f.data.result.outcome, 'exam_failed');
    const enSt = (await me(jar)).state; assert.ok(enSt.retryAt[0] > env.clock.t); assert.equal(enSt.passed[0], false);
    assert.equal((await startLevel(jar, 50, 0, true)).data.error, 'cooldown');
    await course(jar, 'ru'); assert.equal((await me(jar)).state.retryAt[0], 0, 'ru has no cooldown');
    const rex = await startLevel(jar, 50, 0, true); assert.equal(rex.status, 200, 'ru exam startable while en is cooling down'); assert.equal(rex.data.lesson.course, 'ru');
    const pass = await playLesson(jar, rex.data.lesson, new Set([2, 4])); assert.equal(pass.data.result.outcome, 'exam_passed'); assert.equal(pass.data.state.passed[0], true);
    const back = await course(jar, 'en'); assert.equal(back.data.state.passed[0], false, 'en not passed by the ru exam'); assert.ok(back.data.state.retryAt[0] > env.clock.t, 'en cooldown still active');
    assert.equal(back.data.state.courses.ru.passed[0], true);
    env.clock.t += 5 * MIN + 1000; const retry = await startLevel(jar, 50, 0, true); assert.equal(retry.status, 200);
    assert.equal((await playLesson(jar, retry.data.lesson)).data.state.passed[0], true);
    assert.deepEqual((await me(jar)).state.courses.ru.passed, [true, false, false, false]);
  } finally { await env.app.close(); }
});

test('switching mid-lesson abandons it explicitly; exam cooldown is charged to the OLD course; stale answers are 409', async () => {
  const env = await boot();
  try {
    const {jar, name} = await signup(env);
    // plain lesson
    const l1 = (await startLevel(jar, 1)).data.lesson;
    await jar.post('/api/lesson/answer', {lessonId: l1.id, index: 0, given: correctGiven(l1, 0)});
    const sw = await course(jar, 'ru');
    assert.equal(sw.status, 200); assert.deepEqual(sw.data.abandoned, {course: 'en', tier: 0, level: 1, exam: false, cooldown: false}); assert.equal(sw.data.lesson, null);
    const stale = await jar.post('/api/lesson/answer', {lessonId: l1.id, index: 1, given: correctGiven(l1, 1)});
    assert.equal(stale.status, 409); assert.equal(stale.data.error, 'lesson_superseded'); assert.equal(stale.data.state.coins, 0);
    assert.equal((await jar.post('/api/lesson/retry', {lessonId: l1.id})).status, 409);
    // exam in en, switch to ru: cooldown on en
    patchState(env, name, s => { s.completed[0] = full(); s.tier = 0; }, 'en'); patchState(env, name, s => { s.completed[0] = full(); s.tier = 0; }, 'ru');
    await course(jar, 'en'); const ex = (await startLevel(jar, 50, 0, true)).data.lesson;
    await jar.post('/api/lesson/answer', {lessonId: ex.id, index: 0, given: correctGiven(ex, 0)});
    const sw2 = await course(jar, 'ru'); assert.deepEqual(sw2.data.abandoned, {course: 'en', tier: 0, level: 50, exam: true, cooldown: true});
    assert.equal(sw2.data.state.retryAt[0], 0, 'new (ru) course has no penalty');
    assert.equal(sw2.data.state.courses.en.retryAt[0], env.clock.t + 5 * MIN, 'penalty on the old course');
    const stale2 = await jar.post('/api/lesson/answer', {lessonId: ex.id, index: 1, given: correctGiven(ex, 1)}); assert.equal(stale2.status, 409);
    assert.equal((await startLevel(jar, 50, 0, true)).status, 200, 'ru exam allowed'); // replaces nothing in en: starts fresh ru exam
    // abandoning (switching away from) a ru exam penalises ru, not en
    const sw3 = await course(jar, 'en'); assert.equal(sw3.data.abandoned.course, 'ru'); assert.equal(sw3.data.state.courses.ru.retryAt[0], env.clock.t + 5 * MIN);
    assert.equal(sw3.data.state.courses.en.retryAt[0], env.clock.t + 5 * MIN);
    // a review-phase lesson is abandoned without penalty
    env.clock.t += 6 * MIN; await jar.post('/api/tier', {tier: 0}); const l2 = (await startLevel(jar, 1)).data.lesson;
    await playLesson(jar, l2, new Set([1])); assert.equal((await me(jar)).lesson.phase, 'review');
    const sw4 = await course(jar, 'ru'); assert.equal(sw4.data.abandoned.cooldown, false); assert.equal(sw4.data.lesson, null);
    // finished lesson row: switching is not reported as an abandoned lesson
    const l3 = await finishLevel(jar, 1); assert.equal(l3.data.result.outcome, 'done');
    assert.equal((await course(jar, 'en')).data.abandoned ?? null, null);
  } finally { await env.app.close(); }
});

test('lessons are bound to their course forever: no cross-course awards even if activeCourse is changed behind their back', async () => {
  const env = await boot();
  try {
    const {jar, name} = await signup(env);
    const lesson = (await startLevel(jar, 1)).data.lesson; assert.equal(lesson.course, 'en');
    // simulate an inconsistent store: account says ru, the stored lesson says en
    const row = env.app.db.prepare('SELECT p.state,u.id FROM progress p JOIN users u ON u.id=p.user_id WHERE u.username_key=?').get(name.toLowerCase());
    const st = JSON.parse(row.state); st.activeCourse = 'ru'; env.app.db.prepare('UPDATE progress SET state=? WHERE user_id=?').run(JSON.stringify(st), row.id);
    assert.equal((await me(jar)).lesson.course, 'en');
    const enAnswers = [0, 1, 2, 3, 4].map(i => correctGiven({...lesson, course: 'en'}, i));
    const ruWrong = courseQuestions('ru', 0, 1)[0]; assert.notEqual(answerOf(ruWrong.type, ruWrong.word), enAnswers[0]);
    let last; for (let i = 0; i < 5; i++) last = await jar.post('/api/lesson/answer', {lessonId: lesson.id, index: i, given: enAnswers[i]});
    assert.equal(last.data.result.outcome, 'done');
    assert.deepEqual(last.data.state.courses.en.completed[0], [1], 'reward goes to the lesson course'); assert.deepEqual(last.data.state.courses.ru.completed[0], []);
    assert.equal(last.data.state.coins, 20);
  } finally { await env.app.close(); }
});

test('grading uses the lesson course: strict Russian typing, fuzzy Uzbek on the Russian course', async () => {
  const env = await boot();
  try {
    const {jar} = await ruUser(env, 3);
    patchState(env, (await jar.get('/api/me')).data.user.username, s => { s.completed[3] = full().slice(0, 4); s.tier = 3; }, 'ru');
    const L = (await startLevel(jar, 5, 3)).data.lesson, items = courseQuestions('ru', 3, 5);
    const ans = i => answerOf(items[i].type, items[i].word);
    let r = await jar.post('/api/lesson/answer', {lessonId: L.id, index: 0, given: ans(0)}); assert.equal(r.data.result.correct, true);
    r = await jar.post('/api/lesson/answer', {lessonId: L.id, index: 1, given: ans(1).toUpperCase().replace(/[ЕЁ]/g, 'Ё')}); assert.equal(r.data.result.correct, true, 'assemble: case + ё/е ok');
    const target = items[2].word.t; assert.equal(items[2].type, 'write-en');
    const hearts = r.data.state.hearts;
    r = await jar.post('/api/lesson/answer', {lessonId: L.id, index: 2, given: target.slice(0, -1)}); assert.equal(r.data.result.correct, false, 'one missing letter is wrong'); assert.equal(r.data.result.answer, target); assert.equal(r.data.state.hearts, hearts, 'typing mistakes never cost hearts');
    r = await jar.post('/api/lesson/answer', {lessonId: L.id, index: 3, given: ans(3)}); assert.equal(r.data.result.correct, true);
    const uz = ans(4); assert.equal(items[4].type, 'write-uz'); const typo = uz.length >= 7 ? uz.slice(0, 2) + uz[3] + uz[2] + uz.slice(4) : uz;
    r = await jar.post('/api/lesson/answer', {lessonId: L.id, index: 4, given: typo}); assert.equal(r.data.result.correct, true);
    if (typo !== uz) { assert.ok(r.data.result.note); assert.equal(r.data.result.typo.target, items[4].word.t); }
  } finally { await env.app.close(); }
});

test('full Russian A1 path over the API: 50 levels = 1050 coins, exam with 80% pass mark', async () => {
  const env = await boot();
  try {
    const {jar} = await ruUser(env, 0);
    for (let l = 1; l <= 50; l++) { const r = await finishLevel(jar, l); assert.equal(r.data.result.outcome, 'done', 'level ' + l); }
    let s = (await me(jar)).state; assert.equal(s.coins, 1050); assert.equal(s.completed[0].length, 50);
    assert.equal((await startLevel(jar, 51, 0)).status, 400);
    const ex = (await startLevel(jar, 50, 0, true)).data.lesson; assert.equal(ex.total, 10); assert.equal(ex.course, 'ru');
    const bad = await playLesson(jar, ex, new Set([0, 1, 2])); assert.equal(bad.data.result.outcome, 'exam_failed'); assert.equal(bad.data.result.correctCount, 7);
    env.clock.t += 5 * MIN + 1; const ex2 = (await startLevel(jar, 50, 0, true)).data.lesson;
    const ok = await playLesson(jar, ex2, new Set([1, 6])); assert.equal(ok.data.result.outcome, 'exam_passed'); assert.equal(ok.data.state.passed[0], true);
    assert.deepEqual((await course(jar, 'en')).data.state.passed, [false, false, false, false]);
  } finally { await env.app.close(); }
});

test('every ru lesson and exam is playable through the server (all 4 tiers, 200 lessons + 4 exams) with exact rewards', async () => {
  const env = await boot();
  try {
    const {jar, name} = await ruUser(env, 0);
    let total = 0;
    for (let t = 0; t < 4; t++) {
      await jar.post('/api/tier', {tier: t});
      for (let l = 1; l <= 50; l++) { const r = await finishLevel(jar, l, t); assert.equal(r.data.result.reward, l % 10 === 0 ? 30 : 20, `tier${t} level${l}`); total += r.data.result.reward; }
      env.clock.t += 31 * MIN;
      const ex = await startLevel(jar, 50, t, true); assert.equal(ex.status, 200);
      assert.equal((await playLesson(jar, ex.data.lesson)).data.result.outcome, 'exam_passed');
      env.clock.t += 31 * MIN; patchState(env, name, s => { s.hearts = 5; s.regenAt = null; }, 'ru');
    }
    const s = (await me(jar)).state; assert.equal(s.coins, total); assert.equal(total, 4200); assert.deepEqual(s.passed, [true, true, true, true]);
    assert.deepEqual((await course(jar, 'en')).data.state.completed, [[], [], [], []]);
  } finally { await env.app.close(); }
});

test('legacy English account on a version-1 database: restart migrates it, active lesson survives, stays English', async () => {
  const dir = mkdtempSync(path.join(here, '.data', 'legacy-')), file = path.join(dir, 'jenius.db');
  mkdirSync(path.join(here, '.data'), {recursive: true});
  try {
    const env1 = await boot({dbPath: file});
    const u = await signup(env1, undefined, {}, {course: 'en'}); await u.jar.post('/api/tier', {tier: 1});
    for (let l = 1; l <= 2; l++) await finishLevel(u.jar, l, 1);
    const lesson = (await startLevel(u.jar, 3, 1)).data.lesson;
    for (let i = 0; i < 2; i++) await u.jar.post('/api/lesson/answer', {lessonId: lesson.id, index: i, given: correctGiven(lesson, i)});
    const cookies = new Map(u.jar.cookies), name = u.name;
    await env1.app.close();
    // turn the file back into what the pre-Russian app wrote
    const raw = new DatabaseSync(file);
    const row = raw.prepare('SELECT user_id,state FROM progress').get();
    raw.prepare('UPDATE progress SET state=? WHERE user_id=?').run(JSON.stringify(downgradeState(JSON.parse(row.state))), row.user_id);
    raw.exec('ALTER TABLE lessons DROP COLUMN course'); raw.exec('PRAGMA user_version=1');
    assert.equal(JSON.parse(raw.prepare('SELECT state FROM progress').get().state).version, 1); raw.close();
    // restart on the old file
    const env2 = await boot({dbPath: file}); const jar = new Jar(env2); jar.cookies = cookies;
    assert.equal(env2.app.db.prepare('PRAGMA user_version').get().user_version, 2);
    const m = await me(jar);
    assert.equal(m.user.username, name); assert.equal(m.state.activeCourse, 'en'); assert.equal(m.state.tier, 1); assert.deepEqual(m.state.completed[1], [1, 2]); assert.equal(m.state.coins, 40);
    assert.equal(m.lesson.id, lesson.id); assert.equal(m.lesson.course, 'en'); assert.equal(m.lesson.index, 2);
    let last; for (let i = 2; i < 5; i++) last = await jar.post('/api/lesson/answer', {lessonId: lesson.id, index: i, given: correctGiven({...lesson, course: undefined}, i)});
    assert.equal(last.data.result.outcome, 'done'); assert.equal(last.data.result.reward, 20); assert.deepEqual(last.data.state.completed[1], [1, 2, 3]);
    assert.deepEqual(last.data.state.courses.ru.completed, [[], [], [], []]);
    const login = await new Jar(env2).post('/api/login', {username: name, password: PW}); assert.equal(login.status, 200); assert.equal(login.data.state.activeCourse, 'en');
    await env2.app.close();
    // second restart: idempotent
    const env3 = await boot({dbPath: file}); const j3 = new Jar(env3); j3.cookies = cookies; assert.deepEqual((await me(j3)).state.completed[1], [1, 2, 3]); await env3.app.close();
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('local browser import at registration: sanitized, English only, lands in en without a course prompt; login never imports', async () => {
  const env = await boot();
  try {
    const good = {version: 1, tier: 1, hearts: 3, coins: 40, regenAt: T0 + MIN, completed: [[1, 2], [], [], []], passed: [false, false, false, false], retryAt: [0, 0, 0, 0], streak: 0, lastDay: null, freeze: 0};
    const a = await signup(env, uniqueName('im'), {importLocal: good}, {course: null});
    assert.equal(a.res.data.imported, true); assert.equal(a.res.data.state.activeCourse, 'en'); assert.deepEqual(a.res.data.state.completed[0], [1, 2]); assert.equal(a.res.data.state.coins, 40);
    assert.deepEqual(a.res.data.state.courses.ru.completed, [[], [], [], []]);
    const ruImport = {...good, version: 2, activeCourse: 'ru', courses: {ru: {tier: 0, completed: [full(), [], [], []], passed: [true, false, false, false], retryAt: [0, 0, 0, 0]}}};
    const b = await signup(env, uniqueName('im'), {importLocal: ruImport}, {course: null});
    assert.equal(b.res.data.imported, false); assert.equal(b.res.data.state.activeCourse, null); assert.equal(b.res.data.state.coins, 0);
    const b2 = await signup(env, uniqueName('im'), {importLocal: {...good, courses: {ru: {completed: [full()]}}, activeCourse: 'ru'}}, {course: null});
    assert.equal(b2.res.data.state.activeCourse, 'en'); assert.deepEqual(b2.res.data.state.courses.ru.completed, [[], [], [], []], 'extra ru data in a v1 blob is dropped');
  } finally { await env.app.close(); }
});

test('sound/pronunciation: both courses keep the same six audio assets and sound API; no per-word audio was added (UI sound behaviour: tests/ui/sound-flow.test.jsx)', async () => {
  const {readClientSource} = await import('./clientSrc.mjs'), app = readClientSource(), server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.equal([...server.matchAll(/\['\/audio\/([a-z]+)\.(mp3|wav)'/g)].length, 6);
  assert.ok(!/speechSynthesis|SpeechSynthesis|\/audio\/ru|new Audio\(/.test(app), 'no pronunciation added');
  for (const k of ["sound.play('correct')", "playOnce(`${s.id}:no_hearts`, 'lose')", "passed ? 'win' : 'lose'"]) assert.ok(app.includes(k), k);
  const env = await boot();
  try { for (const f of ['background.mp3', 'click.wav', 'correct.wav', 'lose.wav', 'select.wav', 'win.wav']) assert.equal((await new Jar(env).get('/audio/' + f)).status, 200, f); } finally { await env.app.close(); }
});
