import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSound, STORAGE_KEY, SRC} from '../shared/sound.mjs';

// Переходы звука: итог урока, mute/0 во время игры, скрытая вкладка. Тот же «поддельный Audio», что в sound.test.mjs.
function rig({stored, reject = false, hidden = false} = {}) {
  const made = [], clock = {t: 1000}, store = new Map(stored === undefined ? [] : [[STORAGE_KEY, stored]]);
  class FakeAudio {
    constructor(src) { this.src = src; this.volume = 1; this.currentTime = 0; this.paused = true; this.plays = 0; this.pauses = 0; this.l = {}; made.push(this); }
    play() { this.plays++; this.paused = false; return reject ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(); }
    pause() { this.pauses++; this.paused = true; }
    addEventListener(t, f) { (this.l[t] ||= new Set()).add(f); }
    removeEventListener(t, f) { this.l[t]?.delete(f); }
    fire(t) { for (const f of [...(this.l[t] || [])]) f(); }
  }
  const dl = {}, wl = {};
  const mk = o => ({addEventListener(t, f) { (o[t] ||= new Set()).add(f); }, removeEventListener(t, f) { o[t]?.delete(f); }});
  const document = {...mk(dl), visibilityState: hidden ? 'hidden' : 'visible'}, win = mk(wl);
  const storage = {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, v)};
  const sound = createSound({Audio: FakeAudio, storage, document, win, now: () => clock.t});
  const count = o => Object.values(o).reduce((a, s) => a + s.size, 0);
  const emit = (o, t, e) => [...(o[t] || [])].forEach(f => f(e));
  const by = n => made.find(a => a.src === SRC[n]);
  return {sound, made, clock, store, dl, wl, document, count, emit, by, tick: () => new Promise(r => setImmediate(r)), gesture: () => emit(dl, 'pointerdown', {})};
}


const up = async r => { r.sound.init(); r.gesture(); await r.tick(); };  // init + жест
const hide = (r, v) => { r.document.visibilityState = v ? 'hidden' : 'visible'; r.emit(r.dl, 'visibilitychange', {}); };

test('terminal win stops a still-playing correct, releases its duck, no overlap', async () => {
  const r = rig(); await up(r);
  r.sound.play('correct'); await r.tick();
  const cor = r.by('correct'), bg = r.by('background');
  assert.equal(cor.paused, false); assert.ok(Math.abs(bg.volume - 0.8 * 0.25 * 0.4) < 1e-9, 'ducked while correct plays');
  r.sound.playOnce('L1:passed', 'win'); await r.tick();
  assert.equal(cor.paused, true, 'correct stopped'); assert.equal(cor.currentTime, 0);
  assert.equal(r.by('win').paused, false, 'win plays');
  assert.ok(Math.abs(bg.volume - 0.8 * 0.25 * 0.4) < 1e-9, 'still ducked by win itself');
  r.by('win').fire('ended');
  assert.ok(Math.abs(bg.volume - 0.8 * 0.25) < 1e-9, 'duck fully released after win ends, no stale correct duck');
});

test('terminal lose (exam_failed / no_hearts / review) also stops correct', async () => {
  const r = rig(); await up(r);
  r.sound.play('correct'); await r.tick();
  r.sound.playOnce('L2:no_hearts', 'lose'); await r.tick();
  assert.equal(r.by('correct').paused, true); assert.equal(r.by('lose').paused, false);
  r.by('lose').fire('ended');
  assert.ok(Math.abs(r.by('background').volume - 0.2) < 1e-9);
  // «поздний» ended от остановленного correct ничего не ломает
  r.by('correct').fire('ended'); assert.ok(Math.abs(r.by('background').volume - 0.2) < 1e-9);
});

test('terminal result with win/lose muted: correct still stops, stale duck cleared, silence', async () => {
  const r = rig(); await up(r);
  r.sound.play('correct'); await r.tick();
  r.sound.duck(true);                       // «застрявшее» ручное приглушение
  r.sound.setMuted('lose', true);
  assert.equal(r.sound.playOnce('L3:exam_failed', 'lose'), false, 'muted lose does not play');
  assert.equal(r.by('correct').paused, true, 'correct stopped even though lose is silent');
  assert.equal(r.made.filter(a => a.src === SRC.lose).length, 0, 'lose audio never created/played');
  assert.ok(Math.abs(r.by('background').volume - 0.2) < 1e-9, 'background back to normal volume');
});

test('terminal result does not touch other state: once-per-key, normal next question keeps correct playing', async () => {
  const r = rig(); await up(r);
  r.sound.play('correct'); await r.tick();
  // обычный переход «continue» ничего не вызывает у sound — correct доигрывает
  assert.equal(r.by('correct').paused, false);
  assert.equal(r.sound.playOnce('L4:passed', 'win'), true);
  assert.equal(r.sound.playOnce('L4:passed', 'win'), false, 'same key only once');
  assert.equal(r.by('win').plays, 1);
});

test('late rejected play() of a stopped correct does not release a newer duck', async () => {
  const r = rig({reject: true}); await up(r);          // play() отклоняется, но асинхронно
  r.sound.play('correct');                              // токен 1, ещё не дождались отказа
  r.sound.playOnce('L5:passed', 'win');                 // останавливает correct (токен 2), играет win
  await r.tick();
  // win тоже отклонён → его duck снят, фон в норме, ошибок нет
  assert.ok(Math.abs(r.by('background').volume - 0.2) < 1e-9);
});

test('master mute during playback silences effects immediately and frees the duck', async () => {
  const r = rig(); await up(r);
  r.sound.play('correct'); await r.tick();
  r.sound.setMuted('master', true);
  assert.equal(r.by('correct').paused, true, 'paused at once'); assert.equal(r.by('correct').currentTime, 0);
  assert.equal(r.by('background').paused, true, 'background paused by master mute');
  r.sound.setMuted('master', false);                    // снятие mute не оживляет старый эффект
  assert.equal(r.by('correct').paused, true, 'no stale effect after unmute');
  assert.ok(Math.abs(r.by('background').volume - 0.2) < 1e-9, 'no stale duck after unmute');
});

test('channel mute or volume 0 during playback stops only that channel', async () => {
  const r = rig(); await up(r);
  r.sound.play('correct'); r.clock.t += 500; r.sound.play('click'); await r.tick();
  r.sound.setVolume('correct', 0);
  assert.equal(r.by('correct').paused, true); assert.equal(r.by('click').paused, false, 'other effect untouched');
  assert.ok(Math.abs(r.by('background').volume - 0.2) < 1e-9);
  r.sound.setMuted('click', true);
  assert.equal(r.by('click').paused, true);
  assert.equal(r.by('background').paused, false, 'background unaffected by effect mute');
  r.sound.setVolume('correct', 70);
  assert.equal(r.by('correct').paused, true, 'raising volume does not resume a stopped effect');
});

test('lowering (but not zeroing) volume mid-play applies live and keeps playing', async () => {
  const r = rig(); await up(r);
  r.sound.play('win'); await r.tick();
  r.sound.setVolume('win', 20);
  assert.equal(r.by('win').paused, false); assert.ok(Math.abs(r.by('win').volume - 0.16) < 1e-9);
});

test('storage event (another tab mutes) silences playing effects', async () => {
  const r = rig(); await up(r);
  r.sound.play('correct'); await r.tick();
  r.store.set(STORAGE_KEY, JSON.stringify({v: 1, master: {vol: 80, muted: true}, ch: {}}));
  r.emit(r.wl, 'storage', {key: STORAGE_KEY});
  assert.equal(r.by('correct').paused, true);
});

test('hidden tab pauses effects (not only background); resume does not bring them back', async () => {
  const r = rig(); await up(r);
  r.sound.play('correct'); r.clock.t += 500; r.sound.play('click'); await r.tick();
  hide(r, true);
  for (const n of ['correct', 'click', 'background']) assert.equal(r.by(n).paused, true, n + ' paused while hidden');
  assert.equal(r.by('correct').currentTime, 0);
  assert.equal(r.sound.play('click'), false, 'no new effects while hidden');
  hide(r, false); await r.tick();
  assert.equal(r.by('correct').paused, true, 'correct is not resumed'); assert.equal(r.by('click').paused, true);
  assert.equal(r.by('background').paused, false, 'background resumes');
  assert.ok(Math.abs(r.by('background').volume - 0.2) < 1e-9, 'no stale duck after resume');
  r.by('correct').fire('ended');                        // поздний ended не ломает громкость
  assert.ok(Math.abs(r.by('background').volume - 0.2) < 1e-9);
});

test('after stop, effects can be played again normally (ducking works again)', async () => {
  const r = rig(); await up(r);
  r.sound.play('correct'); await r.tick(); hide(r, true); hide(r, false);
  r.clock.t += 1000;
  assert.equal(r.sound.play('correct'), true); await r.tick();
  assert.equal(r.by('correct').paused, false); assert.ok(Math.abs(r.by('background').volume - 0.08) < 1e-9);
  r.by('correct').fire('ended'); assert.ok(Math.abs(r.by('background').volume - 0.2) < 1e-9);
});

test('destroy leaves no active effects or ducks', async () => {
  const r = rig(); await up(r);
  r.sound.play('correct'); await r.tick(); r.sound.destroy();
  assert.equal(r.by('correct').paused, true); assert.equal(r.count(r.dl), 0);
});
