// Фикстура для проверки в браузере. Запуск (сервер уже работает):
//   BASE_URL=http://127.0.0.1:4186 node tests/browser-fixture.mjs
// Создаёт ОДИН одноразовый аккаунт со случайным паролем, входит вторым «cookie jar» и пишет
// tests/.data/browser-session.json (режим 0600): только base, username, cookie1, cookie2.
// Пароль и cookie никуда не печатаются; в браузере пароль вводить не нужно — cookie подставляются вручную.
import crypto from 'node:crypto';
import {mkdirSync, writeFileSync, chmodSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const base = (process.env.BASE_URL || 'http://127.0.0.1:4186').replace(/\/+$/, '');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '.data', 'browser-session.json');

async function post(route, body) {
  const res = await fetch(base + route, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: base}, body: JSON.stringify(body)});
  const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => c.includes('=') && !c.endsWith('=')).join('; ');
  return {status: res.status, cookie};
}

const password = crypto.randomBytes(18).toString('base64url');
let username, reg;
for (let i = 0; i < 5; i++) { // на случай редкой коллизии ника/фильтра
  username = 'fx' + crypto.randomBytes(5).toString('hex');
  reg = await post('/api/register', {username, password});
  if (reg.status === 200) break;
}
if (reg.status !== 200 || !reg.cookie) { console.error('register failed, status ' + reg.status); process.exit(1); }
const login = await post('/api/login', {username, password});
if (login.status !== 200 || !login.cookie) { console.error('login failed, status ' + login.status); process.exit(1); }

mkdirSync(path.dirname(out), {recursive: true});
writeFileSync(out, JSON.stringify({base, username, cookie1: reg.cookie, cookie2: login.cookie}, null, 2), {mode: 0o600});
chmodSync(out, 0o600);
console.log('username: ' + username);
console.log('file: ' + out);
