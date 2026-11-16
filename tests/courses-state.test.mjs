import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {freshState, freshStateV1, upgradeState, downgradeState, viewState, completeLevel, loseHeart, buy, settle, normalizeRu, normalizeFor, normalize, MAX_HEARTS} from '../shared/engine.mjs';
import {gradeAnswer} from '../server/grade.mjs';
import {courseQuestions, answerOf, WORDS_RU, WORDS_EN} from '../shared/data.mjs';
import {openDb, SCHEMA_V1} from '../server/db.mjs';
import {sanitizeLocal, earnedCoinsAll} from '../server/migrate-local.mjs';

const T = new Date(2026, 10, 10, 12).getTime();
const here = path.dirname(fileURLToPath(import.meta.url));
const scratch = () => mkdtempSync(path.join(here, '.data', 'cs-')); // inside tests/.data (git-ignored)
import {mkdirSync} from 'node:fs';
mkdirSync(path.join(here, '.data'), {recursive: true});

const V1 = {
  fresh: freshStateV1(),
  mid: {...freshStateV1(), tier: 1, hearts: 3, coins: 260, regenAt: T + 5, completed: [[1, 2, 3], [1, 2, 3, 4, 5], [], []], streak: 4, lastDay: '2026-11-10', freeze: 1},
  allPassed: {...freshStateV1(), tier: 3, coins: 4200, completed: [1, 2, 3, 4].map(() => Array.from({length: 50}, (_, i) => i + 1)), passed: [true, true, true, true], streak: 9, lastDay: '2026-11-10'},
  noTier: {...freshStateV1(), tier: null, coins: 0},
  cooldowns: {...freshStateV1(), tier: 0, completed: [Array.from({length: 50}, (_, i) => i + 1), [], [], []], retryAt: [T + 300000, 0, 0, T + 1]},
  extra: {...freshStateV1(), tier: 2, completed: [[], [], [1], []], futureField: {a: [1, 2, {b: null}]}, note: 'keep me'}
};

test('upgrade v1 -> v2 is lossless in both directions for every snapshot, idempotent, and does not mutate input', () => {
  for (const [name, v1] of Object.entries(V1)) {
    const copy = structuredClone(v1);
    const up = upgradeState(v1);
    assert.deepEqual(v1, copy, name + ' input untouched');
    assert.equal(up.version, 2); assert.equal(up.activeCourse, 'en', name + ' English accounts stay en');
    assert.deepEqual(up.courses.en, {tier: v1.tier, completed: v1.completed, passed: v1.passed, retryAt: v1.retryAt}, name);
    assert.deepEqual(up.courses.ru, freshState().courses.ru, name + ' empty ru');
    for (const k of ['hearts', 'coins', 'regenAt', 'streak', 'lastDay', 'freeze']) assert.equal(up[k], v1[k], name + ' ' + k);
    assert.deepEqual(downgradeState(up), v1, name + ' round trip');
    assert.equal(upgradeState(up), up, name + ' idempotent (same object)');
    assert.deepEqual(upgradeState(JSON.parse(JSON.stringify(up))), up);
    assert.ok(!('tier' in up) && !('completed' in up), 'no duplicated top-level learning fields stored');
  }
  assert.deepEqual(upgradeState(V1.extra).futureField, V1.extra.futureField);
});

test('upgradeState rejects garbage (so a migration can roll back instead of losing data)', () => {
  for (const bad of [null, 5, 'x', [], {}, {version: 3}, {version: 1}, {...freshStateV1(), completed: [[]]}, {...freshStateV1(), passed: 'no'}, {...freshStateV1(), retryAt: null}]) assert.throws(() => upgradeState(bad), undefined, JSON.stringify(bad));
});

test('freshState: no course chosen, wallet at defaults, two empty course records', () => {
  const s = freshState();
  assert.equal(s.version, 2); assert.equal(s.activeCourse, null); assert.deepEqual([s.hearts, s.coins, s.streak, s.freeze], [5, 0, 0, 0]);
  assert.deepEqual(Object.keys(s.courses), ['en', 'ru']); assert.notEqual(s.courses.en, s.courses.ru); assert.notEqual(s.courses.en.completed, s.courses.ru.completed);
  const v = viewState(s); assert.equal(v.tier, null); assert.deepEqual(v.completed, [[], [], [], []]);
});

test('courses are separate, wallet is shared: progress, hearts, coins, streak, freeze', () => {
  const s = freshState();
  assert.equal(completeLevel(s, 'ru', 0, 1, T), 20);
  assert.equal(completeLevel(s, 'en', 0, 1, T), 20);
  assert.deepEqual(s.courses.ru.completed[0], [1]); assert.deepEqual(s.courses.en.completed[0], [1]);
  assert.equal(s.coins, 40); assert.equal(s.streak, 1, 'one streak day for both courses');
  assert.equal(completeLevel(s, 'ru', 0, 1, T), 0, 'no replay farming in ru'); assert.equal(completeLevel(s, 'en', 0, 1, T), 0);
  assert.equal(completeLevel(s, 'ru', 0, 3, T), 0, 'no skipping'); assert.deepEqual(s.courses.ru.completed[0], [1]);
  assert.equal(completeLevel(s, 'ru', 1, 1, T), 20, 'tiers separate inside ru');
  assert.deepEqual(s.courses.en.completed[1], []);
  // hearts are one pool
  for (let i = 0; i < 5; i++) assert.ok(loseHeart(s, T)); assert.equal(s.hearts, 0);
  assert.equal(loseHeart(s, T), false);
  s.coins = 1000; assert.equal(buy(s, 'freeze', T).ok, true); assert.equal(s.freeze, 1);
  settle(s, T + 1000); assert.equal(s.hearts, 0, 'switching or waiting a second does not refill');
  assert.equal(MAX_HEARTS, 5);
});

test('viewState projects ONLY the active course and never leaks the other', () => {
  const s = freshState(); s.activeCourse = 'ru'; completeLevel(s, 'ru', 2, 1, T); completeLevel(s, 'en', 0, 1, T);
  const v = viewState(s); assert.deepEqual(v.completed[2], [1]); assert.deepEqual(v.completed[0], []);
  s.activeCourse = 'en'; assert.deepEqual(viewState(s).completed[0], [1]);
  assert.ok(viewState(s).courses.ru, 'both courses are still reported for the chooser');
});

test('local browser import: only version 1 (English), sanitized, lands in en; earnedCoinsAll counts every course', () => {
  const good = {...V1.mid, coins: 999999};
  const r = sanitizeLocal(good, T);
  assert.equal(r.state.version, 2); assert.equal(r.state.activeCourse, 'en');
  assert.deepEqual(r.state.courses.en.completed, good.completed); assert.deepEqual(r.state.courses.ru, freshState().courses.ru);
  assert.equal(r.state.coins, 160, 'capped to what 8 levels can earn');
  for (const bad of [{...good, version: 2}, {...good, version: 2, activeCourse: 'ru', courses: {ru: {}}}, {...good, courses: {ru: {completed: [[1]]}}, version: 3}, {...good, completed: [[1, 3], [], [], []]}, null, 'x', []]) assert.equal(sanitizeLocal(bad, T).state, null);
  const s = freshState(); completeLevel(s, 'en', 0, 1, T); completeLevel(s, 'ru', 0, 1, T); completeLevel(s, 'ru', 0, 2, T);
  assert.equal(earnedCoinsAll(s), 60); assert.equal(s.coins, 60);
});

test('Russian target typing is strict except case, whitespace and ё=е', () => {
  assert.equal(normalizeRu('  ЗелёНый  '), 'зеленый'); assert.equal(normalizeRu('зелёный'), normalizeRu('зеленый'));
  assert.equal(normalizeRu('Домашнее   задание '), 'домашнее задание');
  assert.notEqual(normalizeRu('мама.'), normalizeRu('мама'), 'trailing punctuation is NOT ignored for Russian');
  assert.equal(normalizeFor('en'), normalize); assert.equal(normalizeFor('ru'), normalizeRu);
  const q = courseQuestions('ru', 0, 1, false).find(x => x.type === 'write-en');
  const ans = answerOf(q.type, q.word);
  const g = x => gradeAnswer(q, x, 'ru').ok;
  assert.equal(g(ans), true); assert.equal(g(ans.toUpperCase()), true); assert.equal(g('  ' + ans + '  '), true); assert.equal(g(ans.replace(/ё/g, 'е')), true);
  assert.equal(g(ans.slice(0, -1)), false, 'one missing letter is wrong (no typo tolerance for Russian)');
  assert.equal(g(ans.slice(0, -1) + 'ъ'), false); assert.equal(g(ans + '.'), false); assert.equal(g(ans + 'а'), false);
  assert.equal(g('zzzz'), false); assert.equal(g(ans.replace(/[а-я]/, 'a')), false, 'Latin lookalike is wrong');
  assert.equal(g(ans.replace(/./, c => c === 'и' ? 'й' : 'и')), false);
  // every Russian word: strict exact, ё/е tolerant, never fuzzy
  let n = 0;
  for (let t = 0; t < 4; t++) for (const w of WORDS_RU[t]) {
    const fake = {type: 'write-en', word: w};
    assert.equal(gradeAnswer(fake, w.t, 'ru').ok, true, w.t); assert.equal(gradeAnswer(fake, w.t.toUpperCase(), 'ru').ok, true);
    assert.equal(gradeAnswer(fake, w.t.replace(/ё/g, 'е'), 'ru').ok, true);
    assert.equal(gradeAnswer(fake, w.t.slice(0, -1), 'ru').ok, false, w.t + ' minus a letter'); assert.equal(gradeAnswer(fake, w.t + 'x', 'ru').ok, false);
    assert.equal(gradeAnswer({type: 'assemble', word: w}, w.t, 'ru').ok, true); n++;
  }
  assert.equal(n, 200);
});

test('English target typing is unchanged by the Russian work (original normalize rules)', () => {
  const q = {type: 'write-en', word: WORDS_EN[0][0]};
  assert.equal(gradeAnswer(q, 'APPLE.').ok, true); assert.equal(gradeAnswer(q, ' apple ').ok, true); assert.equal(gradeAnswer(q, 'aple').ok, false);
  assert.equal(gradeAnswer(q, 'apple', 'en').answer, 'apple');
  const t = gradeAnswer({type: 'write-uz', word: WORDS_EN[3][0]}, 'bardoshlilk', 'en'); assert.equal(t.ok, true); assert.equal(t.typo.en, 'resilience'); assert.equal(t.typo.target, 'resilience');
});

test('typo tolerance for Uzbek answers works on the Russian course (write-uz) with the same safety rules', () => {
  const find = (ru) => { for (let t = 0; t < 4; t++) { const w = WORDS_RU[t].find(x => x.t === ru); if (w) return {type: 'write-uz', word: w}; } };
  const long = find('ответственность'); // mas’uliyat
  assert.equal(gradeAnswer(long, 'mas’uliyat', 'ru').ok, true);
  const typo = gradeAnswer(long, 'mas’uliyta', 'ru'); assert.equal(typo.ok, true); assert.equal(typo.typo.kind, 'typo'); assert.equal(typo.typo.target, 'ответственность'); assert.ok(!('en' in typo.typo));
  assert.equal(gradeAnswer(long, 'masuliyat', 'ru').ok, true, 'apostrophe variants');
  assert.match(typo.note, /Deyarli to‘g‘ri/);
  const short = find('вода'); assert.equal(gradeAnswer(short, 'suv', 'ru').ok, true); assert.equal(gradeAnswer(short, 'sut', 'ru').ok, false, 'suv/sut are different words');
  assert.equal(gradeAnswer(find('мама'), 'ota', 'ru').ok, false);
  const mid = find('цветок'); assert.equal(gradeAnswer(mid, 'gul', 'ru').ok, true); assert.equal(gradeAnswer(mid, 'gil', 'ru').ok, false, '3-letter answers allow no typos');
  const ph = find('в долгосрочной перспективе'); assert.equal(gradeAnswer(ph, 'uzoq muddatda', 'ru').ok, true); assert.equal(gradeAnswer(ph, 'uzoq mudatda', 'ru').ok, true); assert.equal(gradeAnswer(ph, 'uzoq', 'ru').ok, false);
  // a different Russian-course answer typed instead is wrong
  assert.equal(gradeAnswer(find('вчера'), 'ertaga', 'ru').ok, false); assert.equal(gradeAnswer(long, 'zzzzzz', 'ru').ok, false);
  // every Russian Uzbek answer is accepted exactly, in every course
  for (const t of WORDS_RU) for (const w of t) assert.equal(gradeAnswer({type: 'write-uz', word: w}, w.uz, 'ru').ok, true, w.uz);
});

// ---------------- SQLite schema 2 migration ----------------
function legacyDb(file, {badJson = false} = {}) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;'); raw.exec(SCHEMA_V1); raw.exec('PRAGMA user_version=1');
  const u = raw.prepare('INSERT INTO users(id,username,username_key,pw_hash,pw_salt,pw_params,created_at) VALUES(?,?,?,?,?,?,?)');
  const p = raw.prepare('INSERT INTO progress(user_id,state,rev,updated_at) VALUES(?,?,?,?)');
  const states = [V1.mid, V1.allPassed, V1.fresh, V1.extra];
  states.forEach((s, i) => { u.run(i + 1, 'user' + i, 'user' + i, Buffer.from('h'), Buffer.from('s'), '{}', T); p.run(i + 1, JSON.stringify(s), 7 + i, T); });
  if (badJson) { u.run(9, 'bad', 'bad', Buffer.from('h'), Buffer.from('s'), '{}', T); p.run(9, '{not json', 1, T); }
  raw.prepare("INSERT INTO lessons(id,user_id,tier,level,exam,idx,correct,mistakes,phase,last_answer,started_at,touched_at) VALUES('L1',1,1,4,0,2,2,0,'quiz',NULL,?,?)").run(T, T);
  raw.close();
  return states;
}

test('schema 2 migration: old DB -> user_version 2, lessons.course=en, progress upgraded losslessly, rev kept, idempotent', () => {
  const dir = scratch(), file = path.join(dir, 'legacy.db');
  try {
    const states = legacyDb(file);
    const db = openDb(file);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
    const cols = db.prepare('PRAGMA table_info(lessons)').all(); assert.ok(cols.some(c => c.name === 'course' && c.dflt_value === "'en'" && c.notnull === 1));
    assert.equal(db.prepare('SELECT course,idx,level FROM lessons').get().course, 'en');
    const rows = db.prepare('SELECT user_id,state,rev FROM progress ORDER BY user_id').all();
    rows.forEach((r, i) => { assert.deepEqual(downgradeState(JSON.parse(r.state)), states[i], 'row ' + i); assert.equal(JSON.parse(r.state).activeCourse, 'en'); assert.equal(r.rev, 7 + i); });
    const snapshot = JSON.stringify(rows); db.close();
    const again = openDb(file); assert.equal(JSON.stringify(again.prepare('SELECT user_id,state,rev FROM progress ORDER BY user_id').all()), snapshot, 'reopen changes nothing');
    assert.equal(again.prepare('PRAGMA user_version').get().user_version, 2); again.close();
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('schema 2 migration with invalid JSON rolls everything back (version 1, no course column, rows untouched)', () => {
  const dir = scratch(), file = path.join(dir, 'bad.db');
  try {
    legacyDb(file, {badJson: true});
    const before = new DatabaseSync(file); const snap = JSON.stringify(before.prepare('SELECT * FROM progress ORDER BY user_id').all()); before.close();
    assert.throws(() => openDb(file), /invalid progress JSON/);
    const raw = new DatabaseSync(file);
    assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 1);
    assert.ok(!raw.prepare('PRAGMA table_info(lessons)').all().some(c => c.name === 'course'), 'ALTER rolled back');
    assert.equal(JSON.stringify(raw.prepare('SELECT * FROM progress ORDER BY user_id').all()), snap, 'no row was rewritten');
    raw.close();
    // JSON that parses but is not a state also rolls back
    const r2 = new DatabaseSync(file); r2.prepare('UPDATE progress SET state=? WHERE user_id=9').run('[1,2]'); r2.close();
    assert.throws(() => openDb(file)); const r3 = new DatabaseSync(file); assert.equal(r3.prepare('PRAGMA user_version').get().user_version, 1); r3.close();
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('fresh :memory: and fresh file databases are created directly at version 2', () => {
  const db = openDb(':memory:'); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.ok(db.prepare('PRAGMA table_info(lessons)').all().some(c => c.name === 'course')); db.close();
});
