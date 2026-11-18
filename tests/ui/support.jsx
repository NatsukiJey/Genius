import {render, screen, waitFor, act, within, fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {vi} from 'vitest';
import App from '../../client/src/App.jsx';
import {freshState, viewState} from '../../shared/engine.mjs';

export {screen, waitFor, act, within, fireEvent, userEvent};
export {freshState, viewState};

export const TODAY = '2026-11-10';
// То, что сервер присылает в каждом ответе: «плоский» вид состояния + пользователь + время сервера + незаконченный урок.
export const payload = (state, lesson = null, user = {username: 'ali'}) => ({state: viewState(state), user, serverNow: Date.now(), today: TODAY, lesson});
export const lessonOf = (o = {}) => ({id: 'L1', course: 'en', tier: 0, level: 1, exam: false, phase: 'quiz', index: 0, total: 5, correct: 0, mistakes: 0, ...o});
export const stateWith = (course, tier = null, extra = {}) => { const s = freshState(); s.activeCourse = course; if (course) s.courses[course].tier = tier; Object.assign(s, extra); return s; };

// Подменённый сервер: routes = {'GET /api/me': (body, call) => ({status, data})}. Всё, чего нет в routes, отвечает 404.
export function fakeServer(routes) {
  const calls = [], impl = async (url, init = {}) => {
    const method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : undefined; calls.push({method, url, body});
    const h = typeof routes === 'function' ? routes : routes[`${method} ${url}`];
    if (!h) return {status: 404, ok: false, json: async () => ({error: 'nf'})};
    const r = await (typeof h === 'function' ? h(body, calls) : h);
    if (r instanceof Error) throw r;
    return {status: r.status ?? 200, ok: (r.status ?? 200) < 400, json: async () => r.data ?? r.body ?? {}, headers: {get: k => r.headers?.[String(k).toLowerCase()] ?? null}};
  };
  const fetchMock = vi.fn(impl); globalThis.fetch = fetchMock;
  return {calls, fetchMock, of: (m, u) => calls.filter(c => c.method === m && c.url === u)};
}

// env с «пустым» navigate: в jsdom location.replace не навигирует, а мы хотим видеть вызов.
export function renderApp(opts = {}) {
  const channel = opts.channel ?? null, navigate = {replace: vi.fn(), reload: vi.fn()};
  if (opts.path) window.history.pushState({}, '', opts.path);
  const env = {navigate, channel, getPath: () => window.location.pathname, retryDelays: opts.retryDelays ?? []}; // по умолчанию без автоповторов: старые тесты считают запросы
  const utils = render(<App env={env} />);
  return {...utils, navigate, user: opts.fake ? userEvent.setup({advanceTimers: vi.advanceTimersByTime}) : userEvent.setup()};
}

// Дождаться, пока приложение загрузится (появится шапка или форма).
export const ready = () => screen.findByRole('navigation');
export const modal = () => document.getElementById('modal');
export const dialog = () => modal().querySelector('[role=dialog]');
export const textOf = el => el.textContent.replace(/\s+/g, ' ').trim();
