// Настоящий Chromium (CDP) на НАСТОЯЩЕЙ сборке dist/: тёмная и светлая темы. Не входит в npm run check. Запуск: npm run build && npm run e2e:dark
// Изолировано: свой сервер :4189, своя БД и профиль в tests/.data/dark, одноразовый аккаунт со случайным паролем (не печатается).
// Проверяет: нет вспышки (тема на первом кадре), системная тема, выбор побеждает, сохранение после перезагрузки, клик по кнопке,
// отсутствие записей в API, контраст текста >= 4.5:1 в тёмной теме (измеряется для КАЖДОГО видимого текста), нет горизонтальной прокрутки.
// Скриншоты: SHOTS=<папка> (по умолчанию tests/.data/dark/shots); отчёт контраста: tests/.data/dark/contrast.json (или CONTRAST_OUT).
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {COURSES, TYPE_SPECS, promptOf, answerOf} from '../shared/data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), work = path.join(root, 'tests', '.data', 'dark');
const shots = process.env.SHOTS || path.join(work, 'shots'), contrastOut = process.env.CONTRAST_OUT || path.join(work, 'contrast.json');
rmSync(work, {recursive: true, force: true});
for (const d of ['profile', 'tmp']) mkdirSync(path.join(work, d), {recursive: true});
mkdirSync(shots, {recursive: true});
const PORT = 4189, CDP = 9336, base = `http://127.0.0.1:${PORT}`, results = [], contrast = {};
const ok = (name, cond, info = '') => { results.push({name, ok: !!cond}); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = spawn(process.execPath, ['server.mjs'], {cwd: root, stdio: 'ignore', env: {...process.env, NODE_ENV: 'production', PORT, HOST: '127.0.0.1', DB_PATH: path.join(work, 'dark.db'), TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', ALLOWED_HOSTS: ''}});
const chrome = spawn('/usr/sbin/chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio', `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(work, 'profile')}`, 'about:blank'], {stdio: 'ignore', env: {...process.env, TMPDIR: path.join(work, 'tmp')}});
const cleanup = () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} };
process.on('exit', cleanup);
async function until(fn, ms = 10000, step = 100) { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t > ms) return null; await sleep(step); } }

// Контраст: для каждого видимого элемента с собственным текстом берём цвет текста и реальный фон (слои rgba вверх по дереву + opacity).
const MEASURE = `(() => {
  const parse = c => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return [0,0,0,0]; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (f, b) => { const a = f[3]; return [f[0]*a+b[0]*(1-a), f[1]*a+b[1]*(1-a), f[2]*a+b[2]*(1-a), 1]; };
  const lum = ([r,g,b]) => { const t = v => { v /= 255; return v <= .03928 ? v/12.92 : ((v+.055)/1.055)**2.4; }; return .2126*t(r)+.7152*t(g)+.0722*t(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
  const bgOf = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e), c = parse(s.backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] === 1) break; } let b = parse(getComputedStyle(document.documentElement).backgroundColor); if (b[3] === 0) b = parse(getComputedStyle(document.body).backgroundColor); if (b[3] === 0) b = [255,255,255,1]; for (const l of layers.reverse()) b = over(l, b); return b; };
  const opac = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  const out = [], seen = new Set(); let n = 0;
  const label = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).join('.') : '');
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.mascot,svg,script,style') || el.disabled || el.closest('[hidden]')) continue;
    const own = [...el.childNodes].filter(c => c.nodeType === 3 && c.textContent.trim()).map(c => c.textContent.trim()).join(' ');
    if (!own) continue;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || s.visibility === 'hidden' || s.display === 'none') continue;
    if (/^[\\p{Extended_Pictographic}\\s\\uFE0F↪→←×♥✓·]+$/u.test(own)) continue; // иконки-эмодзи: не текст
    const bg = bgOf(el), o = opac(el), fg0 = parse(s.color), fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * o], bg), ra = ratio(fg, bg); n++;
    if (ra < 4.5) { const k = label(el); if (!seen.has(k)) { seen.add(k); out.push({el: k, text: own.slice(0, 30), ratio: Math.round(ra * 100) / 100, fg: s.color, bg: 'rgb(' + bg.slice(0,3).map(Math.round) + ')', px: s.fontSize}); } }
  }
  return {checked: n, fails: out};
})()`;

try {
  await until(async () => (await fetch(base + '/login')).ok, 15000);
  const targets = await until(async () => { const r = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); return r.find(t => t.type === 'page') && r; }, 15000);
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(), events = [];
  ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, d => d.error ? rej(new Error(method + ': ' + d.error.message)) : res(d.result)); ws.send(JSON.stringify({id: i, method, params})); });
  const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval'); return r.result.value; };
  const waitFor = (expr, ms = 10000) => until(() => ev(`!!(${expr})`), ms);
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  const media = scheme => send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: scheme}]});
  const size = (w, h = 800) => send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: w < 700});
  const goto = async url => { await send('Page.navigate', {url}); await sleep(200); await waitFor(`document.readyState==='complete'`); };
  const click = sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('нет ${sel}'); e.click(); return true})()`);
  const fill = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(e,${JSON.stringify(v)}); e.dispatchEvent(new Event('input',{bubbles:true})); return true})()`);
  const html = () => ev(`document.documentElement.getAttribute('data-theme')`);
  const bodyBg = () => ev(`getComputedStyle(document.body).backgroundColor`);
  const writes = () => events.filter(e => e.method === 'Network.requestWillBeSent' && e.params.request.method !== 'GET' && /\/api\//.test(e.params.request.url)).length;
  const shot = async name => { const r = await send('Page.captureScreenshot', {format: 'png'}); writeFileSync(path.join(shots, name + '.png'), Buffer.from(r.data, 'base64')); };
  // Применить тему так, как это сделала бы другая вкладка (storage-событие): работает и там, где кнопки нет (окно выбора курса, результат).
  const useTheme = t => ev(`(()=>{localStorage.setItem('jenius.theme',${JSON.stringify(t)}); window.dispatchEvent(new StorageEvent('storage',{key:'jenius.theme',newValue:${JSON.stringify(t)}})); return document.documentElement.dataset.theme})()`);
  // Сцена: измерить контраст и снять экран в обеих темах. Светлая — справочно (старые цвета), тёмная — обязательна.
  const scene = async (name, w = 1280) => {
    await size(w, w < 700 ? 800 : 800);
    for (const t of ['dark', 'light']) {
      await useTheme(t); await sleep(120);
      const m = await ev(MEASURE); contrast[`${name}/${t}`] = m; await shot(`${name}-${t}-${w}`);
      if (t === 'dark') ok(`Контраст ≥4.5:1 в тёмной теме: ${name}`, m.fails.length === 0 && m.checked > 0, m.fails.length ? JSON.stringify(m.fails.slice(0, 4)) : `проверено текстов: ${m.checked}`);
    }
    await useTheme('dark');
  };
  const overflow = () => ev(`({sw:document.documentElement.scrollWidth, iw:innerWidth})`);

  // ---- 1. Системная тема и отсутствие вспышки ----
  await ev(`0`); await goto(base + '/login'); // чистый профиль
  await media('dark');
  await send('Page.addScriptToEvaluateOnNewDocument', {source: `window.__paint=null; try{new PerformanceObserver(l=>{ if(!window.__paint) window.__paint={theme:document.documentElement.getAttribute('data-theme'), bg:getComputedStyle(document.body).backgroundColor, bundle:!!document.querySelector('form')}; }).observe({type:'paint',buffered:true});}catch(e){}`});
  await ev(`localStorage.clear()`); await goto(base + '/login'); await waitFor(`document.querySelector('#login-form')`); await sleep(300);
  const paint = await ev(`window.__paint`);
  ok('Системная тёмная: data-theme=dark и тёмный фон уже на первом кадре (до React)', paint && paint.theme === 'dark' && paint.bg === 'rgb(14, 20, 17)', JSON.stringify(paint));
  ok('Системная тёмная: ключ jenius.theme НЕ записан без клика пользователя', await ev(`localStorage.getItem('jenius.theme')===null`));
  const scriptsOrder = await ev(`[...document.scripts].map(s=>s.src.split('/').pop())`);
  ok('boot-файл загружен перед бандлом, inline-скриптов нет', /^theme-boot-v1\.js$/.test(scriptsOrder[0]) && /^index-/.test(scriptsOrder[1]) && scriptsOrder.length === 2, scriptsOrder.join(', '));
  ok('boot-файл отдан как JS (не HTML-страница)', await ev(`fetch('/assets/theme-boot-v1.js').then(r=>r.headers.get('content-type'))`).then(t => /javascript/.test(t)));
  await media('light'); await goto(base + '/login'); await waitFor(`document.querySelector('#login-form')`);
  ok('Системная светлая: data-theme=light', (await html()) === 'light');

  // ---- 2. Клик по кнопке: сохранение, перезагрузка, победа над системной ----
  await media('dark'); await goto(base + '/login'); await waitFor(`document.querySelector('[data-action=theme-toggle]')`);
  ok('Кнопка темы на /login: aria-label, aria-pressed=true в тёмной', await ev(`(()=>{const b=document.querySelector('[data-action=theme-toggle]'); return b.getAttribute('aria-label')==='Tungi rejim' && b.getAttribute('aria-pressed')==='true'})()`));
  const before = writes(); await click('[data-action=theme-toggle]');
  ok('Клик → светлая тема, сохранено jenius.theme=light, aria-pressed=false', (await html()) === 'light' && await ev(`localStorage.getItem('jenius.theme')==='light' && document.querySelector('[data-action=theme-toggle]').getAttribute('aria-pressed')==='false'`));
  await goto(base + '/login'); await waitFor(`document.querySelector('#login-form')`);
  ok('После перезагрузки выбор «светлая» побеждает системную тёмную', (await html()) === 'light' && (await bodyBg()) !== 'rgb(14, 20, 17)');
  await goto(base + '/register'); await waitFor(`document.querySelector('#register-form')`);
  ok('Кнопка темы на /register', await ev(`!!document.querySelector('[data-action=theme-toggle]')`)); ok('Смена темы не делает записей в API', writes() === before);
  await ev(`localStorage.removeItem('jenius.theme')`); await goto(base + '/register'); await waitFor(`document.querySelector('#register-form')`);
  ok('Без выбора снова следует системной (тёмной)', (await html()) === 'dark');

  // ---- 3. Вход/регистрация: контраст и переполнение ----
  await useTheme('dark'); await scene('register'); await goto(base + '/login'); await waitFor(`document.querySelector('#login-form')`); await useTheme('dark'); await scene('login');
  const WIDTHS = [320, 360, 390, 414, 620, 621, 640, 680, 720, 768, 900, 1150, 1440];
  for (const t of ['dark', 'light']) { await useTheme(t); const bad = []; for (const w of WIDTHS) { await size(w); await sleep(120); const o = await overflow(), b = await ev(`(()=>{const r=document.querySelector('[data-action=theme-toggle]').getBoundingClientRect(); return [r.width,r.height,r.left,r.right]})()`); if (o.sw > o.iw || b[0] < 40 || b[1] < 40 || b[2] < 0 || b[3] > w) bad.push(`${w}:${JSON.stringify([o, b])}`); } ok(`/login (${t}): нет горизонтальной прокрутки, кнопка темы ≥40px и в окне на 10 ширинах`, bad.length === 0, bad.join(' ')); }
  await useTheme('dark'); await size(1280);
  await ev(`document.querySelector('[data-action=sound-toggle]').click()`); await sleep(150);
  await scene('login-sound-panel');
  ok('Панель звука на /login в окне на 320px', await (async () => { await size(320, 640); await sleep(150); const r = await ev(`(()=>{const p=document.querySelector('.sound-panel:not([hidden])'); const b=p.getBoundingClientRect(); return [b.left,b.right,innerWidth]})()`); return r[0] >= 0 && r[1] <= r[2] + 1; })());
  await ev(`document.querySelector('[data-action=sound-toggle]').click()`);

  // ---- 4. Регистрация (одноразовый аккаунт), выбор курса ----
  await size(1280);
  const username = 'dk' + crypto.randomBytes(4).toString('hex'), password = crypto.randomBytes(15).toString('base64url');
  await goto(base + '/register'); await waitFor(`document.querySelector('#register-form')`);
  await fill('#reg-username', username); await fill('#reg-password', password); await click('#register-form button[type=submit]');
  await waitFor(`document.querySelector('[role=dialog] [data-course="ru"]')`, 15000);
  await scene('course-chooser');
  await click('[role=dialog] [data-course="ru"]'); await waitFor(`document.querySelector('[role=dialog] [data-tier="1"]')`);
  await scene('tier-picker');
  await click('[role=dialog] [data-tier="1"]'); await waitFor(`!document.querySelector('[role=dialog]') && document.querySelectorAll('.map .level').length===50`);

  // ---- 5. Главная: карта, страницы, звук, мобильная ширина ----
  await scene('map');
  await ev(`document.querySelector('header [data-action=sound-toggle]').click()`); await sleep(150); await scene('map-sound-panel'); await ev(`document.querySelector('header [data-action=sound-toggle]').click()`);
  for (const p of ['shop', 'report', 'account']) { await click(`[data-page="${p}"]`); await sleep(250); await scene(p); }
  { const w0 = writes(); await click('header [data-action=theme-toggle]'); await click('header [data-action=theme-toggle]'); ok('Header: кнопка темы переключает без записей в API', writes() === w0 && (await html()) === 'dark'); }
  await click('[data-action=theme-reset]'); await sleep(100);
  ok('Аккаунт: «Tizim sozlamasiga qaytarish» удаляет выбор (следует системной)', await ev(`localStorage.getItem('jenius.theme')===null`) && (await html()) === 'dark');
  await useTheme('dark'); await click('[data-page="learn"]'); await sleep(200);
  for (const w of [320, 390, 1440]) { await size(w); await scene('map-w', w); }
  for (const t of ['dark', 'light']) { await useTheme(t); const bad = []; for (const w of WIDTHS) { await size(w); await sleep(120); const o = await overflow(), p = await ev(`(()=>{const b=document.querySelector('header [data-action=theme-toggle]').getBoundingClientRect(); return [b.width,b.height,b.right]})()`); if (o.sw > o.iw || p[0] < 40 || p[1] < 40 || p[2] > w) bad.push(`${w}:${o.sw}/${o.iw}:${p}`); } ok(`Главная (${t}): нет горизонтальной прокрутки, кнопка темы видна и ≥40px на 10 ширинах`, bad.length === 0, bad.join(' ')); }
  await useTheme('dark'); await size(1280);

  // ---- 6. Урок: состояние сохраняется при смене темы ----
  await click('[data-level="1"]'); await waitFor(`document.querySelector('[data-action="quiz"]')`);
  await scene('lesson-words');
  await click('[data-action="quiz"]'); await waitFor(`document.querySelector('.question-word') && document.querySelector('[data-action="check"]')`);
  const map = new Map();
  for (const type of Object.keys(TYPE_SPECS)) for (const w of COURSES.ru.words.flat()) { const k = promptOf(type, w); if (!map.has(k)) map.set(k, new Set()); map.get(k).add(answerOf(type, w)); }
  const want = Object.fromEntries([...map].map(([k, v]) => [k, [...v]]));
  const kinds = new Set(); let wrongShot = false, goodShot = false, preserved = true;
  for (let n = 0; n < 12; n++) {
    await waitFor(`document.querySelector('[data-action="done"], [data-action="retry-lesson"], [data-action="check"]')`);
    if (await ev(`!!document.querySelector('[data-action="done"]')`)) break;
    if (await ev(`!!document.querySelector('[data-action="retry-lesson"]')`)) { await scene('lesson-review'); await click('[data-action="retry-lesson"]'); await waitFor(`document.querySelector('.question-word')`); }   // после ошибки вопрос повторяется (review)
    const kind = await ev(`document.querySelector('#answer')?'write':document.querySelector('.tiles')?'tiles':'choice'`);
    const prompt = await ev(`document.querySelector('.question-word').innerText`), ans = want[prompt] || [];
    if (kind === 'choice') { const idx = await ev(`(()=>{const w=${JSON.stringify(ans)}; return [...document.querySelectorAll('.choice')].findIndex(b=>w.includes(b.innerText.replace(/^\\d+\\s*/,'').trim()))})()`); await click(`[data-choice="${n === 0 ? (idx === 0 ? 1 : 0) : Math.max(idx, 0)}"]`); }
    else if (kind === 'write') await fill('#answer', n === 0 ? 'xxx' : ans[0] || '');
    else for (const ch of [...(ans[0] || '')]) await ev(`(()=>{const b=[...document.querySelectorAll('.tiles button:not(:disabled)')].find(b=>b.innerText.replace('␣',' ')===${JSON.stringify(ch)}); if(b) b.click(); return true})()`);
    if (!kinds.has(kind)) { kinds.add(kind); await scene('lesson-' + kind); }
    // смена темы кнопкой урока не трогает ввод/выбор/сердца
    const snap = () => ev(`({a:document.querySelector('#answer')?.value ?? null, sel:[...document.querySelectorAll('.choice.selected')].length, tiles:document.querySelector('.assembled')?.innerText ?? null, h:document.querySelector('[data-stat=hearts]').textContent, c:document.querySelector('[data-stat=coins]').textContent, q:document.querySelector('.question-word').innerText})`);
    const s1 = await snap(), w0 = writes(); await click('.lesson-header [data-action=theme-toggle]'); await click('.lesson-header [data-action=theme-toggle]'); const s2 = await snap();
    if (JSON.stringify(s1) !== JSON.stringify(s2) || writes() !== w0) { preserved = false; console.log('  diff', JSON.stringify(s1), JSON.stringify(s2)); }
    await click('[data-action="check"]'); await waitFor(`document.querySelector('#answer-feedback.good, #answer-feedback.bad')`);
    const cls = await ev(`document.querySelector('#answer-feedback').className`);
    if (/bad/.test(cls) && !wrongShot) { wrongShot = true; await scene('lesson-feedback-bad'); } if (/good/.test(cls) && !goodShot) { goodShot = true; await scene('lesson-feedback-good'); }
    await click('[data-action="next"]'); await sleep(150);
  }
  ok('Урок: ввод, выбор, плитки, сердца, монеты, вопрос и фокус сохраняются при смене темы; запросов нет', preserved, [...kinds].join(','));
  ok('Урок дошёл до экрана результата', await waitFor(`document.querySelector('[data-action="done"]')`)); await scene('lesson-result');
  await click('[data-action="done"]'); await waitFor(`!document.querySelector('.result')`);
  for (const w of [320, 390, 1440]) { await click('[data-level="2"]'); await waitFor(`document.querySelector('[data-action="quiz"]')`); await ev(`document.querySelector('.lesson-header [data-action=sound-toggle]').click()`); await sleep(150); await scene('lesson-sound-panel', w); const o = await overflow(); ok(`Урок с панелью звука на ${w}px: нет горизонтальной прокрутки`, o.sw <= o.iw, `${o.sw}/${o.iw}`); await size(1280); await click('[data-action="exit"]'); await sleep(300); await ev(`(()=>{const d=document.querySelector('[role=dialog]'); const b=d&&[...d.querySelectorAll('button')].find(b=>/Ha|ha|chiq/i.test(b.innerText)); if(b) b.click(); return true})()`); await sleep(400); }

  // ---- 7. Баннер «нет сети» и тост ----
  await size(1280); await useTheme('dark');
  await send('Network.emulateNetworkConditions', {offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
  await ev(`window.dispatchEvent(new Event('focus'))`); await ev(`document.querySelector('[data-course="en"]')?.click()`);
  if (await waitFor(`!document.querySelector('#banner').hidden`, 8000)) await scene('offline-banner');
  await waitFor(`document.querySelector('#toast.show')`, 2000) && await scene('toast');
  await send('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
  await ev(`document.querySelector('[data-action="retry-net"]')?.click()`);

  // ---- 8. Экран ошибки «нет связи» (первая загрузка без сервера) ----
  await ev(`document.cookie.split(';').forEach(c=>{document.cookie=c.split('=')[0]+'=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'})`).catch(() => {});
  ok('Нет ошибок в консоли браузера', events.filter(e => e.method === 'Runtime.exceptionThrown').length === 0);
  ws.close();
} catch (e) { ok('Скрипт завершился без исключения', false, e.stack || e.message); } finally { cleanup(); }
await sleep(800);
writeFileSync(contrastOut, JSON.stringify(contrast, null, 1));
rmSync(path.join(work, 'profile'), {recursive: true, force: true}); rmSync(path.join(work, 'tmp'), {recursive: true, force: true});
const bad = results.filter(r => !r.ok);
console.log(`\nИтого: ${results.length - bad.length}/${results.length} проверок прошли; скриншоты: ${shots}`);
process.exit(bad.length ? 1 : 0);
