// Фокус в модальных окнах (порт keys.test.mjs на настоящий DOM): ловушка Tab, скрытая панель звука, Enter, Escape, возврат фокуса.
import {test, expect} from 'vitest';
import {focusables} from '../../shared/keys.mjs';
import {fakeServer, renderApp, screen, waitFor, payload, lessonOf, stateWith, modal, dialog, ready} from './support.jsx';

async function openLesson(index = 2) {
  const st = stateWith('en', 0), srv = fakeServer({'GET /api/me': () => ({data: payload(st, lessonOf({index, correct: index}))}), 'POST /api/lesson/answer': () => ({data: {...payload(st), result: {correct: true, outcome: 'continue'}}})});
  const r = renderApp(); const d = await screen.findByRole('dialog', {name: 'Dars'}); return {...r, srv, d, st};
}
const names = els => els.map(e => e.getAttribute('aria-label') || e.id || e.getAttribute('data-action') || e.textContent.trim());

test('closed sound panel: its sliders/buttons are NOT focusable; the Tab ring is only the visible controls', async () => {
  const {d} = await openLesson(); const panel = d.querySelector('.sound-panel');
  expect(panel.hidden).toBe(true); expect(d.querySelector('[data-action="sound-toggle"]').getAttribute('aria-expanded')).toBe('false');
  const ring = focusables(d);
  for (const el of panel.querySelectorAll('input,button')) expect(ring.includes(el), 'hidden control must not be tabbable').toBe(false);
  // names() возвращает доступные имена (aria-label); id проверяем отдельно, чтобы покрытие осталось прежним.
  expect(names(ring).slice(0, 4)).toEqual(['Darsdan chiqish', 'Ovoz sozlamalari', 'Fon musiqasi balandligi', 'Javobingiz']);
  expect(ring.slice(2, 4).map(e => e.id)).toEqual(['snd-quick-background', 'answer']);
  expect(ring.at(-1).getAttribute('data-action')).toBe('check');
});

test('Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last; focus outside is pulled back in', async () => {
  const {d, user} = await openLesson(); const ring = focusables(d), first = ring[0], last = ring.at(-1);
  last.focus(); await user.keyboard('{Tab}'); expect(document.activeElement).toBe(first);
  first.focus(); await user.keyboard('{Shift>}{Tab}{/Shift}'); expect(document.activeElement).toBe(last);
  document.body.focus(); await user.keyboard('{Tab}'); expect(d.contains(document.activeElement)).toBe(true);
  for (let i = 0; i < ring.length * 2 + 3; i++) { await user.keyboard('{Tab}'); expect(d.contains(document.activeElement), 'focus never leaves the dialog').toBe(true); }
});

test('open sound panel: its 14 controls join the Tab ring; Escape closes it and returns focus to the toggle', async () => {
  const {d, user} = await openLesson(); const toggle = d.querySelector('[data-action="sound-toggle"]'), before = focusables(d).length;
  await user.click(toggle); expect(toggle.getAttribute('aria-expanded')).toBe('true'); expect(d.querySelector('.sound-panel').hidden).toBe(false);
  expect(focusables(d).length).toBe(before + 14); expect(d.querySelectorAll('.sound-panel input[type=range]')).toHaveLength(7); expect(d.querySelectorAll('.sound-panel .snd-mute')).toHaveLength(7);
  d.querySelector('#snd-lesson-click').focus(); await user.keyboard('{Escape}');
  expect(d.querySelector('.sound-panel').hidden).toBe(true); expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(toggle);
  expect(focusables(d).length).toBe(before);
});

test('Enter on sliders, mute buttons, the toggle and the close button does NOT submit the answer; Enter in the field does', async () => {
  const {d, user, srv} = await openLesson(2); await user.click(d.querySelector('[data-action="sound-toggle"]'));
  await user.type(d.querySelector('#answer'), 'abc');
  for (const el of [d.querySelector('#snd-quick-background'), d.querySelector('#snd-lesson-master'), d.querySelector('.snd-mute'), d.querySelector('[data-action="sound-toggle"]')]) { el.focus(); await user.keyboard('{Enter}'); }
  expect(srv.of('POST', '/api/lesson/answer')).toHaveLength(0);
  d.querySelector('#answer').focus(); await user.keyboard('{Enter}');
  await waitFor(() => expect(srv.of('POST', '/api/lesson/answer')).toHaveLength(1));
});

test('outside click closes the sound panel; click inside (or on the quick slider) keeps it open', async () => {
  const {d, user} = await openLesson(); const toggle = d.querySelector('[data-action="sound-toggle"]'); await user.click(toggle);
  await user.click(d.querySelector('.sound-panel .sound-row label')); expect(d.querySelector('.sound-panel').hidden).toBe(false);
  await user.click(d.querySelector('#snd-quick-background')); expect(d.querySelector('.sound-panel').hidden).toBe(false);
  await user.click(d.querySelector('.question-word')); expect(d.querySelector('.sound-panel').hidden).toBe(true);
});

test('starting a lesson closes an open sound panel (header panel too: one shared state)', async () => {
  const st = stateWith('en', 0);
  fakeServer({'GET /api/me': () => ({data: payload(st)}), 'POST /api/lesson/start': () => ({data: payload(st, lessonOf())})});
  const {user} = renderApp(); await ready();
  await user.click(document.querySelector('header [data-action="sound-toggle"]')); expect(document.querySelector('header .sound-panel').hidden).toBe(false);
  await user.click(document.querySelector('[data-level="1"]')); const d = await screen.findByRole('dialog', {name: 'Dars'});
  expect(d.querySelector('.sound-panel').hidden).toBe(true); expect(document.querySelector('header .sound-panel').hidden).toBe(true);
});

test('dialogs: role=dialog aria-modal, focus goes inside on open (first button), Tab trap works, focus returns to the opener on close', async () => {
  const st = stateWith('en', 0); fakeServer({'GET /api/me': () => ({data: payload(st)})});
  const {user} = renderApp(); await ready();
  const opener = screen.getByRole('button', {name: /Beginner/}); opener.focus(); await user.click(opener);
  const d = await screen.findByRole('dialog'); expect(d.getAttribute('aria-modal')).toBe('true'); expect(d.getAttribute('aria-labelledby')).toBe('tier-heading');
  expect(d.contains(document.activeElement)).toBe(true); expect(document.activeElement).toBe(d.querySelector('button'));
  const ring = focusables(d); ring.at(-1).focus(); await user.keyboard('{Tab}'); expect(document.activeElement).toBe(ring[0]);
  await user.click(d.querySelector('[data-action="close"]')); expect(dialog()).toBeNull(); expect(document.activeElement).toBe(opener);
});

test('Tab trap is only active while a dialog is open (page Tab is untouched afterwards)', async () => {
  const st = stateWith('en', 0); fakeServer({'GET /api/me': () => ({data: payload(st)})});
  const {user} = renderApp(); await ready(); await user.click(screen.getByRole('button', {name: /Beginner/})); await user.click(modal().querySelector('[data-action="close"]'));
  const ev = new KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true}); document.body.dispatchEvent(ev); expect(ev.defaultPrevented).toBe(false);
});
