// Проверка и очистка старого прогресса из localStorage (jenius.progress.v1). Принимает ТОЛЬКО версию 1 (английский).
// Недоверенный ввод: структура строго проверяется, значения ограничиваются.
import {freshStateV1, upgradeState, settle, dayKey, REGEN_MS, RETRY_MS} from '../shared/engine.mjs';
const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
export const earnedCoins = completed => completed.reduce((sum, c) => sum + c.length * 20 + Math.floor(c.length / 10) * 10, 0);
// Монеты, заработанные по ВСЕМ курсам состояния v2.
export const earnedCoinsAll = state => Object.values(state.courses).reduce((sum, c) => sum + earnedCoins(c.completed), 0);

// Возвращает {state} или {state:null, reason}. Никогда не бросает исключений.
export function sanitizeLocal(raw, now) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {state: null, reason: 'format'};
    if (raw.version !== 1) return {state: null, reason: 'version'};
    if (!(raw.tier === null || isInt(raw.tier, 0, 3))) return {state: null, reason: 'tier'};
    if (!Array.isArray(raw.completed) || raw.completed.length !== 4) return {state: null, reason: 'completed'};
    const completed = [];
    for (const list of raw.completed) {
      if (!Array.isArray(list) || list.length > 50) return {state: null, reason: 'completed'};
      for (let i = 0; i < list.length; i++) if (list[i] !== i + 1) return {state: null, reason: 'completed'}; // ровно 1..n, без дыр и повторов
      completed.push(list.slice());
    }
    const s = freshStateV1();
    s.tier = raw.tier; s.completed = completed;
    s.passed = [0, 1, 2, 3].map(t => Array.isArray(raw.passed) && raw.passed[t] === true && completed[t].length === 50);
    const num = (v, lo, hi, dflt) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : dflt;
    s.coins = num(raw.coins, 0, earnedCoins(completed), 0);
    s.hearts = num(raw.hearts, 0, 5, 5);
    s.regenAt = s.hearts === 5 ? null : (Number.isFinite(raw.regenAt) ? Math.min(Math.max(Math.floor(raw.regenAt), 0), now + REGEN_MS) : now + REGEN_MS);
    s.retryAt = [0, 1, 2, 3].map(t => Array.isArray(raw.retryAt) && Number.isFinite(raw.retryAt[t]) ? Math.min(Math.max(Math.floor(raw.retryAt[t]), 0), now + RETRY_MS) : 0);
    const total = completed.reduce((a, c) => a + c.length, 0);
    const day = typeof raw.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastDay) && raw.lastDay <= dayKey(now) && !Number.isNaN(Date.parse(raw.lastDay)) ? raw.lastDay : null;
    s.lastDay = day; s.streak = day ? num(raw.streak, 0, total, 0) : 0;
    s.freeze = raw.freeze === 1 ? 1 : 0;
    settle(s, now);
    return {state: upgradeState(s)}; // старый браузерный прогресс был только английским -> курс en
  } catch { return {state: null, reason: 'error'}; }
}
