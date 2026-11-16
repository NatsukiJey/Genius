import {safeStorage} from './storage.js';

export const LOCAL_KEY = 'jenius.progress.v1';
export const MIGRATED_KEY = 'jenius.migratedTo';

// Старый прогресс из браузера (до появления серверных аккаунтов). Возвращает объект или null.
// Предлагается ТОЛЬКО при регистрации; после переноса ставим MIGRATED_KEY. Сами старые данные мы не удаляем и не пишем.
export function localImportCandidate(storage = safeStorage()) {
  try {
    if (storage.getItem(MIGRATED_KEY)) return null;
    const v = JSON.parse(storage.getItem(LOCAL_KEY));
    if (v?.version === 1 && Array.isArray(v.completed) && v.completed.length === 4 && v.completed.every(Array.isArray) && v.completed.some(c => c.length)) return v;
  } catch {}
  return null;
}
export const markMigrated = (username, storage = safeStorage()) => { try { storage.setItem(MIGRATED_KEY, username); } catch {} };
export const countLevels = cand => cand.completed.reduce((a, c) => a + c.length, 0);
