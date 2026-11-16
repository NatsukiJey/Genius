// Ручная проверка настоящей сборки dist/ в настоящем браузере (headless Chromium по CDP). НЕ входит в npm run check.
// Запуск: node tests/browser-e2e.mjs   (нужны собранный dist/ и /usr/sbin/chromium)
// Всё изолировано: свой сервер на 127.0.0.1:4187, своя БД и профиль браузера в tests/.data/e2e (в .gitignore).
// Создаётся ОДИН одноразовый аккаунт; пароль случайный и нигде не печатается.
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import {mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {COURSES, TYPE_SPECS, promptOf, answerOf} from '../shared/data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, 'tests', '.data', 'e2e');
rmSync(work, {recursive: true, force: true}); // только наша собственная рабочая папка
for (const d of ['profile', 'tmp']) mkdirSync(path.join(work, d), {recursive: true});
const PORT = 4187, CDP = 9334, base = `http://127.0.0.1:${PORT}`;
const results = [];
const ok = (name, cond, info = '') => { results.push({name, ok: !!cond}); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = spawn(process.execPath, ['server.mjs'], {cwd: root, stdio: 'ignore',
  env: {...process.env, NODE_ENV: 'production', PORT, HOST: '127.0.0.1', DB_PATH: path.join(work, 'e2e.db'), TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', ALLOWED_HOSTS: ''}});
const chrome = spawn('/usr/sbin/chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(work, 'profile')}`, 'about:blank'], {stdio: 'ignore', env: {...process.env, TMPDIR: path.join(work, 'tmp')}});
const cleanup = () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} };
process.on('exit', cleanup);

async function until(fn, ms = 10000, step = 100) { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t > ms) return null; await sleep(step); } }

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
  const goto = async url => { await send('Page.navigate', {url}); await sleep(200); await waitFor(`document.readyState==='complete'`); };
  const click = sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('нет ${sel}'); e.click(); return true})()`);
  const text = sel => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`);
  const fill = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(e,${JSON.stringify(v)}); e.dispatchEvent(new Event('input',{bubbles:true})); return true})()`);
  const overflow = () => ev(`({sw:document.documentElement.scrollWidth, iw:innerWidth, bw:document.body.scrollWidth})`);
  const consoleErrors = () => events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));

  // 1. SPA /login и /register
  await goto(base + '/login');
  ok('SPA /login: форма входа', await waitFor(`document.querySelector('#login-form')`));
  await goto(base + '/register');
  ok('SPA /register: форма регистрации', await waitFor(`document.querySelector('#register-form')`));
  ok('Страница без inline-скриптов (в DOM нет <script> без src)', await ev(`![...document.scripts].some(s=>!s.src)`));

  // 2. Регистрация одноразового аккаунта через форму
  const username = 'e2e' + crypto.randomBytes(4).toString('hex'), password = crypto.randomBytes(15).toString('base64url');
  await fill('#reg-username', username); await fill('#reg-password', password); await click('#register-form button[type=submit]');
  const chooser = await waitFor(`document.querySelector('[role=dialog] [data-course="ru"]')`, 15000);
  ok('Новый аккаунт: окно выбора курса (en + ru)', chooser && await ev(`!!document.querySelector('[role=dialog] [data-course="en"]') && location.pathname==='/'`));
  ok('Окно выбора курса нельзя закрыть', await ev(`!document.querySelector('[role=dialog] [data-action="close"]')`));

  // 3. Русский, уровень A1
  await ev(`document.querySelector('[role=dialog] [data-course="ru"]').click()`);
  await waitFor(`document.querySelector('[role=dialog] [data-tier="1"]')`);
  const tierText = await text('[role=dialog]');
  ok('Выбор уровня русского: A1–B2 и честная пометка (не TORFL)', /A1/.test(tierText) && /B2/.test(tierText) && /TORFL/.test(tierText) && /Rus tili/.test(tierText));
  await click('[role=dialog] [data-tier="1"]');
  ok('Карта уровней русского: 50 уровней, Привет!', await waitFor(`!document.querySelector('[role=dialog]') && document.querySelectorAll('.map .level').length===50`) && /Привет/.test(await text('main')));

  // 4. Урок: вопрос + ответ на сервере + награда
  const answers = []; // ответы сервера
  const startedAt = events.length;
  await click('[data-level="1"]');
  await waitFor(`document.querySelector('[data-action="quiz"]')`);
  ok('Окно урока: знакомство со словами', await ev(`document.querySelectorAll('.word-card').length===5`));
  await click('[data-action="quiz"]');
  ok('Вопрос урока отображается (инструкция, слово, кнопка проверки)', await waitFor(`document.querySelector('.question-word') && document.querySelector('[data-action="check"]')`));
  // карта «подсказка → ответ» для русского курса строится из тех же данных, что и сервер
  const map = new Map();
  for (const type of Object.keys(TYPE_SPECS)) for (const w of COURSES.ru.words.flat()) { const k = promptOf(type, w); if (!map.has(k)) map.set(k, new Set()); map.get(k).add(answerOf(type, w)); }
  const mapObj = Object.fromEntries([...map].map(([k, v]) => [k, [...v]]));
  let correctSeen = 0, feedbackSeen = 0;
  for (let n = 0; n < 5; n++) {
    await waitFor(`document.querySelector('[data-action="check"]')`);
    const kind = await ev(`document.querySelector('#answer')?'write':document.querySelector('.tiles')?'tiles':'choice'`);
    const prompt = await text('.question-word'); const want = mapObj[prompt] || [];
    if (kind === 'choice') {
      const idx = await ev(`(()=>{const w=${JSON.stringify(want)}; return [...document.querySelectorAll('.choice')].findIndex(b=>w.includes(b.innerText.replace(/^\\d+\\s*/,'').trim()))})()`);
      await click(`[data-choice="${Math.max(idx, 0)}"]`);
    } else if (kind === 'write') await fill('#answer', want[0] || '');
    else for (const ch of [...(want[0] || '')]) await ev(`(()=>{const b=[...document.querySelectorAll('.tiles button:not(:disabled)')].find(b=>b.innerText.replace('␣',' ')===${JSON.stringify(ch)}); if(b) b.click(); return true})()`);
    await click('[data-action="check"]');
    await waitFor(`document.querySelector('#answer-feedback.good, #answer-feedback.bad')`);
    const cls = await ev(`document.querySelector('#answer-feedback').className`);
    feedbackSeen++; if (/good/.test(cls)) correctSeen++;
    await click('[data-action="next"]');
    await sleep(150);
  }
  const resultShown = await waitFor(`document.querySelector('[data-action="done"]')`, 10000);
  const answerReqs = events.slice(startedAt).filter(e => e.method === 'Network.responseReceived' && /\/api\/lesson\/answer/.test(e.params.response.url));
  ok('Каждый ответ проверен сервером (POST /api/lesson/answer → 200)', answerReqs.length === 5 && answerReqs.every(e => e.params.response.status === 200), `ответов: ${answerReqs.length}`);
  ok('Все 5 ответов верны (верные ответы построены из данных курса)', correctSeen === 5, `верных ${correctSeen}/${feedbackSeen}`);
  const resText = await text('.result');
  ok('Награда от сервера: экран результата «+N tanga»', resultShown && /5\/5/.test(resText) && /\+\d+ tanga/.test(resText), (resText || '').replace(/\s+/g, ' ').slice(0, 120));
  await click('[data-action="done"]');
  await waitFor(`!document.querySelector('.result')`);
  const coins = await ev(`Number(document.querySelector('[data-stat="coins"]')?.textContent)`);
  ok('Монеты в шапке выросли после награды', coins > 0, `coins=${coins}`);
  ok('Уровень 1 пройден, уровень 2 открыт', await ev(`document.querySelectorAll('.level.finished').length===1 && document.querySelector('.level.current')?.dataset.level==='2'`));

  // 5. Панель звука
  const sbtn = '[data-action="sound-toggle"]';
  await click(sbtn);
  ok('Панель звука открывается (aria-expanded=true, панель видна)', await waitFor(`document.querySelector('${sbtn}').getAttribute('aria-expanded')==='true' && (()=>{const p=document.querySelector('[id^=sound-panel]'); const r=p.getBoundingClientRect(); return !p.hidden && r.width>100 && r.height>100 && r.left>=0 && r.right<=innerWidth+1})()`));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(200);
  const closedByEsc = await ev(`document.querySelector('${sbtn}').getAttribute('aria-expanded')==='false'`);
  if (!closedByEsc) await click(sbtn);
  ok('Панель звука закрывается', await waitFor(`document.querySelector('${sbtn}').getAttribute('aria-expanded')==='false'`), closedByEsc ? 'по Esc' : 'по кнопке');

  // 6. Адаптивность: нет горизонтальной прокрутки
  for (const [w, h] of [[320, 640], [375, 812], [768, 1024], [1280, 800]]) {
    await send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: w < 700});
    await sleep(300);
    const o = await overflow();
    ok(`Нет горизонтального переполнения (/ при ${w}px)`, o.sw <= o.iw && o.bw <= o.iw, `scrollWidth=${o.sw}, окно=${o.iw}`);
  }
  await send('Emulation.setDeviceMetricsOverride', {width: 375, height: 812, deviceScaleFactor: 1, mobile: true});
  await click('[data-level="2"]'); await waitFor(`document.querySelector('[data-action="quiz"]')`);
  { const o = await overflow(); ok('Нет горизонтального переполнения в окне урока (375px)', o.sw <= o.iw, `scrollWidth=${o.sw}`); }
  await click('[data-action="exit"]'); await sleep(300);
  await waitFor(`document.querySelector('[role=dialog]') || document.querySelector('.level.current')`);
  await ev(`(()=>{const d=document.querySelector('[role=dialog]'); const b=d&&[...d.querySelectorAll('button')].find(b=>/chiq|ha|Ha/i.test(b.innerText)); if(b) b.click(); return true})()`);
  await sleep(500);
  await goto(base + '/login');
  { const o = await overflow(); ok('Нет горизонтального переполнения на /login при 375px (залогиненного уводит на /)', o.sw <= o.iw, `scrollWidth=${o.sw}`); }
  await goto(base + '/');
  await send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 800, deviceScaleFactor: 1, mobile: false});
  await waitFor(`document.querySelectorAll('.map .level').length===50`);

  // 7. Офлайн / повторная попытка
  await send('Network.emulateNetworkConditions', {offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
  await ev(`window.dispatchEvent(new Event('focus'))`);
  await ev(`document.querySelector('[data-course="en"]').click()`);
  const bannerShown = await waitFor(`!document.querySelector('#banner').hidden && /aloqa yo/.test(document.querySelector('#banner').innerText)`, 8000);
  ok('Офлайн: показан баннер «Server bilan aloqa yo‘q»', bannerShown);
  const retryBtn = await ev(`!!document.querySelector('[data-action="retry-net"]')`);
  ok('Офлайн: есть кнопка «Qayta urinish»', retryBtn);
  await send('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
  if (retryBtn) await click('[data-action="retry-net"]');
  ok('Онлайн + повтор: баннер исчез', await waitFor(`document.querySelector('#banner').hidden`, 8000));

  // 8. Смена курса (русский ↔ английский)
  const act = () => ev(`document.querySelector('.course-btn[aria-pressed="true"]')?.dataset.course`);
  const before = await act();
  const other = before === 'ru' ? 'en' : 'ru';
  await click(`.course-btn[data-course="${other}"]`);
  await waitFor(`document.querySelector('[role=dialog] [data-tier]') || document.querySelector('.course-btn[data-course="${other}"][aria-pressed="true"]')`, 8000);
  if (await ev(`!!document.querySelector('[role=dialog] [data-tier="0"]')`)) await click('[role=dialog] [data-tier="0"]'); // у нового курса уровня ещё нет
  await waitFor(`!document.querySelector('[role=dialog]')`, 8000);
  ok(`Курс переключён ${before} → ${other}`, (await act()) === other && /Ingliz tilini yodlama/.test(await text('main')) === (other === 'en'));
  await click(`.course-btn[data-course="ru"]`);
  await waitFor(`document.querySelector('.course-btn[data-course="ru"][aria-pressed="true"]')`);
  ok('Возврат на русский: прогресс русского сохранён (1 пройденный уровень), английский отдельно', await ev(`document.querySelectorAll('.level.finished').length===1`));
  ok('Нет ошибок в консоли браузера', consoleErrors().length === 0, `ошибок: ${consoleErrors().length}`);

  // 9. Выход
  await ws.close();
} catch (e) {
  ok('Скрипт завершился без исключения', false, e.message);
} finally {
  cleanup();
}
await sleep(1000); // даём Chromium закрыться, потом убираем СВОЮ рабочую папку (профиль с битыми симлинками ломает обход tests/.data в static.test)
rmSync(work, {recursive: true, force: true});
const bad = results.filter(r => !r.ok);
console.log(`\nИтого: ${results.length - bad.length}/${results.length} проверок прошли`);
process.exit(bad.length ? 1 : 0);
