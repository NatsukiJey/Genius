// Звук Jenius. Настройки звука хранятся ТОЛЬКО в этом браузере (localStorage); прогресс — на сервере.
// Всё внешнее (Audio, storage, document, win, now) передаётся снаружи, чтобы модуль можно было тестировать.
export const STORAGE_KEY = 'jenius.sound.v1';
export const CHANNELS = ['background', 'click', 'select', 'correct', 'win', 'lose'];
export const SRC = {background: '/audio/background.mp3', click: '/audio/click.wav', select: '/audio/select.wav', correct: '/audio/correct.wav', win: '/audio/win.wav', lose: '/audio/lose.wav'};
export const DEFAULTS = Object.freeze({master: 80, background: 25, click: 70, select: 70, correct: 70, win: 70, lose: 70});
export const THROTTLE_MS = 80, DUCK_FACTOR = 0.4;
const DUCKERS = new Set(['correct', 'win', 'lose']), THROTTLED = new Set(['click', 'select']), TERMINAL = new Set(['win', 'lose']);

const clampVol = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : d; };

// Мусор из хранилища превращаем в корректные настройки.
export function normalizePrefs(raw) {
  const o = raw && typeof raw === 'object' ? raw : {}, ch = o.ch && typeof o.ch === 'object' ? o.ch : {};
  const one = (x, d) => { const e = x && typeof x === 'object' ? x : {}; return {vol: clampVol(e.vol, d), muted: e.muted === true}; };
  const prefs = {v: 1, master: one(o.master, DEFAULTS.master), ch: {}};
  for (const c of CHANNELS) prefs.ch[c] = one(ch[c], DEFAULTS[c]);
  return prefs;
}

export function createSound({Audio, storage, document, win, now = Date.now} = {}) {
  let prefs, unlocked = false, armed = false, inited = false, destroyed = false, bgWanted = true, hidden = false;
  const audios = {}, ducked = new Set(), lastAt = {}, once = new Set(), endHandlers = {}, active = new Set(), token = {};  // active: эффекты, что сейчас играют; token: защита от «старых» промисов play()
  const listeners = [];     // [target, type, fn, opts] — чтобы destroy() всё снял
  const changeCbs = new Set();

  function load() { try { return normalizePrefs(JSON.parse(storage.getItem(STORAGE_KEY))); } catch { return normalizePrefs(null); } }
  function save() { try { storage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {} }
  const notify = () => { for (const f of changeCbs) { try { f(getPrefs()); } catch {} } };
  function on(target, type, fn, opts) { if (!target || !target.addEventListener) return; target.addEventListener(type, fn, opts); listeners.push([target, type, fn, opts]); }
  function offAll() { for (const [t, ty, fn, o] of listeners.splice(0)) { try { t.removeEventListener(ty, fn, o); } catch {} } }

  function getPrefs() { return JSON.parse(JSON.stringify(prefs)); }
  function volumeOf(c) {
    if (prefs.master.muted || prefs.ch[c].muted) return 0;
    let v = (prefs.master.vol / 100) * (prefs.ch[c].vol / 100);
    if (c === 'background' && ducked.size) v *= DUCK_FACTOR;
    return v;
  }
  function audioFor(c) {
    if (audios[c]) return audios[c];
    const a = new Audio(SRC[c]);
    a.preload = c === 'background' ? 'none' : 'auto';
    if (c === 'background') a.loop = true;
    audios[c] = a;
    if (c !== 'background') { endHandlers[c] = () => { active.delete(c); if (ducked.delete(c)) applyBg(); }; a.addEventListener('ended', endHandlers[c]); }
    return a;
  }
  // Немедленно останавливает один эффект (пауза + в начало) и снимает его приглушение фона.
  function stopEffect(c) {
    token[c] = (token[c] || 0) + 1;                     // отменяет «хвост» ещё не завершённого play()
    const a = audios[c];
    if (a && active.has(c)) { try { a.pause(); a.currentTime = 0; } catch {} }
    active.delete(c);
    if (ducked.delete(c)) applyBg();
  }
  function stopAllEffects() { for (const c of CHANNELS) if (c !== 'background') stopEffect(c); }
  // Если общий или канальный звук выключен (mute/0) — играющий эффект гаснет сразу, а не доигрывает беззвучно.
  function silenceMutedEffects() { for (const c of [...active]) if (volumeOf(c) <= 0) stopEffect(c); }
  function applyVolumes() { silenceMutedEffects(); for (const c of CHANNELS) if (audios[c]) audios[c].volume = volumeOf(c); }
  function applyBg() { if (audios.background) audios.background.volume = volumeOf('background'); }

  function safePlay(a) { try { const p = a.play(); return p && typeof p.then === 'function' ? p.then(() => true, () => false) : Promise.resolve(true); } catch { return Promise.resolve(false); } }

  // Фон играет, если: был жест, вкладка видима, фон включён (не mute) и громкость > 0.
  function bgShouldPlay() { return unlocked && !hidden && bgWanted && !destroyed && volumeOf('background') > 0; }
  function syncBackground() {
    if (bgShouldPlay()) {
      const a = audioFor('background'); a.volume = volumeOf('background');
      safePlay(a).then(ok => { if (!ok && !destroyed) { unlocked = false; arm(); } });
    } else if (audios.background) { try { audios.background.pause(); } catch {} }
  }

  function onGesture() { if (!unlocked) { unlocked = true; disarm(); syncBackground(); } }
  function arm() { if (armed || destroyed || !inited) return; armed = true; on(document, 'pointerdown', onGesture, true); on(document, 'keydown', onGesture, true); }
  function disarm() {
    armed = false;
    for (let i = listeners.length - 1; i >= 0; i--) { const [t, ty, fn, o] = listeners[i]; if (fn === onGesture) { try { t.removeEventListener(ty, fn, o); } catch {} listeners.splice(i, 1); } }
  }
  function onVisibility() { hidden = document.visibilityState === 'hidden'; if (hidden) stopAllEffects(); syncBackground(); }  // в скрытой вкладке эффекты не доигрываем и не возобновляем
  function onStorage(e) { if (e && e.key === STORAGE_KEY) { prefs = load(); applyVolumes(); syncBackground(); notify(); } }

  function init() {
    if (inited || destroyed) return api;
    inited = true; prefs = load(); hidden = document.visibilityState === 'hidden';
    arm();
    on(document, 'visibilitychange', onVisibility);
    on(win, 'storage', onStorage);
    return api;
  }
  function destroy() {
    destroyed = true; inited = false; offAll(); armed = false; changeCbs.clear();
    for (const c of CHANNELS) { const a = audios[c]; if (!a) continue; try { a.pause(); } catch {} if (endHandlers[c]) a.removeEventListener('ended', endHandlers[c]); }
    ducked.clear(); active.clear();
  }

  // Играет звук канала. Возвращает true, если запрос на воспроизведение отправлен.
  function play(c) {
    if (!inited || destroyed || !unlocked || c === 'background' || !SRC[c] || hidden) return false;
    if (volumeOf(c) <= 0) return false;
    const t = now();
    if (THROTTLED.has(c) && lastAt[c] !== undefined && t - lastAt[c] < THROTTLE_MS) return false;
    lastAt[c] = t;
    const a = audioFor(c);
    try { a.pause(); a.currentTime = 0; } catch {}   // тот же канал не накладывается сам на себя
    a.volume = volumeOf(c);
    const my = token[c] = (token[c] || 0) + 1; active.add(c);
    if (DUCKERS.has(c)) { ducked.add(c); applyBg(); }
    safePlay(a).then(ok => { if (!ok && token[c] === my) { active.delete(c); if (ducked.delete(c)) applyBg(); } });
    return true;
  }
  // Звук итога урока: один раз на ключ (например `${lessonId}:review`).
  // Для win/lose сначала глушим correct (он длится 4.5 с и иначе наложился бы) и снимаем «застрявшее» приглушение —
  // даже если сам win/lose выключен (mute/0): тогда просто тишина, а не хвост от correct.
  function playOnce(key, c) {
    if (once.has(key)) return false;
    once.add(key);
    if (TERMINAL.has(c)) { stopEffect('correct'); for (const t of TERMINAL) if (t !== c) stopEffect(t); ducked.delete('manual'); applyBg(); }
    return play(c);
  }
  // Приглушить фон на время показа результата ответа; release отпускает.
  function duck(on_ = true) { if (on_) ducked.add('manual'); else ducked.delete('manual'); applyBg(); }

  function mutate(fn) { fn(); save(); applyVolumes(); syncBackground(); notify(); }
  function setVolume(c, v) { mutate(() => { (c === 'master' ? prefs.master : prefs.ch[c]).vol = clampVol(v, DEFAULTS[c]); }); }
  function setMuted(c, m) { mutate(() => { (c === 'master' ? prefs.master : prefs.ch[c]).muted = !!m; }); }
  function toggleMuted(c) { setMuted(c, !(c === 'master' ? prefs.master : prefs.ch[c]).muted); }
  // Образец при отпускании ползунка. Для фона образца нет — он и так играет.
  function sample(c) { if (c === 'master') c = 'click'; if (c === 'background') return false; lastAt[c] = undefined; return play(c); }
  function onChange(f) { changeCbs.add(f); return () => changeCbs.delete(f); }

  const api = {init, destroy, play, playOnce, duck, setVolume, setMuted, toggleMuted, sample, getPrefs, onChange, volumeOf: c => volumeOf(c), isUnlocked: () => unlocked};
  prefs = normalizePrefs(null);
  return api;
}
