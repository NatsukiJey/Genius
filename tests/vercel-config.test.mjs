// vercel.json + настоящая сборка Vite: эмулятор маршрутизации Vercel (сначала файлы из dist, затем rewrites по порядку)
// отдаёт приложение на /login, /register и любых глубоких ссылках, аудио и assets не подменяются, /api/* уходит в функцию.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, statSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createVercelHandler} from '../server/vercel.mjs';
import {CSP} from '../server/app.mjs';
import {pgliteDriver} from './pg-helpers.mjs';
import {migratePg} from '../server/migrate-pg.mjs';
import {Jar, PW, uniqueName} from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..'), DIST = path.join(here, '.data', 'dist-vercel');
const vj = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8')), pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const AUDIO = ['background.mp3', 'click.wav', 'correct.wav', 'lose.wav', 'select.wav', 'win.wav'];
const sha = f => crypto.createHash('sha256').update(readFileSync(f)).digest('hex');

test('vercel.json: Vite framework, npm run build -> dist, API rewrite before the SPA fallback, same security headers as the server', () => {
  assert.equal(vj.framework, 'vite'); assert.equal(vj.buildCommand, 'npm run build'); assert.equal(vj.outputDirectory, 'dist'); assert.equal(vj.installCommand, 'npm ci');
  assert.equal(pkg.scripts.build, 'vite build');
  assert.match(readFileSync(path.join(root, 'vite.config.js'), 'utf8'), /outDir: '\.\.\/dist'/, 'vite builds into <repo>/dist');
  const [api, spa, ...rest] = vj.rewrites; assert.equal(rest.length, 0);
  assert.deepEqual(api, {source: '/api/(.*)', destination: '/api/index'}); assert.equal(spa.destination, '/index.html'); assert.match(spa.source, /\(\?!api\(\?:\/\|\$\)\|assets\/\|audio\//);
  assert.equal(vj.routes, undefined, 'rewrites and routes are never mixed');
  assert.ok(existsSync(path.join(root, 'api', 'index.mjs')) && !existsSync(path.join(root, 'index.html')), 'root has no index.html: Vercel must serve the BUILD, not the sources');
  const all = vj.headers.find(h => h.source === '/(.*)').headers, hv = k => all.find(h => h.key === k).value;
  assert.equal(hv('Content-Security-Policy'), CSP); assert.equal(hv('X-Content-Type-Options'), 'nosniff'); assert.equal(hv('Referrer-Policy'), 'same-origin');
  assert.equal(pkg.engines.node, '26.x'); assert.ok(pkg.dependencies.pg, 'pg is a production dependency'); assert.ok(!pkg.dependencies['@electric-sql/pglite'], 'pglite is test-only');
  assert.match(readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\.vercel$/m);
});

test('Vercel routing emulation over the REAL build: deep links -> app, assets/audio untouched (bytes equal the originals), /api -> function', async () => {
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', DIST, '--emptyOutDir'], {cwd: root, stdio: 'pipe'});
  for (const f of AUDIO) assert.equal(sha(path.join(DIST, 'audio', f)), sha(path.join(root, 'client', 'public', 'audio', f)), 'audio unchanged: ' + f);
  assert.equal(readdirSync(path.join(DIST, 'audio')).length, 6, 'six audio controls assets, nothing added');
  const driver = await pgliteDriver(); await migratePg(driver);
  let handler;
  const rewrites = vj.rewrites.map(r => ({re: new RegExp('^' + r.source + '$'), dest: r.destination}));
  const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'};
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname, file = path.join(DIST, p === '/' ? 'index.html' : p);
    const serve = f => { res.writeHead(200, {'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream'}); res.end(readFileSync(f)); };
    if (p === '/api' || p === '/api/index') return handler(req, res);                                              // api/index.mjs как файл-функция
    if (file.startsWith(DIST + path.sep) && existsSync(file) && statSync(file).isFile()) return serve(file);     // 1) файловая система
    const hit = rewrites.find(r => r.re.test(p));                                                                  // 2) rewrites по порядку
    if (hit) return hit.dest === '/api/index' ? handler(req, res) : serve(path.join(DIST, 'index.html'));
    res.writeHead(404); res.end('Not found');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const host = `127.0.0.1:${server.address().port}`, base = 'http://' + host;
  handler = createVercelHandler({env: {VERCEL_URL: host, VERCEL_ENV: 'development', DATABASE_URL: 'postgres://placeholder.invalid/x'}, createDriver: async () => driver, scrypt: {N: 1024}, log: () => {}});
  try {
    const html = await (await fetch(base + '/')).text(); assert.match(html, /<div id="root"><p class="static-boot">/);
    for (const p of ['/', '/login', '/register', '/login/', '/some/deep/link', '/learn?x=1']) { const r = await fetch(base + p), t = await r.text(); assert.equal(r.status, 200, p); assert.equal(t, html, 'SPA index for ' + p); assert.doesNotMatch(t, /npm install|npm run|<h1/, 'not a README'); }
    const js = html.match(/src="(\/assets\/[^"]+\.js)"/)[1], css = html.match(/href="(\/assets\/[^"]+\.css)"/)[1];
    assert.equal((await fetch(base + js)).status, 200); assert.equal((await fetch(base + css)).status, 200);
    for (const p of ['/assets/missing.js', '/assets/', '/audio/nope.wav', '/audio/', '/api']) { const r = await fetch(base + p); assert.notEqual(r.status === 200 && (await r.clone().text()) === html, true, p + ' must not fall back to index.html'); }
    for (const f of AUDIO) { const r = await fetch(base + '/audio/' + f); assert.equal(r.status, 200, f); assert.match(r.headers.get('content-type'), /^audio\//); assert.equal(crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'), sha(path.join(root, 'client', 'public', 'audio', f))); }
    assert.equal((await fetch(base + '/api/me')).status, 401); assert.deepEqual(await (await fetch(base + '/api/auth/providers')).json(), {google: {enabled: false}});
    const jar = new Jar({base, origin: base}), name = uniqueName('vc');
    assert.equal((await jar.post('/api/register', {username: name, password: PW})).status, 200);
    assert.equal((await jar.get('/api/me')).data.user.username, name, 'same-origin cookie session through the function');
    // клиент: глубокие ссылки /login и /register обрабатывает React (tests/ui/*), а Vercel отдаёт им index.html (см. выше)
    assert.match(readFileSync(path.join(root, 'client', 'src', 'hooks', 'usePath.js'), 'utf8'), /location\.pathname/);
  } finally { await new Promise(r => { server.close(r); server.closeAllConnections(); }); await handler.close(); }
});
