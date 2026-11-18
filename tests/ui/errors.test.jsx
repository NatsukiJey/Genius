// Ошибки и повторы (порт client-retry.test.mjs + новые): нет сети, 401, 409, чужие вкладки, перезапрос данных.
import {test, expect, vi} from 'vitest';
import {courseQuestions, answerOf} from '../../shared/data.mjs';
import {fakeServer, renderApp, screen, waitFor, act, payload, lessonOf, stateWith, freshState, dialog, textOf, ready, modal} from './support.jsx';

const banner = () => document.getElementById('banner');

test('boot offline on /login: offline screen, reload button, banner with retry; retry pings the server; when the server is back the login form appears', async () => {
  let up = false, n = 0;
  fakeServer(() => { n++; if (!up) return new Error('offline'); return {status: 401, data: {error: 'auth'}}; });
  const {user, navigate} = renderApp({path: '/login'});
  expect(await screen.findByRole('heading', {name: 'Server bilan aloqa yo‘q'})).toBeTruthy();
  expect(document.querySelector('[data-action="reload"]')).toBeTruthy();
  await user.click(document.querySelector('[data-action="reload"]')); expect(navigate.reload).toHaveBeenCalledTimes(1);
  expect(banner().hidden).toBe(false); expect(banner().getAttribute('role')).toBe('alert');
  const retry = banner().querySelector('[data-action="retry-net"]'); expect(retry).toBeTruthy();
  let before = n; await user.click(retry); await waitFor(() => expect(n).toBe(before + 1));
  expect(screen.getByRole('heading', {name: 'Server bilan aloqa yo‘q'})).toBeTruthy(); expect(banner().hidden).toBe(false);
  up = true; await user.click(banner().querySelector('[data-action="retry-net"]'));
  expect(await screen.findByRole('heading', {name: 'Kirish'})).toBeTruthy(); expect(document.getElementById('login-form')).toBeTruthy(); expect(banner().hidden).toBe(true);
});

test('login page: banner retry pings the server but never wipes what the user typed', async () => {
  let up = true;
  fakeServer(() => up ? {status: 401, data: {error: 'auth'}} : new Error('offline'));
  const {user} = renderApp({path: '/login'}); await screen.findByRole('heading', {name: 'Kirish'});
  await user.type(document.getElementById('login-username'), 'ali'); await user.type(document.getElementById('login-password'), 'secret');
  up = false; window.dispatchEvent(new Event('focus'));          // форма не авторизована -> refresh молчит, поэтому «роняем» сеть вручную через баннер
  await user.click(screen.getByRole('button', {name: 'Kirish →'})); await waitFor(() => expect(banner().hidden).toBe(false));
  up = true; await user.click(banner().querySelector('[data-action="retry-net"]'));
  await waitFor(() => expect(banner().hidden).toBe(true));
  expect(document.getElementById('login-username').value).toBe('ali'); expect(document.getElementById('login-password').value).toBe('secret');
});

test('5xx from the server is treated as "no connection" with the honest banner text', async () => {
  const st = stateWith('en', 0); let fail = false;
  fakeServer({'GET /api/me': () => fail ? {status: 502, data: {}} : {data: payload(st)}});
  renderApp(); await ready(); expect(banner().hidden).toBe(true);
  fail = true; window.dispatchEvent(new Event('focus'));
  await waitFor(() => expect(banner().hidden).toBe(false)); expect(textOf(banner())).toBe('Aloqa vaqtincha yo‘q — ma’lumotlar yangilanmadi. Kiritganingiz joyida turibdi.Sabab: serverda xatolik · HTTP 502Qayta urinish'); // + безопасная диагностика; фоновое чтение: другой текст, чем у неподтверждённой записи
  fail = false; await act(async () => { banner().querySelector('button').click(); });
  await waitFor(() => expect(banner().hidden).toBe(true));
});

test('401 on a logged-in call redirects to /login', async () => {
  const st = stateWith('en', 0);
  fakeServer({'GET /api/me': (b, calls) => calls.filter(c => c.url === '/api/me').length > 1 ? {status: 401, data: {error: 'x'}} : {data: payload(st)}});
  const {navigate} = renderApp(); await ready(); window.dispatchEvent(new Event('focus'));
  await waitFor(() => expect(navigate.replace).toHaveBeenCalledWith('/login'));
});

test('not logged in on / goes to /login; logged in on /login goes to /', async () => {
  fakeServer({'GET /api/me': () => ({status: 401, data: {}})}); const a = renderApp({path: '/'});
  await waitFor(() => expect(a.navigate.replace).toHaveBeenCalledWith('/login')); a.unmount();
  fakeServer({'GET /api/me': () => ({data: payload(stateWith('en', 0))})}); const b = renderApp({path: '/register'});
  await waitFor(() => expect(b.navigate.replace).toHaveBeenCalledWith('/'));
});

const inLesson = async (extra = {}) => {
  const st = stateWith('en', 0), L = lessonOf({index: 0, ...extra.lesson});
  const srv = fakeServer({'GET /api/me': () => ({data: payload(st, extra.meLesson === undefined ? L : extra.meLesson)}), ...extra.routes});
  const r = renderApp({channel: extra.channel}); const d = await screen.findByRole('dialog', {name: 'Dars'});
  return {...r, srv, d, st, L};
};
const pickAndCheck = async (r) => { await r.user.click(r.d.querySelector('.choice')); await r.user.click(screen.getByRole('button', {name: 'Tekshirish →'})); };

test('answer while offline: honest toast, no "correct" sound, nothing is marked answered, the button works again', async () => {
  const r = await inLesson({routes: {'POST /api/lesson/answer': () => new Error('offline')}});
  await r.user.keyboard('{Tab}'); await pickAndCheck(r);
  expect(await screen.findByText(/javob saqlanganmi, noma’lum/)).toBeTruthy();
  const btn = screen.getByRole('button', {name: 'Tekshirish →'}); expect(btn.disabled).toBe(false);
  expect(r.d.querySelector('#answer-feedback').textContent).toBe(''); expect(r.d.querySelector('.choice').disabled).toBe(false);
  expect(globalThis.__audios.filter(a => a.src.includes('correct') && a.plays).length).toBe(0);
  expect(banner().hidden).toBe(false);
});

test('answer 409 (lesson changed elsewhere): the lesson closes, data is refreshed, toast says so', async () => {
  const r = await inLesson({routes: {'POST /api/lesson/answer': () => ({status: 409, data: {error: 'stale', ...payload(stateWith('en', 0), null)}})}});
  await pickAndCheck(r);
  expect(await screen.findByText('Dars boshqa joyda o‘zgargan. Ma’lumotlar yangilandi.')).toBeTruthy(); expect(dialog()).toBeNull();
});

test('answer rejected (other 4xx): toast, lesson stays open', async () => {
  const r = await inLesson({routes: {'POST /api/lesson/answer': () => ({status: 400, data: {error: 'bad'}})}});
  await pickAndCheck(r); expect(await screen.findByText('Javob qabul qilinmadi.')).toBeTruthy(); expect(dialog()).toBeTruthy();
});

test('retry of a review lesson: 409 closes it with a toast; offline keeps it open', async () => {
  let mode = 'net';
  const st = stateWith('en', 0), srv = fakeServer({'GET /api/me': () => ({data: payload(st, lessonOf({phase: 'review', index: 4, correct: 3}))}), 'POST /api/lesson/retry': () => mode === 'net' ? new Error('x') : {status: 409, data: {error: 'stale', ...payload(st)}}});
  const {user} = renderApp(); const d = await screen.findByRole('dialog'); expect(textOf(d)).toMatch(/3\/5 to‘g‘ri/);
  await user.click(screen.getByRole('button', {name: /Qayta mashq qilish/})); expect(await screen.findByText('Server bilan aloqa yo‘q. Qayta urinib ko‘ring.')).toBeTruthy(); expect(dialog()).toBeTruthy();
  mode = '409'; await user.click(screen.getByRole('button', {name: /Qayta mashq qilish/})); expect(await screen.findByText('Dars o‘zgargan. Ma’lumotlar yangilandi.')).toBeTruthy(); expect(dialog()).toBeNull();
  expect(srv.of('POST', '/api/lesson/retry')).toHaveLength(2);
});

test('another device started a different lesson: refresh closes ours with a toast', async () => {
  const meLesson = {current: lessonOf({id: 'A'})}, st = stateWith('en', 0);
  fakeServer({'GET /api/me': () => ({data: payload(st, meLesson.current)})});
  renderApp(); await screen.findByRole('dialog', {name: 'Dars'});
  meLesson.current = lessonOf({id: 'B'}); window.dispatchEvent(new Event('focus'));
  expect(await screen.findByText('Dars boshqa qurilmada boshlandi. Ma’lumotlar yangilandi.')).toBeTruthy(); expect(dialog()).toBeNull();
});

test('course switch offline / rejected: toasts; nothing changes', async () => {
  let mode = 'net'; const st = stateWith('en', 0);
  fakeServer({'GET /api/me': () => ({data: payload(st)}), 'POST /api/course': () => mode === 'net' ? new Error('x') : {status: 400, data: {error: 'bad', ...payload(st)}}});
  const {user} = renderApp(); await ready();
  await user.click(screen.getByRole('button', {name: 'Rus tili'})); expect(await screen.findByText('Server bilan aloqa yo‘q — kurs almashmadi.')).toBeTruthy();
  mode = 'bad'; await user.click(screen.getByRole('button', {name: 'Rus tili'})); expect(await screen.findByText('Kursni almashtirib bo‘lmadi. Ma’lumotlar yangilandi.')).toBeTruthy();
  expect(document.querySelector('[data-course="en"].course-btn').getAttribute('aria-pressed')).toBe('true');
});

test('tier pick offline keeps the dialog and tells the user', async () => {
  const st = stateWith('en', null);
  fakeServer({'GET /api/me': () => ({data: payload(st)}), 'POST /api/tier': () => new Error('x')});
  const {user} = renderApp(); const d = await screen.findByRole('dialog', {name: /Qayerdan/});
  await user.click(d.querySelector('[data-tier="0"]')); expect(await screen.findByText('Server bilan aloqa yo‘q — tanlov saqlanmadi.')).toBeTruthy(); expect(dialog()).toBeTruthy();
});

test('another tab: BroadcastChannel "changed" refetches, "logout" sends us to /login; our own changes are announced, login/report are not', async () => {
  const st = stateWith('en', 0), channel = {postMessage: vi.fn(), onmessage: null, close: vi.fn()};
  const srv = fakeServer({'GET /api/me': () => ({data: payload(st)}), 'POST /api/shop/buy': () => ({data: {...payload(st), purchase: {ok: false, message: 'Tangalar yetarli emas.'}}}), 'POST /api/logout': () => ({data: {ok: true}})});
  const {user, navigate} = renderApp({channel}); await ready();
  const n0 = srv.of('GET', '/api/me').length; act(() => channel.onmessage({data: 'changed'})); await waitFor(() => expect(srv.of('GET', '/api/me').length).toBe(n0 + 1));
  await user.click(screen.getByRole('button', {name: /Shop/})); await user.click(document.querySelector('[data-buy="heart"]'));
  expect(await screen.findByText('Tangalar yetarli emas.')).toBeTruthy(); expect(srv.of('POST', '/api/shop/buy')[0].body).toEqual({item: 'heart'}); expect(channel.postMessage).toHaveBeenCalledWith('changed');
  await user.click(screen.getByRole('button', {name: /Hisob/})); await user.click(screen.getByRole('button', {name: /Chiqish/}));
  await waitFor(() => expect(navigate.replace).toHaveBeenCalledWith('/login')); expect(channel.postMessage).toHaveBeenCalledWith('logout');
  act(() => channel.onmessage({data: 'logout'})); expect(navigate.replace).toHaveBeenCalledTimes(2);
});

test('logout while offline: honest toast and we stay', async () => {
  const st = stateWith('en', 0); fakeServer({'GET /api/me': () => ({data: payload(st)}), 'POST /api/logout': () => new Error('x')});
  const {user, navigate} = renderApp(); await ready(); await user.click(screen.getByRole('button', {name: /Hisob/})); await user.click(screen.getByRole('button', {name: /Chiqish/}));
  expect(await screen.findByText('Chiqish bajarilmadi: server bilan aloqa yo‘q.')).toBeTruthy(); expect(navigate.replace).not.toHaveBeenCalled();
});

test('modal/toast/banner containers are persistent DOM nodes: the same elements survive every state change', async () => {
  const st = stateWith('en', 0); fakeServer({'GET /api/me': () => ({data: payload(st)}), 'POST /api/shop/buy': () => ({data: {...payload(st), purchase: {message: 'ok'}}})});
  const {user} = renderApp(); await ready();
  const nodes = [modal(), document.getElementById('toast'), banner()]; expect(nodes.every(Boolean)).toBe(true);
  expect(document.getElementById('toast').getAttribute('aria-live')).toBe('polite'); expect(document.getElementById('toast').getAttribute('role')).toBe('status');
  await user.click(screen.getByRole('button', {name: /Beginner/})); await user.click(modal().querySelector('[data-action="close"]'));
  await user.click(screen.getByRole('button', {name: /Shop/})); await user.click(document.querySelector('[data-buy="heart"]'));
  await screen.findByText('ok'); expect(document.getElementById('toast').className).toBe('show');
  expect([modal(), document.getElementById('toast'), banner()]).toEqual(nodes); expect(nodes.every(n => n.isConnected)).toBe(true);
});
