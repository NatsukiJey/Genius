// Тема оформления (светлая/тёмная). Хранится ТОЛЬКО на устройстве (ключ jenius.theme), сервер и база не участвуют.
// Нет ключа (или в нём мусор) -> системная тема (prefers-color-scheme). Выбор пользователя побеждает систему.
import {useSyncExternalStore} from 'react';
import {safeStorage} from './storage.js';

export const THEME_KEY = 'jenius.theme';
const META = {light: '#73db67', dark: '#0e1411'};
const subs = new Set();
let memory = null;          // выбор, который не удалось записать (хранилище недоступно): живёт до перезагрузки
let snap = {theme: 'light', source: 'system'};
let detach = null;

const valid = v => (v === 'light' || v === 'dark' ? v : null);
function stored() { try { return valid(safeStorage().getItem(THEME_KEY)); } catch { return null; } }
function mql() { try { return window.matchMedia?.('(prefers-color-scheme: dark)') || null; } catch { return null; } }
export function systemTheme() { return mql()?.matches ? 'dark' : 'light'; }

// Снимок кешируется: useSyncExternalStore требует один и тот же объект, пока ничего не изменилось.
export function getTheme() {
  const user = stored() || memory, next = user ? {theme: user, source: 'user'} : {theme: systemTheme(), source: 'system'};
  if (next.theme !== snap.theme || next.source !== snap.source) snap = next;
  return snap;
}

export function applyTheme(theme = getTheme().theme) {
  try {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[theme]);
  } catch { /* нет DOM — нечего применять */ }
}

function emit() { applyTheme(); subs.forEach(f => f()); }

export function setTheme(theme) {
  if (!valid(theme)) return;
  memory = null;
  try { safeStorage().setItem(THEME_KEY, theme); } catch { /* квота/запрет */ }
  if (stored() !== theme) memory = theme;
  emit();
}
export const toggleTheme = () => setTheme(getTheme().theme === 'dark' ? 'light' : 'dark');
export function resetTheme() {
  memory = null;
  try { safeStorage().removeItem(THEME_KEY); } catch { /* ничего */ }
  emit();
}

// Слушатели окна живут, пока есть хотя бы один подписчик (startTheme держит одного постоянно).
function attach() {
  const onStorage = e => { if (e.key === THEME_KEY || e.key === null) { memory = null; emit(); } };
  const m = mql(), onMedia = () => emit();
  window.addEventListener('storage', onStorage);
  m?.addEventListener ? m.addEventListener('change', onMedia) : m?.addListener?.(onMedia);
  return () => { window.removeEventListener('storage', onStorage); m?.removeEventListener ? m.removeEventListener('change', onMedia) : m?.removeListener?.(onMedia); };
}
export function subscribe(f) {
  if (!subs.size) detach = attach();
  subs.add(f);
  return () => { subs.delete(f); if (!subs.size && detach) { detach(); detach = null; } };
}
// Запасной путь, если boot-файл не загрузился: применяем тему сразу и следим за системой/вкладками.
export function startTheme() { applyTheme(); return subscribe(() => {}); }

export const useTheme = () => useSyncExternalStore(subscribe, getTheme);
