import test from 'node:test';
import assert from 'node:assert/strict';
import {createSound, normalizePrefs, STORAGE_KEY, CHANNELS, SRC} from '../shared/sound.mjs';

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

test('defaults and garbage repair', () => {
  const d = normalizePrefs(null);
  assert.equal(d.master.vol, 80); assert.equal(d.ch.background.vol, 25); for (const c of ['click', 'select', 'correct', 'win', 'lose']) assert.equal(d.ch[c].vol, 70);
  const g = normalizePrefs({master: {vol: 999, muted: 'yes'}, ch: {background: {vol: -5}, click: {vol: 'abc'}, select: 42, correct: {vol: 33.6, muted: true}}});
  assert.deepEqual(g.master, {vol: 100, muted: false}); assert.equal(g.ch.background.vol, 0); assert.equal(g.ch.click.vol, 70); assert.equal(g.ch.select.vol, 70);
  assert.deepEqual(g.ch.correct, {vol: 34, muted: true});
  for (const bad of ['{not json', '"x"', '[]', 'null']) { const r = rig({stored: bad}); r.sound.init(); assert.equal(r.sound.getPrefs().master.vol, 80); }
});

test('volume math, mute and local persistence', () => {
  const r = rig(); r.sound.init();
  assert.ok(Math.abs(r.sound.volumeOf('click') - 0.56) < 1e-9); assert.ok(Math.abs(r.sound.volumeOf('background') - 0.2) < 1e-9);
  r.sound.setVolume('master', 50); r.sound.setVolume('click', 40); assert.ok(Math.abs(r.sound.volumeOf('click') - 0.2) < 1e-9);
  r.sound.setVolume('click', 500); assert.equal(r.sound.getPrefs().ch.click.vol, 100);
  r.sound.setMuted('click', true); assert.equal(r.sound.volumeOf('click'), 0); r.sound.setMuted('click', false);
  r.sound.setMuted('master', true); assert.equal(r.sound.volumeOf('select'), 0);
  const saved = JSON.parse(r.store.get(STORAGE_KEY)); assert.equal(saved.master.vol, 50); assert.equal(saved.master.muted, true);
  const r2 = rig({stored: r.store.get(STORAGE_KEY)}); r2.sound.init(); assert.equal(r2.sound.getPrefs().master.muted, true);
  assert.equal(CHANNELS.length, 6);
});

test('no sound or background before a user gesture; gesture unlocks and starts background once', async () => {
  const r = rig(); r.sound.init();
  assert.equal(r.sound.play('click'), false); assert.equal(r.made.length, 0);
  r.gesture(); await r.tick();
  const bg = r.by('background'); assert.ok(bg.loop); assert.equal(bg.preload, 'none'); assert.equal(bg.plays, 1); assert.ok(Math.abs(bg.volume - 0.2) < 1e-9);
  assert.equal(r.count(r.dl), 1, 'only visibilitychange left; gesture listeners removed');
  r.gesture(); assert.equal(bg.plays, 1);
  assert.equal(r.sound.play('click'), true);
});

test('rejected play() is safe and re-arms the gesture unlock', async () => {
  const r = rig({reject: true}); r.sound.init(); r.gesture(); await r.tick(); await r.tick();
  assert.equal(r.sound.isUnlocked(), false); assert.ok(r.dl.pointerdown.size === 1);
  assert.doesNotThrow(() => r.sound.play('click'));
  r.sound.setMuted('master', true); r.sound.setMuted('master', false);
});

test('hidden tab pauses background; visible resumes only if background enabled', async () => {
  const r = rig(); r.sound.init(); r.gesture(); await r.tick();
  const bg = r.by('background');
  r.document.visibilityState = 'hidden'; r.emit(r.dl, 'visibilitychange'); assert.equal(bg.paused, true);
  assert.equal(r.sound.play('click'), false, 'no effects while hidden');
  r.document.visibilityState = 'visible'; r.emit(r.dl, 'visibilitychange'); await r.tick(); assert.equal(bg.paused, false);
  r.sound.setMuted('background', true); assert.equal(bg.paused, true);
  r.document.visibilityState = 'hidden'; r.emit(r.dl, 'visibilitychange'); r.document.visibilityState = 'visible'; r.emit(r.dl, 'visibilitychange');
  assert.equal(bg.paused, true, 'muted background stays paused');
  r.sound.setMuted('background', false); await r.tick(); assert.equal(bg.paused, false);
});

test('throttle click/select, same channel restarts instead of stacking', async () => {
  const r = rig(); r.sound.init(); r.gesture(); await r.tick();
  assert.equal(r.sound.play('click'), true); assert.equal(r.sound.play('click'), false); assert.equal(r.sound.play('select'), true);
  r.clock.t += 81; assert.equal(r.sound.play('click'), true);
  const c = r.by('click'); assert.equal(c.plays, 2); assert.equal(c.currentTime, 0);
  assert.equal(r.made.filter(a => a.src === SRC.click).length, 1, 'one element per channel');
  r.sound.play('correct'); r.sound.play('correct'); assert.equal(r.by('correct').plays, 2); assert.equal(r.made.filter(a => a.src === SRC.correct).length, 1);
});

test('background ducks during correct/win/lose until ended', async () => {
  const r = rig(); r.sound.init(); r.gesture(); await r.tick();
  const bg = r.by('background'), full = bg.volume;
  r.sound.play('correct'); assert.ok(Math.abs(bg.volume - full * 0.4) < 1e-9);
  r.by('correct').fire('ended'); assert.ok(Math.abs(bg.volume - full) < 1e-9);
  r.sound.play('win'); assert.ok(bg.volume < full); r.by('win').fire('ended'); assert.ok(Math.abs(bg.volume - full) < 1e-9);
});

test('win/lose once per key; muted effect does not duck; no play before init', async () => {
  const r = rig(); assert.equal(r.sound.play('click'), false); r.sound.init(); r.gesture(); await r.tick();
  assert.equal(r.sound.playOnce('7:review', 'lose'), true); assert.equal(r.sound.playOnce('7:review', 'lose'), false);
  assert.equal(r.sound.playOnce('7:done', 'win'), true); assert.equal(r.by('lose').plays, 1);
  r.sound.setMuted('correct', true); const bg = r.by('background'); r.by('lose').fire('ended'); r.by('win').fire('ended'); const v = bg.volume;
  assert.equal(r.sound.play('correct'), false); assert.ok(Math.abs(bg.volume - v) < 1e-9);
});

test('rejected effect play releases the duck', async () => {
  const r = rig(); r.sound.init(); r.gesture(); await r.tick();
  const bg = r.by('background'), full = bg.volume;
  const a = (r.sound.play('lose'), r.by('lose')); a.play = () => Promise.reject(new Error('x'));
  r.sound.play('win'); r.by('win').fire('ended'); r.by('lose').fire('ended'); assert.ok(Math.abs(bg.volume - full) < 1e-9);
  r.by('lose').play = () => Promise.reject(new Error('x')); r.sound.playOnce('k', 'lose'); await r.tick(); await r.tick();
  assert.ok(Math.abs(bg.volume - full) < 1e-9);
});

test('init twice adds no duplicate listeners; destroy removes everything and pauses', async () => {
  const r = rig(); r.sound.init(); const n = r.count(r.dl) + r.count(r.wl); r.sound.init(); r.sound.init();
  assert.equal(r.count(r.dl) + r.count(r.wl), n);
  r.gesture(); await r.tick(); r.sound.play('correct');
  const bg = r.by('background'); r.sound.destroy();
  assert.equal(r.count(r.dl), 0); assert.equal(r.count(r.wl), 0); assert.equal(bg.paused, true);
  assert.equal(r.by('correct').l.ended.size, 0); assert.equal(r.sound.play('click'), false);
  r.sound.init(); assert.equal(r.count(r.dl), 0, 'destroyed instance stays dead');
});

test('storage event from another tab updates preferences', async () => {
  const r = rig(); r.sound.init(); let seen = 0; r.sound.onChange(() => seen++);
  r.store.set(STORAGE_KEY, JSON.stringify({v: 1, master: {vol: 10, muted: false}, ch: {}}));
  r.emit(r.wl, 'storage', {key: 'other'}); assert.equal(r.sound.getPrefs().master.vol, 80);
  r.emit(r.wl, 'storage', {key: STORAGE_KEY}); assert.equal(r.sound.getPrefs().master.vol, 10); assert.equal(seen, 1);
});

// «app wiring» (звук только после ответа сервера, подписи каналов, aria-атрибуты, Escape, честный Google) —
// теперь проверяется на настоящем отрисованном React: tests/ui/sound-flow.test.jsx, tests/ui/sound-panel.test.jsx, tests/ui/google-note.test.jsx.
test('React sound sources use the documented API only (no inline handlers/styles, createSound from shared)', async () => {
  const {readClientSource, readRoot} = await import('./clientSrc.mjs'), app = readClientSource(), html = readRoot('client/index.html');
  assert.doesNotMatch(app + html, /\son[a-z]+\s*=\s*["']|\sstyle\s*=/i);
  assert.match(app, /import \{createSound\} from '@shared\/sound\.mjs'/);
  for (const k of ['Umumiy', 'Fon musiqasi', 'Bosish', 'Tanlash', 'To‘g‘ri javob', 'G‘alaba', 'Mag‘lubiyat']) assert.ok(app.includes(k), k);
  assert.match(app, /type="range" min="0" max="100"/); assert.match(app, /aria-pressed/); assert.match(app, /aria-expanded/); assert.match(app, /aria-valuetext/);
  assert.match(app, /snd-quick-background/); assert.match(app, /e\.key === 'Escape' && openRef\.current/);
  const {readStyles} = await import('./clientSrc.mjs'); assert.match(readStyles(), /\.sound-panel/);
});
