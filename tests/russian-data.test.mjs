import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {COURSES, COURSE_IDS, WORDS_EN, WORDS_RU, RU_PATTERN, TYPE_SPECS, TYPE_ORDER, QUESTION_TYPES, courseQuestions, courseLessonWords, questions, promptOf, answerOf, instructionOf, isCourse, PRACTICE_NOTE} from '../shared/data.mjs';

const counts = {lessonQuestions: 0, examQuestions: 0, lessonSlots: 0, examSlots: 0};

function checkQuestion(course, q, where) {
  const spec = TYPE_SPECS[q.type];
  assert.ok(spec, where + ' known type');
  const words = COURSES[course].words.flat();
  const ans = answerOf(q.type, q.word), prompt = promptOf(q.type, q.word);
  assert.ok(ans && prompt && ans !== prompt, where);
  assert.equal(ans, spec.answerLang === 'uz' ? q.word.uz : q.word.t, where);
  assert.equal(prompt, spec.promptLang === 'uz' ? q.word.uz : q.word.t, where);
  assert.match(instructionOf(q.type, course), /\S/);
  if (course === 'ru') {
    assert.match(q.word.t, RU_PATTERN, where + ' Cyrillic target');
    assert.ok(!/[A-Za-z]/.test(q.word.t), where + ' no Latin');
  }
  if (q.type.startsWith('choice')) {
    assert.equal(q.choices.length, 4, where); assert.equal(new Set(q.choices).size, 4, where + ' 4 unique choices');
    assert.equal(q.choices.filter(c => c === ans).length, 1, where + ' correct once');
    assert.ok(!q.choices.includes(prompt), where + ' prompt not among options');
    const pool = new Set(words.map(w => spec.answerLang === 'uz' ? w.uz : w.t));
    for (const c of q.choices) assert.ok(pool.has(c), where + ' option from the same course/language: ' + c);
    if (course === 'ru' && spec.answerLang === 'target') for (const c of q.choices) assert.match(c, RU_PATTERN, where + ' Cyrillic option');
  } else assert.equal(q.choices.length >= 1, true);
}

test('courses registry: two courses, honest practice labels, four tiers each', () => {
  assert.deepEqual(COURSE_IDS, ['en', 'ru']);
  assert.ok(isCourse('en') && isCourse('ru')); for (const bad of ['de', '', null, undefined, 1, {}, '__proto__', 'constructor', 'toString']) assert.equal(isCourse(bad), false, String(bad));
  assert.deepEqual(COURSES.ru.tiers.map(t => t.name), ['A1', 'A2', 'B1', 'B2']);
  assert.deepEqual(COURSES.ru.tiers.map(t => t.id), ['a1', 'a2', 'b1', 'b2']);
  assert.equal(COURSES.en.tiers.length, 4); assert.equal(COURSES.en.tiers[0].name, 'Beginner');
  assert.match(PRACTICE_NOTE, /sertifikat/); assert.match(PRACTICE_NOTE, /emas/);
  for (const t of COURSES.ru.tiers) assert.doesNotMatch(t.description + t.label, /rasmiy.*(tan olingan|sertifikat bering)|kafolat/i);
  for (const c of Object.values(COURSES)) assert.equal(c.official, false);
});

test('Russian vocabulary: 4 tiers x 50, 200 unique ru-uz pairs, Cyrillic only, ё/е-safe', () => {
  assert.equal(WORDS_RU.length, 4); for (const t of WORDS_RU) assert.equal(t.length, 50);
  const all = WORDS_RU.flat();
  assert.equal(all.length, 200);
  assert.equal(new Set(all.map(w => w.t)).size, 200, 'unique Russian words');
  assert.equal(new Set(all.map(w => w.uz)).size, 200, 'unique Uzbek translations');
  assert.equal(new Set(all.map(w => w.t.replace(/ё/g, 'е'))).size, 200, 'unique even when ё=е');
  for (const w of all) { assert.match(w.t, RU_PATTERN, w.t); assert.ok(w.uz.trim() === w.uz && w.uz.length > 1, w.uz); assert.ok(!('en' in w), 'Russian words have no en field'); }
  for (const t of WORDS_RU) { assert.equal(new Set(t.map(w => w.t)).size, 50); assert.equal(new Set(t.map(w => w.uz)).size, 50); }
});

test('difficulty increases: phrases and long items are rare in A1 and common in B2', () => {
  const phrases = WORDS_RU.map(t => t.filter(w => w.t.includes(' ')).length);
  const avgLen = WORDS_RU.map(t => t.reduce((a, w) => a + w.t.length, 0) / t.length);
  assert.ok(phrases[0] === 0, 'A1 has only single everyday words');
  assert.ok(phrases[3] >= 15, 'B2 has many set phrases: ' + phrases[3]);
  assert.ok(phrases[0] <= phrases[1] && phrases[1] <= phrases[2] && phrases[2] <= phrases[3], 'phrase count non-decreasing ' + phrases);
  assert.ok(avgLen[0] < avgLen[1] && avgLen[1] < avgLen[2] && avgLen[2] < avgLen[3], 'average word length increases ' + avgLen.map(x => x.toFixed(1)));
});

test('no Russian word is also used in the English vocabulary data (courses are independent)', () => {
  const en = new Set(WORDS_EN.flat().map(w => w.t));
  for (const w of WORDS_RU.flat()) assert.ok(!en.has(w.t));
});

test('every slot of BOTH courses: 2000 lesson question slots + 80 exam question slots', () => {
  for (const course of COURSE_IDS) for (let t = 0; t < 4; t++) {
    for (let l = 1; l <= 50; l++) {
      const qs = courseQuestions(course, t, l, false); assert.equal(qs.length, 5);
      qs.forEach((q, i) => { assert.equal(q.type, TYPE_ORDER[i % 5]); checkQuestion(course, q, `${course} tier${t} lesson${l} q${i + 1}`); counts.lessonQuestions++; });
      counts.lessonSlots++;
    }
    const ex = courseQuestions(course, t, 50, true); assert.equal(ex.length, 10);
    assert.equal(new Set(ex.map(q => q.word.t)).size, 10, 'exam words are all different');
    ex.forEach((q, i) => { checkQuestion(course, q, `${course} tier${t} exam q${i + 1}`); counts.examQuestions++; });
    counts.examSlots++;
  }
  assert.equal(counts.lessonSlots, 400); assert.equal(counts.lessonQuestions, 2000);
  assert.equal(counts.examSlots, 8); assert.equal(counts.examQuestions, 80);
});

test('every Russian lesson level of a tier teaches/asks only words of that tier, and the whole tier is reachable', () => {
  for (let t = 0; t < 4; t++) {
    const seen = new Set();
    for (let l = 1; l <= 50; l++) for (const w of courseLessonWords('ru', t, l)) { assert.ok(WORDS_RU[t].includes(w)); seen.add(w.t); }
    assert.equal(seen.size, 50, 'all 50 words of tier ' + t + ' appear in lessons');
  }
});

test('English course is byte-for-byte what the original app produced (saved snapshot of the pre-Russian version)', async () => {
  const snap = JSON.parse(await readFile(new URL('./fixtures/en-questions-v1.json', import.meta.url), 'utf8'));
  let n = 0;
  for (let t = 0; t < 4; t++) for (let l = 1; l <= 51; l++) {
    const exam = l === 51, lv = exam ? 50 : l, key = `${t}:${lv}:${exam ? 1 : 0}`;
    for (const qs of [questions(t, lv, exam), courseQuestions('en', t, lv, exam)])
      assert.deepEqual(qs.map(q => [q.word.en, q.word.uz, q.type, q.choices]), snap[key], key);
    n++;
  }
  assert.equal(n, 204);
});

test('legacy QUESTION_TYPES view still reports en/uz directions; generic specs use target/uz', () => {
  assert.deepEqual(Object.keys(QUESTION_TYPES), TYPE_ORDER);
  assert.deepEqual([QUESTION_TYPES.choice.promptLang, QUESTION_TYPES.choice.answerLang], ['en', 'uz']);
  assert.deepEqual([TYPE_SPECS.choice.promptLang, TYPE_SPECS.choice.answerLang], ['target', 'uz']);
  assert.equal(instructionOf('choice'), 'Inglizcha so‘zning o‘zbekcha tarjimasini toping');
});

test('Russian instructions are written in Uzbek and name the right language', () => {
  const ru = TYPE_ORDER.map(t => instructionOf(t, 'ru'));
  assert.deepEqual(ru, ['Ruscha so‘zning o‘zbekcha tarjimasini toping', 'Harflardan ruscha so‘zni yig‘ing', 'Rus tilida yozing', 'O‘zbekcha so‘zning ruscha tarjimasini toping', 'O‘zbek tilida yozing']);
  for (const i of ru) assert.ok(!/[А-Яа-я]/.test(i) && !/ingliz/i.test(i));
  for (const t of TYPE_ORDER) assert.ok(!/rus/i.test(instructionOf(t, 'en')));
});

test('generic helpers and the client never read word.en; English-only names are confined to compatibility exports', async () => {
  const data = await readFile(new URL('../shared/data.mjs', import.meta.url), 'utf8');
  const {readClientSource} = await import('./clientSrc.mjs'), app = readClientSource();
  const grade = await readFile(new URL('../server/grade.mjs', import.meta.url), 'utf8');
  const game = await readFile(new URL('../server/game.mjs', import.meta.url), 'utf8');
  for (const [n, src] of [['app', app], ['game', game]]) assert.ok(!/\.word\.en\b|\bw\.en\b/.test(src), n + ' reads word.en');
  assert.ok(!/\bw\.en\b/.test(grade.replace(/\{en: q\.word\.t\}/, '')));
  const generic = data.slice(data.indexOf('const wordsOf'), data.indexOf('// Legacy English-only signatures'));
  assert.ok(!/\.en\b/.test(generic.replace(/\.en\.instructions/g, '')), 'generic data helpers must not read .en');
});

test('client wiring: Cyrillic key set, labels, styles (rendering behaviour: tests/ui/onboarding.test.jsx, tests/ui/lesson.test.jsx)', async () => {
  const {readClientSource, readStyles} = await import('./clientSrc.mjs'), app = readClientSource(), css = readStyles();
  const {RU_LETTERS} = await import('../client/src/lib/ru.js');
  assert.equal(RU_LETTERS.join(''), 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя');
  assert.match(app, /RU_LETTERS/); assert.equal([...'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'].length, 33);
  assert.match(app, /data-ru-char/); assert.match(app, /PRACTICE_NOTE/);
  assert.match(app, /\/api\/course', \{course\}/); assert.match(app, /startLesson\(\{course: state\.activeCourse/);
  assert.match(css, /\.course-switch/); assert.match(css, /max-width:620px\)\{header\{height:auto/);
  assert.ok(!/ onclick=|style="|style=\{/.test(app), 'no inline handlers/styles (CSP)');
});
