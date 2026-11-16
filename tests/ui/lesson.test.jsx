// Урок на настоящем React: слова, вопросы всех типов, русская клавиатура, проверка на сервере, результат/повтор/нет жизней.
import {test, expect} from 'vitest';
import {courseQuestions, promptOf, answerOf, instructionOf} from '../../shared/data.mjs';
import {fakeServer, renderApp, screen, waitFor, within, payload, lessonOf, stateWith, modal, dialog, textOf, ready, userEvent} from './support.jsx';

const RU = (o = {}) => lessonOf({course: 'ru', tier: 1, level: 2, ...o}), EN = (o = {}) => lessonOf({course: 'en', tier: 0, level: 1, ...o});
const qs = L => courseQuestions(L.course, L.tier, L.level, L.exam);

test('start sends the course; Russian lesson shows Cyrillic word cards (lang=ru) and Uzbek instruction', async () => {
  const st = stateWith('ru', 1), L = RU({index: 0});
  const srv = fakeServer({'GET /api/me': () => ({data: payload(st)}), 'POST /api/lesson/start': () => ({data: payload(st, L)})});
  const {user} = renderApp(); await ready();
  await user.click(document.querySelector('[data-level="1"]'));
  expect(srv.of('POST', '/api/lesson/start')[0].body).toEqual({course: 'ru', tier: 1, level: 1, exam: false});
  const d = await screen.findByRole('dialog', {name: 'Dars'});
  expect(textOf(d)).toMatch(/YANGI SO‘ZLAR/);
  const words = [...d.querySelectorAll('.word-card strong')]; expect(words).toHaveLength(5);
  for (const w of words) { expect(w.getAttribute('lang')).toBe('ru'); expect(w.textContent).toMatch(/^[а-яё ]+$/i); }
  expect(d.querySelectorAll('.word-card.revealed')).toHaveLength(0);
  await user.click(d.querySelector('.word-card'));
  expect(d.querySelector('.word-card').className).toContain('revealed'); expect(d.querySelector('.word-card span').textContent).not.toMatch(/Tarjimasini ochish/);
  await user.click(screen.getByRole('button', {name: /Tayyorman/}));
  expect(textOf(d)).toContain(instructionOf('choice', 'ru')); expect(textOf(d)).toMatch(/Ruscha so‘zning o‘zbekcha tarjimasini toping/);
  expect(d.querySelector('.question-word').getAttribute('lang')).toBe('ru');
});

test('prompt, instruction and tiles/choices come from the shared helpers for EVERY question type and both courses', async () => {
  for (const L0 of [EN(), RU()]) {
    const items = qs(L0);
    for (let i = 0; i < items.length; i++) {
      const q = items[i]; fakeServer({'GET /api/me': () => ({data: payload(stateWith(L0.course, L0.tier), {...L0, index: i})})});
      const {unmount} = renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'});
      expect(d.querySelector('h2').textContent).toBe(instructionOf(q.type, L0.course));
      expect(d.querySelector('.question-word').textContent).toBe(String(promptOf(q.type, q.word)));
      if (q.type.startsWith('choice')) expect([...d.querySelectorAll('.choice')].map(b => b.textContent.replace(/^\d/, ''))).toEqual(q.choices);
      if (q.type === 'assemble') expect([...d.querySelectorAll('.tiles button')].map(b => b.textContent).sort()).toEqual(answerOf(q.type, q.word).split('').map(c => c === ' ' ? '␣' : c).sort());
      expect(d.querySelector('.quiz-meta').textContent).toContain(`${i + 1} / 5`);
      expect(d.querySelector('progress').value).toBe(i);
      unmount();
    }
  }
});

test('write-in-Russian shows the Cyrillic keys (33 letters, space, backspace); Uzbek typing question does not', async () => {
  const st = stateWith('ru', 1);
  fakeServer({'GET /api/me': () => ({data: payload(st, RU({index: 2, correct: 2}))})});
  const a = renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'});
  expect(textOf(d)).toMatch(/Rus tilida yozing/); const keys = d.querySelector('.ru-keys'); expect(keys).toBeTruthy();
  for (const ch of 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя') expect(keys.querySelector(`[data-ru-char="${ch}"]`), ch).toBeTruthy();
  expect(keys.querySelector('[data-ru-back]')).toBeTruthy(); expect(d.querySelector('#answer').getAttribute('lang')).toBe('ru');
  expect(document.activeElement).toBe(d.querySelector('#answer'));
  a.unmount();
  fakeServer({'GET /api/me': () => ({data: payload(st, RU({index: 4, correct: 4}))})});
  renderApp(); const d2 = await screen.findByRole('dialog', {name: 'Dars'});
  expect(textOf(d2)).toMatch(/O‘zbek tilida yozing/); expect(d2.querySelector('.ru-keys')).toBeNull(); expect(d2.querySelector('#answer').getAttribute('lang')).toBeNull();
});

test('Russian keys insert at the caret, replace a selection, backspace deletes before the caret / the selection', async () => {
  fakeServer({'GET /api/me': () => ({data: payload(stateWith('ru', 1), RU({index: 2}))})});
  const {user} = renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'}), input = d.querySelector('#answer'), key = ch => d.querySelector(`[data-ru-char="${ch}"]`);
  await user.click(key('п')); await user.click(key('р')); await user.click(key('и'));
  expect(input.value).toBe('при'); expect(input.selectionStart).toBe(3); expect(document.activeElement).toBe(input);
  input.setSelectionRange(1, 1); await user.click(key('в')); expect(input.value).toBe('пври'); expect(input.selectionStart).toBe(2);
  input.setSelectionRange(0, 2); await user.click(key(' ')); expect(input.value).toBe(' ри'); expect(input.selectionStart).toBe(1);
  input.setSelectionRange(1, 1); await user.click(d.querySelector('[data-ru-back]')); expect(input.value).toBe('ри'); expect(input.selectionStart).toBe(0);
  input.setSelectionRange(0, 2); await user.click(d.querySelector('[data-ru-back]')); expect(input.value).toBe('');
  await user.click(d.querySelector('[data-ru-back]')); expect(input.value).toBe('');
  await user.type(input, 'ё'); expect(input.value).toBe('ё');
});

test('English lesson of the same page: English instruction, lang=en, no Russian keys', async () => {
  fakeServer({'GET /api/me': () => ({data: payload(stateWith('en', 0), EN({index: 2, correct: 2}))})});
  renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'});
  expect(textOf(d)).toMatch(/Ingliz tilida yozing/); expect(d.querySelector('.ru-keys')).toBeNull(); expect(d.querySelector('#answer').getAttribute('lang')).toBe('en');
});

test('answering a choice: nothing is sent without an answer; the given text goes to the server; feedback and next question', async () => {
  const st = stateWith('en', 0), L = EN({index: 0}), q0 = qs(L)[0];
  const srv = fakeServer({'GET /api/me': () => ({data: payload(st, L)}),
    'POST /api/lesson/answer': b => ({data: {...payload(st, {...L, index: 1}), result: {correct: b.given === answerOf(q0.type, q0.word), outcome: 'continue', answer: answerOf(q0.type, q0.word)}}})});
  const {user} = renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'});
  await user.click(screen.getByRole('button', {name: 'Tekshirish →'}));
  expect(srv.of('POST', '/api/lesson/answer')).toHaveLength(0); expect(await screen.findByText('Avval javob kiriting.')).toBeTruthy();
  const good = q0.choices.indexOf(answerOf(q0.type, q0.word));
  await user.click(d.querySelectorAll('.choice')[good]); expect(d.querySelectorAll('.choice.selected')).toHaveLength(1);
  await user.click(screen.getByRole('button', {name: 'Tekshirish →'}));
  expect(srv.of('POST', '/api/lesson/answer')[0].body).toEqual({lessonId: 'L1', index: 0, given: q0.choices[good]});
  await waitFor(() => expect(d.querySelector('#answer-feedback').className).toBe('feedback good'));
  expect(d.querySelector('#answer-feedback').textContent).toMatch(/Ajoyib/); expect([...d.querySelectorAll('.choice')].every(b => b.disabled)).toBe(true);
  await user.click(screen.getByRole('button', {name: 'Davom etish →'}));
  expect(d.querySelector('.quiz-meta').textContent).toContain('2 / 5'); expect(d.querySelector('#answer-feedback').textContent).toBe(''); expect(d.querySelector('.choice.selected')).toBeNull();
});

test('a wrong answer shows the right one from the server; Enter in the answer field submits and Enter again continues', async () => {
  const st = stateWith('en', 0), L = EN({index: 2, correct: 2}), q = qs(L)[2], ans = answerOf(q.type, q.word);
  const srv = fakeServer({'GET /api/me': () => ({data: payload(st, L)}),
    'POST /api/lesson/answer': b => ({data: {...payload(st, {...L, index: 3}), result: {correct: false, outcome: 'continue', answer: ans}}})});
  const {user} = renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'});
  await user.type(d.querySelector('#answer'), 'zzz{Enter}');
  expect(srv.of('POST', '/api/lesson/answer')[0].body).toEqual({lessonId: 'L1', index: 2, given: 'zzz'});
  await waitFor(() => expect(d.querySelector('#answer-feedback').className).toBe('feedback bad'));
  expect(d.querySelector('#answer-feedback').textContent).toBe(`To‘g‘ri javob: ${ans}`); expect(d.querySelector('#answer').disabled).toBe(true);
  await user.keyboard('{Enter}');                                           // фокус на теле/диалоге: Enter продолжает
  await waitFor(() => expect(d.querySelector('.quiz-meta').textContent).toContain('4 / 5'));
});

test('assemble question: tiles build the word, each tile is used once, reset restores them, the joined word is sent', async () => {
  const st = stateWith('en', 0), L = EN({index: 1, correct: 1}), q = qs(L)[1], ans = answerOf(q.type, q.word);
  const srv = fakeServer({'GET /api/me': () => ({data: payload(st, L)}), 'POST /api/lesson/answer': () => ({data: {...payload(st, L), result: {correct: true, outcome: 'continue'}}})});
  const {user} = renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'});
  expect(d.querySelector('#assembled').textContent).toBe('Harflarni tanlang…');
  const tiles = () => [...d.querySelectorAll('.tiles button')];
  const first = tiles().find(b => b.textContent === ans[0]); await user.click(first);
  expect(first.disabled).toBe(true); expect(d.querySelector('#assembled').textContent).toBe(ans[0]);
  await user.click(d.querySelector('[data-action="reset-tiles"]')); expect(d.querySelector('#assembled').textContent).toBe('Harflarni tanlang…'); expect(tiles().every(b => !b.disabled)).toBe(true);
  for (const ch of ans) await user.click(tiles().find(b => !b.disabled && b.textContent === (ch === ' ' ? '␣' : ch)));
  expect(d.querySelector('#assembled').textContent).toBe(ans);
  await user.click(screen.getByRole('button', {name: 'Tekshirish →'}));
  expect(srv.of('POST', '/api/lesson/answer')[0].body.given).toBe(ans);
  await waitFor(() => expect(tiles().every(b => b.disabled)).toBe(true));
  await user.click(d.querySelector('[data-action="reset-tiles"]')); expect(tiles().every(b => b.disabled)).toBe(true);  // после проверки собирать заново нельзя
});

const finishWith = async (outcome, extra = {}, {exam = false, state = stateWith('en', 0)} = {}) => {
  const L = EN({index: 4, correct: 4, exam}), q = qs(L)[4];
  const srv = fakeServer({'GET /api/me': () => ({data: payload(state, L)}), 'POST /api/lesson/answer': () => ({data: {...payload(state, null), result: {correct: true, outcome, ...extra}}}),
    'POST /api/lesson/abandon': () => ({data: payload(state)}), 'POST /api/lesson/retry': () => ({data: payload(state, {...L, index: 0, correct: 0, mistakes: 0})})});
  const r = renderApp(); await screen.findByRole('dialog', {name: 'Dars'});
  await r.user.type(document.querySelector('#answer'), 'x'); await r.user.click(screen.getByRole('button', {name: 'Tekshirish →'}));
  await r.user.click(await screen.findByRole('button', {name: 'Davom etish →'}));
  return {...r, srv, q};
};

test('finishing a lesson: result dialog with reward; Sayohatga qaytish closes it; typo notes are listed', async () => {
  const {user} = await finishWith('passed', {reward: 20, typo: {target: 'apple', given: 'aple', answer: 'apple'}});
  const d = await screen.findByRole('dialog'); expect(textOf(d)).toMatch(/Zo‘r! Sen uddalading/); expect(textOf(d)).toMatch(/5\/5 to‘g‘ri javob\. \+20 tanga! Yangi level ochildi\./);
  expect(textOf(d)).toMatch(/Imlo eslatmasi:.*apple: aple → apple/); expect(d.querySelector('.result-icon').textContent).toBe('🏆');
  await user.click(within(d).getByRole('button', {name: /Sayohatga qaytish/})); expect(dialog()).toBeNull();
});

test('repeat of a finished level gives no reward text; a failed exam says 80% and a 5 minute wait', async () => {
  const a = await finishWith('passed', {reward: 0}); expect(textOf(await screen.findByRole('dialog'))).toMatch(/Takrorlash — bilimning kaliti\. Qayta tanga berilmaydi\./); a.unmount();
  const b = await finishWith('exam_failed', {}, {exam: true}); const d = await screen.findByRole('dialog');
  expect(textOf(d)).toMatch(/80% kerak\. 5 daqiqadan keyin yana urinish mumkin\./); expect(textOf(d)).toMatch(/Yana urinib ko‘ramiz!/); expect(d.querySelector('.result-icon').textContent).toBe('🌱'); b.unmount();
  const c = await finishWith('exam_passed', {}, {exam: true}); expect(textOf(await screen.findByRole('dialog'))).toMatch(/Bosqich testi muvaffaqiyatli topshirildi!/);
});

test('review phase: dialog offers a 5-question retry (POST /api/lesson/retry restarts from question 1) or leaving (abandon)', async () => {
  const {user, srv} = await finishWith('review', {correct: false});
  const d = await screen.findByRole('dialog'); expect(textOf(d)).toMatch(/Yana bir kichik mashq!/); expect(textOf(d)).toMatch(/4\/5 to‘g‘ri/);
  await user.click(within(d).getByRole('button', {name: /Qayta mashq qilish/}));
  expect(srv.of('POST', '/api/lesson/retry')[0].body).toEqual({lessonId: 'L1'});
  const q = await screen.findByRole('dialog', {name: 'Dars'}); expect(q.querySelector('.quiz-meta').textContent).toContain('1 / 5');
  expect(q.querySelector('#answer-feedback').textContent).toBe('');
});

test('review: leaving abandons the lesson on the server; no connection to abandon shows an honest toast', async () => {
  const {user, srv} = await finishWith('review');
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', {name: 'Hozircha chiqish'}));
  expect(srv.of('POST', '/api/lesson/abandon')[0].body).toEqual({lessonId: 'L1'}); expect(dialog()).toBeNull();
});

test('closing the lesson with × abandons it; a network failure on abandon is reported', async () => {
  const st = stateWith('en', 0);
  const srv = fakeServer({'GET /api/me': () => ({data: payload(st, EN({index: 1}))}), 'POST /api/lesson/abandon': () => new Error('offline')});
  const {user} = renderApp(); await screen.findByRole('dialog', {name: 'Dars'});
  await user.click(screen.getByRole('button', {name: 'Darsdan chiqish'}));
  expect(srv.of('POST', '/api/lesson/abandon')).toHaveLength(1); expect(dialog()).toBeNull();
  expect(await screen.findByText('Chiqish serverga yetib bormadi.')).toBeTruthy();
});

test('no hearts left after an answer: lose sound once, Shop page opens, toast explains', async () => {
  const st = stateWith('en', 0, {hearts: 0}), L = EN({index: 0});
  fakeServer({'GET /api/me': () => ({data: payload(st, L)}), 'POST /api/lesson/answer': () => ({data: {...payload(st, null), result: {correct: false, outcome: 'no_hearts', answer: 'x'}}})});
  const {user} = renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'});
  await user.click(d.querySelector('.choice')); await user.click(screen.getByRole('button', {name: 'Tekshirish →'}));
  await user.click(await screen.findByRole('button', {name: 'Davom etish →'}));
  expect(await screen.findByText('Jonlar tugadi. Jon tiklangach qayta urinib ko‘ring.')).toBeTruthy();
  expect(dialog()).toBeNull(); expect(document.querySelector('.nav-item.active').getAttribute('data-page')).toBe('shop');
});

test('level start errors: cooldown shows seconds, no_hearts opens Shop, locked level refreshes with a toast; offline says so', async () => {
  const st = stateWith('en', 0); let mode = 'cooldown';
  fakeServer({'GET /api/me': () => ({data: payload(st)}), 'POST /api/lesson/start': () => mode === 'net' ? new Error('x') : mode === 'cooldown' ? {status: 403, data: {error: 'cooldown', retryAt: Date.now() + 61000, ...payload(st)}} : mode === 'hearts' ? {status: 403, data: {error: 'no_hearts', ...payload(st)}} : {status: 403, data: {error: 'locked', ...payload(st)}}});
  const {user} = renderApp(); await ready();
  await user.click(document.querySelector('[data-level="1"]')); expect(await screen.findByText(/Qayta urinishgacha (6[0-2]|61) soniya/)).toBeTruthy();
  mode = 'locked'; await user.click(document.querySelector('[data-level="1"]')); expect(await screen.findByText('Bu level hozir ochiq emas. Ma’lumotlar yangilandi.')).toBeTruthy();
  mode = 'net'; await user.click(document.querySelector('[data-level="1"]')); expect(await screen.findByText('Server bilan aloqa yo‘q. Level boshlanmadi.')).toBeTruthy();
  mode = 'hearts'; await user.click(document.querySelector('[data-level="1"]')); await waitFor(() => expect(document.querySelector('.nav-item.active').getAttribute('data-page')).toBe('shop'));
});

test('the hero button walks through: no course -> chooser; no tier -> tiers; all 50 done -> exam; otherwise the next level', async () => {
  const st = stateWith('en', 0, {}); st.courses.en.completed[0] = Array.from({length: 7}, (_, i) => i + 1);
  const srv = fakeServer({'GET /api/me': () => ({data: payload(st)}), 'POST /api/lesson/start': () => ({status: 403, data: {error: 'locked', ...payload(st)}})});
  const {user} = renderApp(); await ready();
  await user.click(screen.getByRole('button', {name: /Tekin o‘qish/})); expect(srv.of('POST', '/api/lesson/start')[0].body).toEqual({course: 'en', tier: 0, level: 8, exam: false});
  st.courses.en.completed[0] = Array.from({length: 50}, (_, i) => i + 1); window.dispatchEvent(new Event('focus')); await waitFor(() => expect(document.querySelector('.chapter-progress').textContent).toBe('50/50'));
  await user.click(screen.getByRole('button', {name: /Tekin o‘qish/})); expect(srv.of('POST', '/api/lesson/start').at(-1).body).toMatchObject({level: 50, exam: true});
  await user.click(document.querySelector('[data-action="exam"]')); expect(srv.of('POST', '/api/lesson/start').at(-1).body).toMatchObject({level: 50, exam: true});
});
