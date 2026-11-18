// Авторизованный урок при плохой сети (инцидент «Server javob bermadi» посреди уровня).
// Проверяем: фоновое чтение не ломает урок и не стирает ввод; устаревший ответ GET не затирает свежее состояние;
// неподтверждённый ответ повторяется ТОЛЬКО с теми же lessonId/index/given; чтение при загрузке повторяется;
// записи (покупка, старт, вход) вслепую не повторяются; 401 не глотается.
import {test, expect} from 'vitest';
import {courseQuestions} from '../../shared/data.mjs';
import {fakeServer, renderApp, screen, waitFor, act, payload, lessonOf, stateWith, dialog, textOf, ready} from './support.jsx';

const banner = () => document.getElementById('banner');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
// урок, где на нужном индексе вопрос с выбором (клик по .choice)
const L = (o = {}) => lessonOf({index: 0, ...o});
const CH = courseQuestions('en', 0, 1, false).findIndex(q => q.type.startsWith('choice')); // индекс вопроса с вариантами (на нулевом тоже выбор)
const answerOk = (st, lesson, extra = {}) => ({data: {...payload(st, lesson), result: {correct: true, outcome: 'continue', answer: 'x', reward: 0, ...extra}}});
const pickAndCheck = async (user, d, n = 0) => { await user.click(d.querySelectorAll('.choice')[n]); await user.click(screen.getByRole('button', {name: 'Tekshirish →'})); };
const hide = () => { Object.defineProperty(document, 'visibilityState', {get: () => 'hidden', configurable: true}); document.dispatchEvent(new Event('visibilitychange')); };
const show = () => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); };

test('background GET fails (offline) mid-lesson: lesson stays, selected answer is kept, banner is the READ banner (not "result not saved")', async () => {
  const st = stateWith('en', 0); let down = false;
  fakeServer({'GET /api/me': () => down ? new Error('offline') : {data: payload(st, L({index: CH, correct: CH}))}});
  const {user} = renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'});
  await user.click(d.querySelectorAll('.choice')[1]);
  down = true; hide(); show();
  await waitFor(() => expect(banner().hidden).toBe(false));
  expect(dialog()).toBeTruthy(); expect(d.querySelectorAll('.choice')[1].className).toContain('selected');
  expect(d.querySelector('.quiz-meta').textContent).toContain(`${CH + 1} / 5`);
  expect(textOf(banner())).not.toMatch(/natija saqlanmadi/); expect(textOf(banner())).toMatch(/yangilanmadi/);
  down = false; await user.click(banner().querySelector('[data-action="retry-net"]'));
  await waitFor(() => expect(banner().hidden).toBe(true));
  expect(d.querySelectorAll('.choice')[1].className).toContain('selected');
});

test('a slow/stale background GET that finishes AFTER an answer must not overwrite the newer state nor raise a false banner', async () => {
  const stOld = stateWith('en', 0, {coins: 0}), stNew = stateWith('en', 0, {coins: 20});
  const gate = deferred(); let n = 0;
  fakeServer({
    'GET /api/me': () => (++n === 1 ? {data: payload(stOld, L())} : gate.promise),
    'POST /api/lesson/answer': () => answerOk(stNew, L({index: 1, correct: 1}))
  });
  const {user} = renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'});
  act(() => { window.dispatchEvent(new Event('focus')); });           // фоновый GET стартовал (busy ещё false) и «завис»
  await waitFor(() => expect(n).toBe(2));
  await pickAndCheck(user, d); await screen.findByRole('button', {name: /Davom etish/});
  expect(document.querySelector('[data-stat="coins"]').textContent).toBe('20');
  await act(async () => { gate.resolve({data: payload(stOld, L())}); await gate.promise; });  // старый ответ приходит поздно
  await new Promise(r => setTimeout(r, 20));
  expect(document.querySelector('[data-stat="coins"]').textContent).toBe('20');
  expect(banner().hidden).toBe(true);
});

test('a stale background GET that FAILS after a successful answer does not show "result not saved"', async () => {
  const st = stateWith('en', 0), gate = deferred(); let n = 0;
  fakeServer({'GET /api/me': () => (++n === 1 ? {data: payload(st, L())} : gate.promise), 'POST /api/lesson/answer': () => answerOk(st, L({index: 1, correct: 1}))});
  const {user} = renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'});
  act(() => { window.dispatchEvent(new Event('focus')); }); await waitFor(() => expect(n).toBe(2));
  await pickAndCheck(user, d); await screen.findByRole('button', {name: /Davom etish/});
  await act(async () => { gate.resolve(new Error('timeout')); try { await gate.promise; } catch {} });
  await new Promise(r => setTimeout(r, 20));
  expect(banner().hidden).toBe(true); expect(dialog()).toBeTruthy();
});

test('answer response lost (client timeout): automatic retry sends the SAME lessonId/index/given and the answer is counted once', async () => {
  const st = stateWith('en', 0); let n = 0;
  const srv = fakeServer({'GET /api/me': () => ({data: payload(st, L())}), 'POST /api/lesson/answer': () => (++n === 1 ? new Error('timeout') : answerOk(st, L({index: 1, correct: 1}), {correct: true}))});
  const {user} = renderApp({retryDelays: [0, 0]}); const d = await screen.findByRole('dialog', {name: 'Dars'});
  await pickAndCheck(user, d, 2);
  await screen.findByRole('button', {name: /Davom etish/});
  const bodies = srv.of('POST', '/api/lesson/answer').map(c => c.body);
  expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]); expect(bodies[0]).toMatchObject({lessonId: 'L1', index: 0});
  expect(banner().hidden).toBe(true);
});

test('all attempts fail -> answer is UNCONFIRMED: input kept and locked; next click re-sends the original given, not an edited one; lesson is not closed', async () => {
  const st = stateWith('en', 0); let up = false;
  const srv = fakeServer({'GET /api/me': () => ({data: payload(st, L())}), 'POST /api/lesson/answer': () => up ? answerOk(st, L({index: 1, correct: 1})) : new Error('timeout')});
  const {user} = renderApp({retryDelays: [0]}); const d = await screen.findByRole('dialog', {name: 'Dars'});
  await pickAndCheck(user, d, 2);
  expect(await screen.findByText(/javob saqlanganmi, noma’lum/)).toBeTruthy();
  expect(srv.of('POST', '/api/lesson/answer')).toHaveLength(2);
  expect(dialog()).toBeTruthy(); expect(d.querySelectorAll('.choice')[2].className).toContain('selected');
  await user.click(d.querySelectorAll('.choice')[0]);                         // пытаемся поменять ответ — нельзя, пока прошлый не подтверждён
  expect(d.querySelectorAll('.choice')[2].className).toContain('selected'); expect(d.querySelectorAll('.choice')[0].className).not.toContain('selected');
  up = true; await user.click(screen.getByRole('button', {name: 'Tekshirish →'}));
  await screen.findByRole('button', {name: /Davom etish/});
  const bodies = srv.of('POST', '/api/lesson/answer').map(c => c.body);
  expect(new Set(bodies.map(b => JSON.stringify(b))).size).toBe(1);
  expect(banner().hidden).toBe(true);
});

test('409 on answer with the SAME lesson (server already moved on): resync to the server index instead of closing the lesson', async () => {
  const st = stateWith('en', 0);
  fakeServer({'GET /api/me': () => ({data: payload(st, L())}), 'POST /api/lesson/answer': () => ({status: 409, data: {error: 'out_of_sync', ...payload(st, L({index: 2, correct: 2}))}})});
  const {user} = renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'});
  await pickAndCheck(user, d);
  await waitFor(() => expect(d.querySelector('.quiz-meta').textContent).toContain('3 / 5'));
  expect(dialog()).toBeTruthy();
});

test('boot: a cold-start failure of the first GET /api/me is retried and the lesson resumes (no offline screen)', async () => {
  const st = stateWith('en', 0); let n = 0;
  const srv = fakeServer({'GET /api/me': () => (++n < 3 ? new Error('cold start') : {data: payload(st, L({index: 3, correct: 3}))})});
  renderApp({retryDelays: [0, 0]});
  const d = await screen.findByRole('dialog', {name: 'Dars'}); expect(d.querySelector('.quiz-meta').textContent).toContain('4 / 5');
  expect(srv.of('GET', '/api/me')).toHaveLength(3); expect(screen.queryByRole('heading', {name: 'Server bilan aloqa yo‘q'})).toBeNull(); expect(banner().hidden).toBe(true);
});

test('boot: when every attempt fails the honest offline screen is shown (bounded: retries + 1 requests)', async () => {
  const srv = fakeServer({'GET /api/me': () => new Error('down')});
  renderApp({retryDelays: [0, 0]});
  expect(await screen.findByText(/Server javob bermadi/)).toBeTruthy(); expect(srv.of('GET', '/api/me')).toHaveLength(3);
});

test('writes are never blindly retried: failed purchase / level start / course switch = exactly one request', async () => {
  const st = stateWith('en', 0);
  const srv = fakeServer({'GET /api/me': () => ({data: payload(st)}), 'POST /api/shop/buy': () => new Error('x'), 'POST /api/lesson/start': () => new Error('x'), 'POST /api/course': () => new Error('x')});
  const {user} = renderApp({retryDelays: [0, 0]}); await ready();
  await user.click(document.querySelector('[data-level="1"]')); await screen.findByText('Server bilan aloqa yo‘q. Level boshlanmadi.');
  await user.click(screen.getByRole('button', {name: 'Rus tili'})); await screen.findByText('Server bilan aloqa yo‘q — kurs almashmadi.');
  await user.click(screen.getByRole('button', {name: /Shop/})); await user.click(document.querySelector('[data-buy="heart"]')); await screen.findByText('Server bilan aloqa yo‘q — xarid saqlanmadi.');
  expect(srv.of('POST', '/api/lesson/start')).toHaveLength(1); expect(srv.of('POST', '/api/course')).toHaveLength(1); expect(srv.of('POST', '/api/shop/buy')).toHaveLength(1);
});

test('401 on a background refresh is not swallowed by retries: goes to /login once', async () => {
  const st = stateWith('en', 0); let auth = true;
  const srv = fakeServer({'GET /api/me': () => auth ? {data: payload(st, L())} : {status: 401, data: {error: 'auth'}}});
  const {navigate} = renderApp({retryDelays: [0, 0]}); await screen.findByRole('dialog', {name: 'Dars'});
  auth = false; const n = srv.of('GET', '/api/me').length; act(() => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(navigate.replace).toHaveBeenCalledWith('/login')); expect(srv.of('GET', '/api/me')).toHaveLength(n + 1);
});

test('manual "Qayta urinish" is not swallowed by a background GET that is still waiting between its retries', async () => {
  const st = stateWith('en', 0); let down = false;
  fakeServer({'GET /api/me': () => down ? new Error('off') : {data: payload(st)}, 'POST /api/lesson/start': () => new Error('off')});
  const {user} = renderApp({retryDelays: [300, 300]}); await ready();
  down = true; act(() => { window.dispatchEvent(new Event('focus')); });      // фоновый GET упал и ждёт паузу перед повтором
  await user.click(document.querySelector('[data-level="1"]'));                // запись упала -> баннер «не сохранено»
  await waitFor(() => expect(banner().hidden).toBe(false)); expect(textOf(banner())).toMatch(/natija saqlanmadi/);
  down = false; await user.click(banner().querySelector('[data-action="retry-net"]'));
  await waitFor(() => expect(banner().hidden).toBe(true));
});
