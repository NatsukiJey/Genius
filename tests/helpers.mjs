import http from 'node:http';
import {existsSync, mkdirSync, writeFileSync, renameSync, symlinkSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from '../server.mjs';
import {courseQuestions, answerOf} from '../shared/data.mjs';

// Маленькая «сборка» для тестов сервера: index.html + assets + audio (ссылка на настоящие звуки клиента).
// Файлы пишем атомарно (tmp + rename): тесты идут в разных процессах и могут стартовать одновременно.
const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_ASSET_JS = 'app-test1234.js', FIXTURE_ASSET_CSS = 'app-test1234.css';
export function fixtureDist() {
  const dir = path.join(here, '.data', 'dist-fixture'), put = (rel, text) => {
    const f = path.join(dir, rel); if (existsSync(f)) return;
    mkdirSync(path.dirname(f), {recursive: true}); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, text); renameSync(tmp, f);
  };
  put('index.html', `<!doctype html><html lang="uz"><head><meta charset="utf-8"><title>Jenius test</title><link rel="stylesheet" href="/assets/${FIXTURE_ASSET_CSS}"></head><body><div id="root"></div><script type="module" src="/assets/${FIXTURE_ASSET_JS}"></script></body></html>`);
  put(`assets/${FIXTURE_ASSET_JS}`, 'console.log("jenius test bundle");\n');
  put(`assets/${FIXTURE_ASSET_CSS}`, 'body{margin:0}\n');
  put('assets/notes.txt', 'not an allowed asset type');
  try { symlinkSync(path.join(here, '..', 'client', 'public', 'audio'), path.join(dir, 'audio')); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  return dir;
}

export const T0 = new Date(2026, 10, 10, 12, 0, 0).getTime();
export async function boot(opts = {}) {
  const clock = {t: T0};
  const app = createServer({dbPath: ':memory:', distDir: fixtureDist(), now: () => clock.t, scrypt: {N: 1024}, log: () => {}, limits: {registerIp: 100000, loginPair: 5, loginIp: 100000}, ...opts});
  const port = await app.listen(0, '127.0.0.1');
  return {app, clock, port, base: `http://127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`};
}
// Мини «cookie jar» поверх fetch. Origin ставим вручную.
export class Jar {
  constructor(env) { this.env = env; this.cookies = new Map(); }
  get header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(method, path, body, {headers = {}, origin = this.env.origin, raw, contentType = 'application/json'} = {}) {
    const h = {...headers};
    if (origin) h.Origin = origin;
    if (this.header) h.Cookie = this.header;
    if (body !== undefined) h['Content-Type'] = contentType;
    const res = await fetch(this.env.base + path, {method, headers: h, body: body === undefined ? undefined : (raw ? body : JSON.stringify(body))});
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';'), i = pair.indexOf('='), name = pair.slice(0, i), val = pair.slice(i + 1);
      if (!val || /Max-Age=0/i.test(c)) this.cookies.delete(name); else this.cookies.set(name, val);
    }
    let data = null; try { data = await res.json(); } catch {}
    return {status: res.status, data, headers: res.headers};
  }
  post(path, body, o) { return this.req('POST', path, body, o); }
  get(path, o) { return this.req('GET', path, undefined, o); }
}
let n = 0;
export const uniqueName = (p = 'user') => `${p}${Date.now().toString(36)}${(n++).toString(36)}`.slice(0, 20);
export const PW = 'correct-horse-9';
// Новый аккаунт обязан выбрать курс. По умолчанию помощник выбирает английский (как у всех старых тестов);
// signup(env, name, extra, {course:null}) оставляет аккаунт без курса, {course:'ru'} выбирает русский.
export async function signup(env, name = uniqueName(), extra = {}, {course = 'en'} = {}) {
  const jar = new Jar(env);
  const r = await jar.post('/api/register', {username: name, password: PW, ...extra});
  if (r.status !== 200) throw new Error('register failed ' + r.status + ' ' + JSON.stringify(r.data));
  if (course && r.data.state.activeCourse !== course) {
    const c = await jar.post('/api/course', {course});
    if (c.status !== 200) throw new Error('course failed ' + c.status + ' ' + JSON.stringify(c.data));
  }
  return {jar, name, res: r};
}
export const correctGiven = (lesson, idx) => { const q = courseQuestions(lesson.course ?? 'en', lesson.tier, lesson.level, lesson.exam)[idx]; return answerOf(q.type, q.word); };
// Неверный ответ для выбора/сборки/ввода
export const wrongGiven = () => 'zzzzzz-wrong';
export async function startLevel(jar, level, tier = 0, exam = false) { return jar.post('/api/lesson/start', {tier, level, exam}); }
// Проходит урок: wrongAt = множество индексов, где отвечаем неверно
export async function playLesson(jar, lesson, wrongAt = new Set()) {
  let last;
  for (let i = lesson.index; i < lesson.total; i++) {
    last = await jar.post('/api/lesson/answer', {lessonId: lesson.id, index: i, given: wrongAt.has(i) ? wrongGiven() : correctGiven(lesson, i)});
    if (last.status !== 200 || last.data.result.outcome !== 'continue') break;
  }
  return last;
}
export async function finishLevel(jar, level, tier = 0) {
  const s = await startLevel(jar, level, tier);
  if (s.status !== 200) throw new Error('start ' + level + ' ' + s.status + JSON.stringify(s.data));
  return playLesson(jar, s.data.lesson);
}
// fn получает «плоский» вид: общий кошелёк + поля курса (tier/completed/passed/retryAt) выбранного курса (по умолчанию en).
// После fn изменения записываются обратно: поля курса -> courses[course], остальное -> общий кошелёк.
export function patchState(env, name, fn, course = 'en') {
  const row = env.app.db.prepare('SELECT p.state,u.id FROM progress p JOIN users u ON u.id=p.user_id WHERE u.username_key=?').get(name.toLowerCase());
  const stored = JSON.parse(row.state), F = ['tier', 'completed', 'passed', 'retryAt'];
  const flat = {...stored, ...Object.fromEntries(F.map(k => [k, stored.courses[course][k]]))};
  fn(flat);
  const s = {...flat}; s.courses = stored.courses; for (const k of F) { s.courses[course][k] = flat[k]; delete s[k]; }
  env.app.db.prepare('UPDATE progress SET state=?,rev=rev+1 WHERE user_id=?').run(JSON.stringify(s), row.id);
}
export function rawRequest(env, {method = 'GET', path = '/', headers = {}, body}) {
  return new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port: env.port, method, path, headers, setHost: false}, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({status: res.statusCode, body: d, headers: res.headers}));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
