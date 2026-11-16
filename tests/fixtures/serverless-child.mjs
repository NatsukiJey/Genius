// Запускается дочерним процессом С ЗАПРЕТОМ ЗАПИСИ НА ДИСК (node --permission без --allow-fs-write).
// Проходит настоящий сценарий через серверную функцию Vercel + PGlite; любая попытка записи упадёт с ERR_ACCESS_DENIED.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root = process.argv[2], at = rel => pathToFileURL(path.join(root, rel)).href;
const {bootPg} = await import(at('tests/pg-env.mjs'));
const {signup, finishLevel, Jar, PW} = await import(at('tests/helpers.mjs'));
const env = await bootPg();
try {
  const {jar, name} = await signup(env);
  const done = await finishLevel(jar, 1);
  const out = await new Jar(env).post('/api/login', {username: name, password: PW}, {headers: {'x-real-ip': '192.0.2.77'}});
  const meRes = await jar.get('/api/me');
  console.log(JSON.stringify({outcome: done.data.result.outcome, login: out.status, me: meRes.status, coins: meRes.data.state.coins}));
} finally { await env.close(); }
