// Панель звука: 7 ползунков (общий + 6 каналов), mute, aria, сохранение в localStorage, синхронизация вкладок.
import {test, expect} from 'vitest';
import {STORAGE_KEY, DEFAULTS} from '../../shared/sound.mjs';
import {fakeServer, renderApp, screen, waitFor, fireEvent, act, payload, lessonOf, stateWith, ready} from './support.jsx';

const LABELS = ['Umumiy', 'Fon musiqasi', 'Bosish', 'Tanlash', 'To‘g‘ri javob', 'G‘alaba', 'Mag‘lubiyat'], KEYS = ['master', 'background', 'click', 'select', 'correct', 'win', 'lose'];
const saved = () => JSON.parse(localStorage.getItem(STORAGE_KEY));
const boot = async (lesson = null, o = {}) => { fakeServer({'GET /api/me': () => ({data: payload(stateWith('en', 0), lesson)})}); const r = renderApp(o); await ready(); return r; };

test('header panel: hidden by default, toggle controls it (aria-expanded/aria-controls), 7 labelled rows with the documented ranges', async () => {
  const {user} = await boot(); const toggle = document.querySelector('header [data-action="sound-toggle"]'), panel = document.getElementById('sound-panel-main');
  expect(panel.hidden).toBe(true); expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(toggle.getAttribute('aria-controls')).toBe('sound-panel-main'); expect(panel.getAttribute('aria-label')).toBe('Ovoz sozlamalari');
  await user.click(toggle); expect(panel.hidden).toBe(false); expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect([...panel.querySelectorAll('label')].map(l => l.textContent)).toEqual(LABELS);
  KEYS.forEach((k, i) => { const r = panel.querySelector(`#snd-main-${k}`); expect([r.type, r.min, r.max, r.step]).toEqual(['range', '0', '100', '5']); expect(r.value).toBe(String(DEFAULTS[k])); expect(r.getAttribute('aria-valuetext')).toBe(`${DEFAULTS[k]}%`); expect(panel.querySelector(`[data-snd-out="${k}"]`).textContent).toBe(`${DEFAULTS[k]}%`); expect(panel.querySelector(`label[for="snd-main-${k}"]`).textContent).toBe(LABELS[i]); });
  await user.click(toggle); expect(panel.hidden).toBe(true);
});

test('moving a slider updates the number, aria-valuetext and is saved locally; mute toggles aria-pressed and the icon', async () => {
  const {user} = await boot(); await user.click(document.querySelector('header [data-action="sound-toggle"]'));
  const slider = document.getElementById('snd-main-click'); fireEvent.change(slider, {target: {value: '35'}});
  expect(slider.value).toBe('35'); expect(slider.getAttribute('aria-valuetext')).toBe('35%'); expect(document.querySelector('[data-snd-out="click"]').textContent).toBe('35%'); expect(saved().ch.click.vol).toBe(35);
  const mute = document.querySelector('[data-snd-mute="correct"]'); expect(mute.getAttribute('aria-pressed')).toBe('false'); expect(mute.textContent).toBe('🔊');
  await user.click(mute); expect(mute.getAttribute('aria-pressed')).toBe('true'); expect(mute.textContent).toBe('🔇'); expect(saved().ch.correct.muted).toBe(true); expect(mute.getAttribute('aria-label')).toBe('To‘g‘ri javob: ovozni o‘chirish');
  const master = document.querySelector('[data-snd-mute="master"]'), icon = document.querySelector('header [data-action="sound-toggle"]'); expect(icon.textContent).toBe('🔊');
  await user.click(master); expect(icon.textContent).toBe('🔇'); expect(saved().master.muted).toBe(true); await user.click(master); expect(icon.textContent).toBe('🔊');
});

test('saved preferences are loaded on start; garbage in storage falls back to defaults', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({v: 1, master: {vol: 15, muted: true}, ch: {background: {vol: 60, muted: false}}}));
  await boot(); expect(document.getElementById('snd-main-master').value).toBe('15'); expect(document.getElementById('snd-main-background').value).toBe('60'); expect(document.querySelector('header [data-action="sound-toggle"]').textContent).toBe('🔇');
});
test('garbage preferences', async () => { localStorage.setItem(STORAGE_KEY, '{not json'); await boot(); expect(document.getElementById('snd-main-master').value).toBe(String(DEFAULTS.master)); });

test('lesson dialog: the quick "Fon" slider and the panel background slider are one setting; panel ids are separate per place', async () => {
  const {user} = await boot(lessonOf({index: 2})); const d = await screen.findByRole('dialog', {name: 'Dars'});
  const quick = d.querySelector('#snd-quick-background'); expect(quick.getAttribute('aria-label')).toBe('Fon musiqasi balandligi'); expect(quick.getAttribute('aria-valuetext')).toBe('25%');
  fireEvent.change(quick, {target: {value: '70'}});
  expect(d.querySelector('#snd-lesson-background').value).toBe('70'); expect(document.getElementById('snd-main-background').value).toBe('70'); expect(saved().ch.background.vol).toBe(70);
  await user.click(d.querySelector('[data-action="sound-toggle"]')); expect(d.querySelector('[data-action="sound-toggle"]').getAttribute('aria-controls')).toBe('sound-panel-lesson');
});

test('another tab changes the settings (storage event): sliders follow', async () => {
  await boot(); localStorage.setItem(STORAGE_KEY, JSON.stringify({v: 1, master: {vol: 5, muted: false}, ch: {}}));
  act(() => { window.dispatchEvent(new StorageEvent('storage', {key: STORAGE_KEY})); });
  await waitFor(() => expect(document.getElementById('snd-main-master').value).toBe('5'));
});

test('login page has its own sound button/panel', async () => {
  fakeServer({'GET /api/me': () => ({status: 401, data: {}})}); renderApp({path: '/login'}); await screen.findByRole('heading', {name: 'Kirish'});
  const p = document.getElementById('sound-panel-auth'); expect(p.hidden).toBe(true); expect(document.querySelector('.auth-tools [data-action="sound-toggle"]').getAttribute('aria-controls')).toBe('sound-panel-auth');
});
