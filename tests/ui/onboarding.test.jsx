// Порт старого client-courses.test.mjs на настоящий React: выбор курса, уровень, переключатель, смена курса, устаревшее окно.
import {test, expect} from 'vitest';
import {completeLevel} from '../../shared/engine.mjs';
import {PRACTICE_NOTE} from '../../shared/data.mjs';
import {fakeServer, renderApp, screen, waitFor, within, payload, lessonOf, stateWith, freshState, modal, dialog, textOf, ready} from './support.jsx';

test('new account sees the course chooser first and cannot dismiss it', async () => {
  const st = freshState(); fakeServer({'GET /api/me': () => ({data: payload(st)})});
  renderApp(); await ready();
  const d = await screen.findByRole('dialog', {name: /Qaysi tilni o‘rganamiz/});
  expect(textOf(d)).toMatch(/Ingliz tili/); expect(textOf(d)).toMatch(/Rus tili/);
  expect(d.querySelector('[data-course="en"]')).toBeTruthy(); expect(d.querySelector('[data-course="ru"]')).toBeTruthy();
  expect(d.getAttribute('aria-modal')).toBe('true');
  expect(d.querySelector('[data-action="close"]')).toBeNull();           // нельзя закрыть, пока курс не выбран
  expect(document.querySelector('.course-switch')).toBeTruthy();
  expect(document.activeElement).toBe(d.querySelector('button'));         // фокус сразу внутри диалога
});

test('choosing Russian posts /api/course, then asks for the tier A1–B2 with the honest practice note; picks tier for that course', async () => {
  const st = freshState();
  const srv = fakeServer({
    'GET /api/me': () => ({data: payload(st)}),
    'POST /api/course': b => { st.activeCourse = b.course; return {data: payload(st)}; },
    'POST /api/tier': b => { st.courses[b.course].tier = b.tier; return {data: payload(st)}; }
  });
  const {user} = renderApp(); await screen.findByRole('dialog');
  await user.click(modal().querySelector('[data-course="ru"]'));
  expect(srv.of('POST', '/api/course').at(-1).body).toEqual({course: 'ru'});
  const tiers = await screen.findByRole('dialog', {name: /Qayerdan boshlaymiz/});
  expect(textOf(tiers)).toMatch(/Rus tili: darajangizni tanlang/);
  for (const n of ['A1', 'A2', 'B1', 'B2']) expect(within(tiers).getByText(n, {selector: 'strong'})).toBeTruthy();
  expect(textOf(tiers)).toContain(PRACTICE_NOTE); expect(textOf(tiers)).toMatch(/rasmiy sertifikat yoki imtihon \(TORFL\) emas/);
  expect(document.querySelector('[data-course="ru"].course-btn').getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('[data-course="en"].course-btn').getAttribute('aria-pressed')).toBe('false');
  expect(tiers.querySelector('[data-tier="1"]').getAttribute('data-tier-course')).toBe('ru');
  await user.click(tiers.querySelector('[data-tier="1"]'));
  expect(srv.of('POST', '/api/tier').at(-1).body).toEqual({tier: 1, course: 'ru'});
  await waitFor(() => expect(dialog()).toBeNull());
});

test('learn page of the Russian course: course texts, chapter, practice note; the other course progress is not shown', async () => {
  const st = freshState(); st.activeCourse = 'ru'; st.courses.ru.tier = 1; completeLevel(st, 'ru', 1, 1); completeLevel(st, 'en', 0, 1);
  fakeServer({'GET /api/me': () => ({data: payload(st)})});
  renderApp(); await ready();
  const main = document.querySelector('main'), t = textOf(main);
  expect(t).toMatch(/Rus tilini yodlama/); expect(t).toContain('Привет!'); expect(t).toMatch(/KUNDALIK HAYOT · 50 LEVEL|A2 · 50 LEVEL/i); expect(t).toMatch(/1\/50/);
  expect(t).toMatch(/Kundalik hayot/); expect(main.querySelector('.practice-note')).toBeTruthy(); expect(t).toMatch(/TORFL/);
  expect(main.querySelectorAll('.level.finished')).toHaveLength(1);
  expect(main.querySelector('.level.current').getAttribute('data-level')).toBe('2');
  expect(main.querySelector('[data-level="3"]').disabled).toBe(true);
  expect(main.querySelector('.hero-art .label-a').getAttribute('lang')).toBe('ru');
  expect(dialog()).toBeNull();
});

test('English learn page of the same component: English texts and no practice note', async () => {
  const st = stateWith('en', 0); fakeServer({'GET /api/me': () => ({data: payload(st)})});
  renderApp(); await ready();
  const t = textOf(document.querySelector('main'));
  expect(t).toMatch(/Ingliz tilini yodlama/); expect(t).toContain('Hello!'); expect(document.querySelector('.practice-note')).toBeNull(); expect(t).toMatch(/0\/50/);
  expect(document.querySelectorAll('.map .level')).toHaveLength(50);
});

test('tier selector button reopens the tier dialog, which can be closed because a tier is already chosen', async () => {
  const st = stateWith('en', 0); fakeServer({'GET /api/me': () => ({data: payload(st)})});
  const {user} = renderApp(); await ready();
  await user.click(screen.getByRole('button', {name: /Beginner/}));
  const d = await screen.findByRole('dialog', {name: /Qayerdan boshlaymiz/});
  expect(textOf(d)).toMatch(/Ingliz tili: darajangizni tanlang/); expect(d.querySelector('[data-action="close"]')).toBeTruthy();
  await user.click(d.querySelector('[data-action="close"]')); expect(dialog()).toBeNull();
});

test('no tier chosen yet: the tier dialog opens on boot and cannot be dismissed', async () => {
  const st = stateWith('ru', null); fakeServer({'GET /api/me': () => ({data: payload(st)})});
  renderApp(); const d = await screen.findByRole('dialog', {name: /Qayerdan boshlaymiz/});
  expect(textOf(d)).toMatch(/Rus tili/); expect(d.querySelector('[data-action="close"]')).toBeNull();
});

test('header switch: same course just closes; switching without a lesson calls the API directly; with a lesson it asks to confirm first', async () => {
  const st = stateWith('en', 0), lesson = {current: null};
  const srv = fakeServer({
    'GET /api/me': () => ({data: payload(st, lesson.current)}),
    'POST /api/course': b => { st.activeCourse = b.course; st.courses[b.course].tier ??= 0; lesson.current = null; return {data: {...payload(st), abandoned: {cooldown: true}}}; }
  });
  const {user} = renderApp(); await ready();
  await user.click(screen.getByRole('button', {name: 'Ingliz tili (tanlangan)'})); expect(srv.of('POST', '/api/course')).toHaveLength(0);
  lesson.current = lessonOf({course: 'en', level: 3, exam: true, phase: 'quiz', index: 1}); st.courses.en.tier = 0;
  // обновление, чтобы клиент узнал про урок (возврат на вкладку)
  window.dispatchEvent(new Event('focus')); await waitFor(() => expect(srv.of('GET', '/api/me').length).toBeGreaterThan(1));
  await user.click(screen.getByRole('button', {name: 'Rus tili'}));
  const c = await screen.findByRole('dialog', {name: /Rus tili.*ga o‘tamizmi/});
  expect(textOf(c)).toMatch(/5 daqiqa kutish jazosi/); expect(srv.of('POST', '/api/course')).toHaveLength(0);
  await user.click(within(c).getByRole('button', {name: 'Yo‘q, qolaman'})); expect(dialog()).toBeNull();
  await user.click(screen.getByRole('button', {name: 'Rus tili'})); await user.click(within(await screen.findByRole('dialog')).getByRole('button', {name: 'Ha, o‘tish'}));
  expect(srv.of('POST', '/api/course').at(-1).body).toEqual({course: 'ru'});
  expect(await screen.findByText(/Yakuniy test uchun 5 daqiqa kutish eski kursga yozildi/)).toBeTruthy();
  expect(document.querySelector('[data-course="ru"].course-btn').getAttribute('aria-pressed')).toBe('true');
});

test('stale tier dialog: the request carries its original course; 409 saves nothing and reopens the chooser for the current course', async () => {
  const s3 = stateWith('ru', null); s3.courses.en.tier = null;
  const srv = fakeServer({
    'GET /api/me': () => ({data: payload(s3)}),
    'POST /api/tier': b => b.course !== s3.activeCourse ? {status: 409, data: {error: 'course_mismatch', ...payload(s3)}} : {data: payload(s3)}
  });
  const {user} = renderApp(); const d = await screen.findByRole('dialog', {name: /Qayerdan boshlaymiz/});
  expect(textOf(d)).toMatch(/Rus tili: darajangizni tanlang/); expect(d.querySelector('[data-tier="2"]').getAttribute('data-tier-course')).toBe('ru');
  s3.activeCourse = 'en';                                              // в другой вкладке курс сменили
  await user.click(d.querySelector('[data-tier="2"]'));
  expect(srv.of('POST', '/api/tier')).toHaveLength(1); expect(srv.of('POST', '/api/tier')[0].body).toEqual({tier: 2, course: 'ru'});
  expect(s3.courses.en.tier).toBeNull(); expect(s3.courses.ru.tier).toBeNull();
  const again = await screen.findByRole('dialog', {name: /Qayerdan boshlaymiz/});
  expect(textOf(again)).toMatch(/Ingliz tili: darajangizni tanlang/); expect(again.querySelector('[data-tier="0"]').getAttribute('data-tier-course')).toBe('en');
  expect(await screen.findByText(/Kurs boshqa joyda o‘zgargan/)).toBeTruthy();
});
