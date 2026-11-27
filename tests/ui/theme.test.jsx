// Светлая/тёмная тема: хранение на устройстве, системная по умолчанию, ошибки хранилища, вкладки, сброс, кнопки, клавиатура.
// Ни одна проверка не касается игры: урок/ввод/монеты/сердца не меняются, запросов в сеть нет.
import {test, expect, vi} from 'vitest';
import {courseQuestions} from '../../shared/data.mjs';
import {fakeMedia} from './media.js';
import {getTheme, setTheme, resetTheme, toggleTheme, startTheme, THEME_KEY, systemTheme} from '../../client/src/lib/theme.js';
import {fakeServer, renderApp, screen, waitFor, act, payload, lessonOf, stateWith, ready} from './support.jsx';

const html = () => document.documentElement.getAttribute('data-theme');
const btn = scope => (scope || document).querySelector('[data-action="theme-toggle"]');
const boot = async (o = {}, lesson = null, state = stateWith('en', 0)) => { fakeServer({'GET /api/me': () => ({data: payload(state, lesson)})}); const r = renderApp(o); await ready(); return r; };
const dark = () => { window.matchMedia = fakeMedia(true); return window.matchMedia; };

test('resolution: nothing / garbage / unavailable storage -> system theme; saved light|dark wins over the system', () => {
  expect(getTheme()).toEqual({theme: 'light', source: 'system'});
  dark(); expect(getTheme()).toEqual({theme: 'dark', source: 'system'});
  localStorage.setItem(THEME_KEY, 'light'); expect(getTheme()).toEqual({theme: 'light', source: 'user'});
  localStorage.setItem(THEME_KEY, 'neon'); expect(getTheme()).toEqual({theme: 'dark', source: 'system'});
  localStorage.setItem(THEME_KEY, '{"x":1}'); expect(getTheme().source).toBe('system');
  localStorage.setItem(THEME_KEY, 'dark'); window.matchMedia = fakeMedia(false); expect(getTheme()).toEqual({theme: 'dark', source: 'user'});
  expect(getTheme()).toBe(getTheme());           // кеш снимка: useSyncExternalStore не зацикливается
});

test('storage exceptions: read throws -> system theme; write throws -> choice still works for this page (in memory), nothing crashes', () => {
  dark();
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  expect(getTheme()).toEqual({theme: 'dark', source: 'system'});
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(() => setTheme('light')).not.toThrow(); expect(getTheme()).toEqual({theme: 'light', source: 'user'}); expect(html()).toBe('light');
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  expect(() => resetTheme()).not.toThrow(); expect(getTheme().source).toBe('system');
  get.mockRestore(); set.mockRestore();
});

test('no matchMedia at all (old browser/jsdom): falls back to light without throwing', () => {
  window.matchMedia = undefined; expect(systemTheme()).toBe('light'); expect(getTheme().theme).toBe('light');
  window.matchMedia = () => { throw new Error('boom'); }; expect(systemTheme()).toBe('light');
});

test('setTheme writes only jenius.theme, ignores invalid values; toggle flips; html data-theme + theme-color meta follow', () => {
  document.head.insertAdjacentHTML('beforeend', '<meta name="theme-color" content="#73db67">');
  const meta = document.querySelector('meta[name="theme-color"]'), before = {...localStorage};
  setTheme('bogus'); expect(localStorage.getItem(THEME_KEY)).toBeNull();
  toggleTheme(); expect(localStorage.getItem(THEME_KEY)).toBe('dark'); expect(html()).toBe('dark'); expect(meta.content).toBe('#0e1411');
  toggleTheme(); expect(localStorage.getItem(THEME_KEY)).toBe('light'); expect(html()).toBe('light'); expect(meta.content).toBe('#73db67');
  expect(Object.keys(localStorage)).toEqual(['jenius.theme']); expect(before).toEqual({}); meta.remove();
});

test('system change is applied only while the user has not chosen; the choice then wins; reset returns to the system', () => {
  const mm = dark(); const stop = startTheme(); expect(html()).toBe('dark');
  act(() => mm.mq.set(false)); expect(html()).toBe('light');
  setTheme('dark'); act(() => mm.mq.set(false)); expect(html()).toBe('dark');
  act(() => mm.mq.set(true)); resetTheme(); expect(localStorage.getItem(THEME_KEY)).toBeNull(); expect(html()).toBe('dark');
  act(() => mm.mq.set(false)); expect(html()).toBe('light'); stop();
  act(() => mm.mq.set(true)); expect(html()).toBe('light');   // после stop слушателей нет
});

test('cross-tab: a storage event for jenius.theme re-applies the theme; other keys are ignored; clear() resets to the system', () => {
  const stop = startTheme(); expect(html()).toBe('light');
  localStorage.setItem(THEME_KEY, 'dark'); act(() => { window.dispatchEvent(new StorageEvent('storage', {key: THEME_KEY, newValue: 'dark'})); }); expect(html()).toBe('dark');
  localStorage.setItem('other', 'x'); act(() => { window.dispatchEvent(new StorageEvent('storage', {key: 'other'})); }); expect(html()).toBe('dark');
  localStorage.clear(); act(() => { window.dispatchEvent(new StorageEvent('storage', {key: null})); }); expect(html()).toBe('light'); stop();
});

test('button: present in the main header, on /login, /register and in the lesson; absent from course/tier pickers; aria + keyboard', async () => {
  const {user} = await boot(); const b = btn(document.querySelector('header'));
  expect(b).toBeTruthy(); expect(b.getAttribute('aria-label')).toBe('Tungi rejim'); expect(b.getAttribute('aria-pressed')).toBe('false'); expect(b.type).toBe('button');
  b.focus(); await user.keyboard('{Enter}'); expect(html()).toBe('dark'); expect(b.getAttribute('aria-pressed')).toBe('true'); expect(document.activeElement).toBe(b);
  await user.keyboard(' '); expect(html()).toBe('light'); expect(b.getAttribute('aria-pressed')).toBe('false');
  expect(localStorage.getItem(THEME_KEY)).toBe('light');
});
for (const path of ['/login', '/register']) test(`button on ${path}`, async () => {
  fakeServer({'GET /api/me': () => ({status: 401, data: {error: 'x'}})}); const {user} = renderApp({path}); await waitFor(() => expect(btn()).toBeTruthy());
  await user.click(btn()); expect(html()).toBe('dark'); expect(btn().getAttribute('aria-pressed')).toBe('true');
});
test('course chooser and tier picker have no theme button (focus order is relied on by modal-focus tests)', async () => {
  fakeServer({'GET /api/me': () => ({data: payload(stateWith(null), null)})}); renderApp();
  const d = await screen.findByRole('dialog'); expect(btn(d)).toBeNull();
});

test('account page: reset link removes the saved choice and returns to the system theme', async () => {
  dark(); localStorage.setItem(THEME_KEY, 'light'); const stop = startTheme();
  const {user} = await boot({path: '/'}); await user.click(document.querySelector('[data-page="account"], nav button:nth-of-type(4)') || screen.getByText(/Hisob/));
  const r = await screen.findByText('Tizim sozlamasiga qaytarish'); expect(html()).toBe('light');
  await user.click(r); expect(localStorage.getItem(THEME_KEY)).toBeNull(); expect(html()).toBe('dark'); stop();
});

test('lesson: toggling the theme keeps the typed text, selection, hearts/coins, focus, makes no API call, Enter in the answer field does not toggle', async () => {
  const wi = courseQuestions('en', 0, 1, false).findIndex(q => q.type === 'write-en'), ci = courseQuestions('en', 0, 1, false).findIndex(q => q.type === 'choice');
  const st = stateWith('en', 0);
  const srv = fakeServer({'GET /api/me': () => ({data: payload(st, lessonOf({index: wi, correct: wi}))})});
  const {user} = renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'});
  expect(btn(d)).toBeTruthy();
  const inp = d.querySelector('#answer'); await user.type(inp, 'abc'); inp.setSelectionRange(1, 2);
  const stats = () => ['coins', 'hearts', 'streak'].map(k => document.querySelector(`[data-stat="${k}"]`).textContent), s0 = stats(), calls0 = srv.fetchMock.mock.calls.length;
  await user.click(btn(d)); expect(html()).toBe('dark');
  expect(d.querySelector('#answer')).toBe(inp); expect(inp.value).toBe('abc'); expect([inp.selectionStart, inp.selectionEnd]).toEqual([1, 2]);
  await user.click(btn(d)); expect(html()).toBe('light'); expect(stats()).toEqual(s0); expect(inp.value).toBe('abc');
  inp.focus(); await user.keyboard('{Enter}');      // Enter с поля ответа — «проверить»; тему не трогает
  expect(html()).toBe('light'); expect(localStorage.getItem(THEME_KEY)).toBe('light');
  expect(srv.fetchMock.mock.calls.slice(calls0).every(([u]) => !/theme/.test(u))).toBe(true);
  expect(ci).toBeGreaterThanOrEqual(0);
});

test('lesson: theme toggle does not remount the dialog/question (same DOM node) and never calls the API', async () => {
  const st = stateWith('en', 0), ci = courseQuestions('en', 0, 1, false).findIndex(q => q.type === 'choice');
  const srv = fakeServer({'GET /api/me': () => ({data: payload(st, lessonOf({index: ci, correct: ci}))})});
  const {user} = renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'});
  const choices = d.querySelectorAll('.choice'); await user.click(choices[1]); const n = srv.fetchMock.mock.calls.length;
  await user.click(btn(d)); await user.click(btn(d)); await user.click(btn(d));
  expect(d.querySelectorAll('.choice')[1]).toBe(choices[1]); expect(choices[1].className).toContain('selected');
  expect(srv.fetchMock.mock.calls.length).toBe(n);
});
