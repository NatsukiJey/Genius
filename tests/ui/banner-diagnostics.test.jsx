// Баннер сети должен различать причины и показывать БЕЗОПАСНУЮ диагностику (вид сбоя, HTTP, код причины, id запроса) — без cookie/паролей/текстов ошибок.
import {test, expect} from 'vitest';
import {fakeServer, renderApp, screen, waitFor, payload, lessonOf, stateWith, textOf} from './support.jsx';

const banner = () => document.getElementById('banner');
const st = stateWith('en', 0);
const timeoutErr = () => Object.assign(new Error('The operation was aborted due to timeout'), {name: 'TimeoutError'});

async function bootWith(meResult) {
  let n = 0;
  fakeServer({'GET /api/me': () => (++n === 1 ? {data: payload(st, lessonOf({index: 0}))} : meResult())});
  const r = renderApp(); await screen.findByRole('dialog', {name: 'Dars'}); return r;
}
const hide = () => { Object.defineProperty(document, 'visibilityState', {get: () => 'hidden', configurable: true}); document.dispatchEvent(new Event('visibilitychange')); };
const show = () => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); };
const trigger = async () => { hide(); show(); await waitFor(() => expect(banner().hidden).toBe(false)); return textOf(banner()); };

test('503 db_timeout from the server: banner names the DATABASE timeout and the HTTP status, lesson stays', async () => {
  await bootWith(() => ({status: 503, data: {error: 'Baza vaqtincha mavjud emas.', reason: 'db_timeout', retryable: true}}));
  const t = await trigger();
  expect(t).toMatch(/baza javob bermadi \(timeout\)/); expect(t).toMatch(/HTTP 503/); expect(screen.getByRole('dialog', {name: 'Dars'})).toBeTruthy();
});

test('client-side fetch timeout, offline and broken (non-JSON) answers are three DIFFERENT messages', async () => {
  await bootWith(() => timeoutErr()); expect(await trigger()).toMatch(/server vaqtida javob bermadi \(timeout\)/);
});
test('offline (fetch TypeError) says no internet, not "server down"', async () => {
  await bootWith(() => new TypeError('Failed to fetch')); const t = await trigger(); expect(t).toMatch(/internet yo‘q/); expect(t).not.toMatch(/HTTP/);
});
test('plain 500 and bare 503 are distinguished; request id (ref) shown only from the x-vercel-id header; no secrets', async () => {
  const mk = (status, data) => () => ({status, data, headers: {'x-vercel-id': 'hkg1::abc12-1795-ffee'}});
  document.body.innerHTML = '';
  await bootWith(mk(500, {error: 'Server xatosi'})); const t = await trigger();
  expect(t).toMatch(/serverda xatolik · HTTP 500 · ref abc12-1795-ffee/); expect(t).not.toMatch(/hkg1/);
});

test('diagnostics disappear together with the banner after a successful retry', async () => {
  let down = true;
  fakeServer({'GET /api/me': () => (down ? {status: 503, data: {error: 'x', reason: 'db_connection'}} : {data: payload(st, lessonOf({index: 0}))})});
  const {user} = renderApp(); await waitFor(() => expect(banner().hidden).toBe(false), {timeout: 5000});
  expect(textOf(banner())).toMatch(/baza bilan aloqa uzildi/);
  down = false; await user.click(banner().querySelector('[data-action="retry-net"]'));
  await waitFor(() => expect(banner().hidden).toBe(true)); expect(banner().querySelector('[data-diag]')).toBeNull();
});
