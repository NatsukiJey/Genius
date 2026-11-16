import test from 'node:test';
import assert from 'node:assert/strict';
import {focusables, trapTarget, enterSubmits} from '../shared/keys.mjs';

// Мини-DOM: узлы с parent, hidden, closest('[hidden]' | '.sound-panel'), querySelectorAll у корня. Логика скрытия — как у браузера:
// элемент внутри [hidden]-предка недоступен для Tab.
function node(tag, o = {}, parent = null) {
  const n = {tagName: tag.toUpperCase(), id: o.id || '', type: o.type || '', disabled: !!o.disabled, hidden: !!o.hidden, tabIndex: o.tabIndex ?? 0, cls: o.cls || '', parent, name: o.name || o.id || tag};
  n.closest = sel => { for (let x = n; x; x = x.parent) { if (sel === '[hidden]' && x.hidden) return x; if (sel === '.sound-panel' && x.cls === 'sound-panel') return x; } return null; };
  return n;
}
function dialog({panelOpen}) {   // как lesson-dialog: ✕, ответ, проверить, [кнопка звука, панель звука(7 ползунков+7 mute)]
  const root = {all: []}, add = (t, o, p) => { const n = node(t, o, p); root.all.push(n); return n; };
  const dlg = {hidden: false, parent: null, closest: () => null};
  const close = add('button', {name: 'close'}, dlg), answer = add('input', {id: 'answer', type: 'text'}, dlg), check = add('button', {name: 'check'}, dlg);
  const toggle = add('button', {name: 'sound-toggle'}, dlg);
  const panel = {hidden: !panelOpen, cls: 'sound-panel', parent: dlg};
  const sliders = [], mutes = [];
  for (let i = 0; i < 7; i++) { sliders.push(add('input', {type: 'range', name: 'range' + i}, panel)); mutes.push(add('button', {name: 'mute' + i}, panel)); }
  const quick = add('input', {type: 'range', id: 'snd-quick-background'}, dlg);
  root.querySelectorAll = () => root.all;
  return {root, close, answer, check, toggle, sliders, mutes, quick, panel};
}

test('hidden sound panel inputs/buttons are NOT focusable; Tab ring is only the visible controls', () => {
  const d = dialog({panelOpen: false});
  const f = focusables(d.root);
  assert.deepEqual(f.map(e => e.name), ['close', 'answer', 'check', 'sound-toggle', 'snd-quick-background']);
  for (const s of d.sliders) assert.ok(!f.includes(s)); for (const m of d.mutes) assert.ok(!f.includes(m));
});

test('Tab from last visible control wraps to first (never lands on hidden panel); Shift+Tab wraps to last', () => {
  const d = dialog({panelOpen: false}), f = focusables(d.root);
  assert.equal(trapTarget(f, d.quick, false), d.close, 'Tab on last -> first');
  assert.equal(trapTarget(f, d.close, true), d.quick, 'Shift+Tab on first -> last (visible quick slider, not a hidden mute)');
  assert.equal(trapTarget(f, d.answer, false), null, 'middle: browser handles Tab natively');
  assert.equal(trapTarget(f, d.sliders[3], false), d.close, 'focus on a hidden element is pulled back in');
});

test('open sound panel: its sliders and mute buttons become part of the Tab ring, in reach by keyboard', () => {
  const d = dialog({panelOpen: true}), f = focusables(d.root);
  assert.equal(f.length, 5 + 14);
  for (const s of d.sliders) assert.ok(f.includes(s)); for (const m of d.mutes) assert.ok(f.includes(m));
  assert.equal(trapTarget(f, f.at(-1), false), f[0]);
});

test('disabled, type=hidden, tabindex=-1 are skipped; empty dialog does not crash', () => {
  const root = {querySelectorAll: () => [node('button', {disabled: true}), node('input', {type: 'hidden'}), node('a', {tabIndex: -1}), node('button', {name: 'ok'})]};
  assert.deepEqual(focusables(root).map(e => e.name), ['ok']);
  assert.equal(trapTarget([], null, false), null); assert.deepEqual(focusables(null), []);
});

test('Enter on a range slider / sound panel / buttons does NOT submit the lesson answer', () => {
  const d = dialog({panelOpen: true});
  for (const s of d.sliders) assert.equal(enterSubmits(s), false, 'panel slider');
  assert.equal(enterSubmits(d.quick), false, 'quick background slider');
  for (const m of d.mutes) assert.equal(enterSubmits(m), false); assert.equal(enterSubmits(d.toggle), false); assert.equal(enterSubmits(d.check), false);
  assert.equal(enterSubmits(node('select')), false); assert.equal(enterSubmits(node('a')), false);
  assert.equal(enterSubmits(node('input', {type: 'range'})), false, 'any range input anywhere');
});

test('Enter still submits from the answer field and from nowhere (body)', () => {
  const d = dialog({panelOpen: false});
  assert.equal(enterSubmits(d.answer), true); assert.equal(enterSubmits(node('body')), true); assert.equal(enterSubmits(null), true);
});

test('sound panel markup/handlers are real React (hidden by default, hidden property, Escape, keys.mjs); server serves the built JS with a JS type', async () => {
  const {readClientSource, readStyles} = await import('./clientSrc.mjs'), app = readClientSource();
  assert.match(app, /import \{focusables, trapTarget\} from '@shared\/keys\.mjs'/); assert.match(app, /import \{enterSubmits\} from '@shared\/keys\.mjs'/);
  assert.match(app, /enterSubmits\(e\.target\)/); assert.match(app, /trapTarget\(focusables\(ref\.current\), document\.activeElement, e\.shiftKey\)/);
  assert.doesNotMatch(app, /!e\.target\.matches\('button'\)/, 'old Enter rule is gone');
  assert.doesNotMatch(app, /querySelectorAll\('button:not\(:disabled\),input,textarea,a'\)/, 'old trap selector is gone');
  assert.match(app, /className="sound-panel"[^>]*hidden=\{!open\}/, 'panel is rendered with hidden attribute when closed');
  assert.match(readStyles(), /\.sound-panel\[hidden\]\{display:none\}/);
  const {boot, FIXTURE_ASSET_JS} = await import('./helpers.mjs'); const env = await boot();
  try { const r = await fetch(`${env.base}/assets/${FIXTURE_ASSET_JS}`); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /javascript/); }
  finally { await env.app.close?.(); }
});

test('sound panel CSS is viewport-safe: fixed with margins on phones, static inside the lesson modal', async () => {
  const {readStyles} = await import('./clientSrc.mjs'), css = readStyles();
  const phone = css.match(/@media\(max-width:620px\)\{\s*header \.sound-panel,\.auth-tools \.sound-panel\{([^}]*)\}/);
  assert.ok(phone, 'phone rule covers header and auth panels');
  for (const re of [/position:fixed/, /left:10px/, /right:10px/, /width:auto/, /max-height:calc\(100dvh/, /overflow:auto/]) assert.match(phone[1], re);
  assert.match(css, /@media\(max-width:900px\)\{\s*header \.sound-panel\{position:fixed[^}]*width:min\(340px,calc\(100vw - 24px\)\)/);
  const last = css.lastIndexOf('.dialog .sound-panel{');
  assert.ok(last > css.lastIndexOf('header .sound-panel,.auth-tools .sound-panel{'), 'lesson rule comes after fixed rules');
  assert.match(css.slice(last, css.indexOf('}', last)), /position:static[^}]*overflow:visible/);
  assert.doesNotMatch(css, /\.sound-panel[^{]*\{[^}]*(left|right):-/, 'no negative offsets');
});
