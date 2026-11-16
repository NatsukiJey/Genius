// Регрессия «белый экран»: что видит человек, когда сервер/API на самом деле не работает (Vercel без DATABASE_URL,
// API-путь отдаёт HTML, 404/403, сломанный JSON) и когда React падает во время показа.
import {test, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import {fakeServer, renderApp, payload, stateWith} from './support.jsx';
import ErrorBoundary from '../../client/src/components/ErrorBoundary.jsx';

const html = (status = 200) => ({status, ok: status < 400, json: async () => { throw new SyntaxError('Unexpected token <'); }});
// Настоящий «не-JSON» ответ: fakeServer всегда отдаёт JSON, поэтому fetch подменяем напрямую.
const htmlApi = status => { globalThis.fetch = vi.fn(async () => html(status)); };
const root = () => document.body.textContent.replace(/\s+/g, ' ').trim();

test('while /api/me is pending a loading screen is visible (root is never empty)', async () => {
  fakeServer(() => new Promise(() => {}));
  renderApp({path: '/login'});
  expect(await screen.findByText('Yuklanmoqda…')).toBeTruthy();
  expect(root()).toMatch(/Yuklanmoqda/);
});

test('503 setup error (DATABASE_URL missing) shows the real server message, not a blank page', async () => {
  fakeServer({'GET /api/me': {status: 503, data: {error: 'Baza ulanmagan: Vercel loyihasida DATABASE_URL sozlanmagan. VERCEL-SETUP.md dagi qadamlarni bajaring.', setup: 'database_url_missing'}}});
  renderApp({path: '/login'});
  expect(await screen.findByRole('heading', {name: 'Server bilan aloqa yo‘q'})).toBeTruthy();
  expect(root()).toMatch(/DATABASE_URL/); expect(root()).toMatch(/VERCEL-SETUP\.md/);
});

test('503 about unmigrated schema shows the server message', async () => {
  fakeServer({'GET /api/me': {status: 503, data: {error: 'Baza tayyor emas: npm run db:migrate ni ishga tushiring.'}}});
  renderApp({path: '/login'});
  await screen.findByRole('heading', {name: 'Server bilan aloqa yo‘q'}); expect(root()).toMatch(/db:migrate/);
});

test('API answers 200 with HTML (SPA fallback swallowed /api): setup-problem screen, no crash, no blank', async () => {
  htmlApi(200);
  renderApp({path: '/'});
  expect(await screen.findByRole('heading', {name: 'Server bilan aloqa yo‘q'})).toBeTruthy();
  expect(root()).toMatch(/\/api/); expect(root()).toMatch(/HTML/);
});

test.each([404, 403, 421])('API answers %i with HTML: setup-problem screen instead of a half-loaded app', async status => {
  htmlApi(status);
  renderApp({path: '/'});
  expect(await screen.findByRole('heading', {name: 'Server bilan aloqa yo‘q'})).toBeTruthy();
  expect(root()).toMatch(String(status));
});

test('200 JSON without user/state is treated as a broken API, not as a logged-in app', async () => {
  fakeServer({'GET /api/me': {data: {}}});
  renderApp({path: '/'});
  expect(await screen.findByRole('heading', {name: 'Server bilan aloqa yo‘q'})).toBeTruthy();
});

test('401 JSON still goes to the login form (unchanged behaviour)', async () => {
  fakeServer({'GET /api/me': {status: 401, data: {error: 'auth'}}});
  renderApp({path: '/login'});
  expect(await screen.findByRole('heading', {name: 'Kirish'})).toBeTruthy();
});

test('healthy API still reaches the app', async () => {
  fakeServer({'GET /api/me': {data: payload(stateWith('en', 0))}});
  renderApp(); expect(await screen.findByRole('navigation')).toBeTruthy();
});

test('ErrorBoundary: a render crash shows an actionable screen with reload, not an empty root', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const reload = vi.fn(), Bomb = () => { throw new Error('boom'); };
  render(<ErrorBoundary onReload={reload}><Bomb /></ErrorBoundary>);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(root()).toMatch(/Xatolik/); expect(root()).toMatch(/boom/);
  screen.getByRole('button', {name: 'Qayta yuklash'}).click(); expect(reload).toHaveBeenCalled();
});

test('app crash inside the logged-in shell (bad state shape) is caught by the boundary', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fakeServer({'GET /api/me': {data: {...payload(stateWith('en', 0)), state: {courses: null}}}});
  renderApp();
  expect(await screen.findByRole('alert')).toBeTruthy();
});
