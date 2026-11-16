// Статика и безопасность React-сборки: сервер отдаёт ТОЛЬКО dist (из реальной сборки Vite), без legacy и без утечек.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {boot, rawRequest} from './helpers.mjs';
import {clientFiles, readClientSource, readRoot, walk} from './clientSrc.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');
const BUILD = path.join(here, '.data', 'dist-build');
let built; // сборка делается один раз на файл
function build() {
  if (built) return built;
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', BUILD, '--emptyOutDir'], {cwd: root, stdio: 'pipe'});
  const html = readFileSync(path.join(BUILD, 'index.html'), 'utf8');
  return built = {html, js: html.match(/src="(\/assets\/[^"]+\.js)"/)[1], css: html.match(/href="(\/assets\/[^"]+\.css)"/)[1]};
}

test('real Vite build: index.html has no inline script/style/handlers; one JS + one CSS asset; audio copied', () => {
  const {html, js, css} = build();
  assert.match(html, /<html lang="uz"/); assert.match(html, /<div id="root"><\/div>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'no inline <script>');
  assert.doesNotMatch(html, /<style/i); assert.doesNotMatch(html, /\sstyle\s*=/i); assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.match(js, /^\/assets\/[\w.-]+\.js$/); assert.match(css, /^\/assets\/[\w.-]+\.css$/);
  for (const f of ['background.mp3', 'click.wav', 'correct.wav', 'lose.wav', 'select.wav', 'win.wav']) assert.ok(existsSync(path.join(BUILD, 'audio', f)), f);
  const bundle = readFileSync(path.join(BUILD, js), 'utf8');
  assert.ok(!/bot\d{6,}:[\w-]{20,}/.test(bundle), 'no Telegram token in the bundle');
});

test('server + real build: SPA pages, hashed assets, MIME/cache/CSP, HEAD, unknown and traversal paths', async () => {
  const {js, css} = build(), env = await boot({distDir: BUILD});
  try {
    for (const p of ['/', '/index.html', '/login', '/register']) {
      const r = await fetch(env.base + p), t = await r.text();
      assert.equal(r.status, 200, p); assert.match(r.headers.get('content-type'), /^text\/html; charset=utf-8$/); assert.equal(r.headers.get('cache-control'), 'no-cache');
      assert.match(t, /<div id="root">/);
    }
    const csp = (await fetch(env.base + '/')).headers.get('content-security-policy');
    assert.equal(csp, "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    assert.equal((await fetch(env.base + '/')).headers.get('x-content-type-options'), 'nosniff');
    const j = await fetch(env.base + js), c = await fetch(env.base + css);
    assert.equal(j.status, 200); assert.equal(j.headers.get('content-type'), 'text/javascript; charset=utf-8'); assert.match(j.headers.get('cache-control'), /immutable/);
    assert.equal(c.status, 200); assert.equal(c.headers.get('content-type'), 'text/css; charset=utf-8');
    const h = await fetch(env.base + js, {method: 'HEAD'}); assert.equal(h.status, 200); assert.equal((await h.arrayBuffer()).byteLength, 0); assert.equal(Number(h.headers.get('content-length')), (await j.arrayBuffer()).byteLength);
    const hp = await fetch(env.base + '/login', {method: 'HEAD'}); assert.equal(hp.status, 200); assert.equal((await hp.text()), '');
    for (const p of ['/assets/missing.js', '/assets/', '/assets', '/assets/x.png', '/assets/..%2Fserver.mjs', '/assets/%2e%2e/server.mjs', '/assets/../server.mjs', '/assets/sub/a.js', '/index.html/', '/nope']) assert.equal((await fetch(env.base + p)).status, 404, p);
    // fetch() сам «схлопывает» /audio/../ до /index.html, поэтому такие пути шлём сырым запросом, как это сделал бы атакующий.
    // /audio/../index.html сервер нормализует в /index.html (как браузер): это обычная SPA-страница, а не файл вне dist.
    for (const p of ['/audio/../index.html', '/audio/%2e%2e/index.html']) { const r = await rawRequest(env, {path: p, headers: {Host: `127.0.0.1:${env.port}`}}); assert.equal(r.status, 200, p); assert.match(r.body, /<div id="root">/); }
    for (const p of ['/audio/..%2Findex.html', '/audio/background.mp3/../../package.json']) { const r = await rawRequest(env, {path: p, headers: {Host: `127.0.0.1:${env.port}`}}); assert.equal(r.status, 404, 'raw ' + p); assert.ok(!r.body.includes('<div id="root">'), 'raw ' + p); }
    for (const p of ['/', '/login', '/assets/x.js']) assert.equal((await fetch(env.base + p, {method: 'POST'})).status, 405, 'POST ' + p);
    const raw = await rawRequest(env, {path: '/assets/../../package.json', headers: {Host: `127.0.0.1:${env.port}`}}); assert.equal(raw.status, 404);
  } finally { await env.app.close(); }
});

test('/api/* is never answered by the SPA fallback', async () => {
  const env = await boot();
  try {
    for (const p of ['/api/nope', '/api/', '/api/me/extra']) { const r = await fetch(env.base + p); assert.equal(r.status, p === '/api/me/extra' ? 404 : 404, p); assert.match(r.headers.get('content-type'), /json/); assert.ok(!(await r.text()).includes('<div id="root">')); }
    const me = await fetch(env.base + '/api/me'); assert.equal(me.status, 401); assert.match(me.headers.get('content-type'), /json/);
  } finally { await env.app.close(); }
});

test('missing dist: pages and assets answer 404, API still works (the CLI entry refuses to start instead)', async () => {
  const env = await boot({distDir: path.join(here, '.data', 'no-such-dist')});
  try {
    assert.equal((await fetch(env.base + '/')).status, 404); assert.equal((await fetch(env.base + '/assets/a.js')).status, 404);
    assert.equal((await fetch(env.base + '/api/auth/providers')).status, 200);
  } finally { await env.app.close(); }
});

test('server.mjs CLI exits with a clear message when dist/index.html is missing (isolated copy, no listening)', () => {
  const src = readRoot('server.mjs');
  assert.match(src, /dist\/index\.html topilmadi/); assert.match(src, /process\.exit\(1\)/); assert.match(src, /JENIUS_DEV/);
});

test('active client: no legacy imports, no dangerouslySetInnerHTML/innerHTML, no inline handlers or styles', () => {
  const files = clientFiles(), src = readClientSource();
  assert.ok(files.length >= 50, 'many small modules, not one big file: ' + files.length);
  assert.ok(files.some(f => f.endsWith('App.jsx')) && existsSync(path.join(root, 'client', 'src', 'App.css')));
  assert.doesNotMatch(src, /dangerouslySetInnerHTML/); assert.doesNotMatch(src, /\.innerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(src, /public\/(app|data|engine|sound|keys)\.mjs|\.\.\/public|\/public\//, 'legacy public/ is not imported');
  assert.doesNotMatch(src, /\bstyle=\{|\sstyle="/);
  for (const f of files) assert.ok(readFileSync(f, 'utf8').split('\n').length < 160, 'small file: ' + path.relative(root, f));
  for (const f of walk(path.join(root, 'client', 'src'), f => /\.(js|jsx)$/.test(f))) { const t = readFileSync(f, 'utf8'); for (const m of t.matchAll(/from '([^']+)'/g)) assert.ok(!m[1].includes('/public/'), f); }
});

test('legacy dir is inactive: production server never reads public/, package files list excludes it, docs say so', () => {
  const server = readRoot('server.mjs'); assert.doesNotMatch(server, /'public'|"public"|\/public\//);
  assert.ok(existsSync(path.join(root, 'public', 'LEGACY-README.md')), 'legacy folder is documented');
  assert.match(readRoot('README.md'), /public\/.*legacy|legacy.*public\//is); assert.match(readRoot('CHANGELOG-react.md'), /legacy/i);
  assert.match(readRoot('.gitignore'), /^\/public\/$/m, 'legacy public/ is excluded from git/deploy');
  // npm-пакет: белый список files — legacy public/, tests, data, .env и секреты в него не попадают.
  const files = JSON.parse(readRoot('package.json')).files; assert.ok(Array.isArray(files) && files.length, 'package.json has a files whitelist');
  for (const f of files) assert.ok(!/^(\.\/)?(public|tests|data|\.env(?!\.example)|telegram-config)/.test(f), 'files must not list ' + f);
  for (const f of ['server.mjs', 'server', 'shared', 'client', 'dist']) assert.ok(files.includes(f) || files.includes(f + '/'), 'files lists ' + f);
});

test('secrets/config hygiene: gitignore, env example placeholders only, no Telegram ids/tokens in the repo sources', () => {
  const ig = readRoot('.gitignore').split('\n').map(s => s.trim());
  for (const x of ['node_modules/', 'dist/', 'data/', 'tests/.data/', '*.db', '*.db-wal', '*.db-shm', '.env', '.env.*', 'telegram-config.json', 'coverage/']) assert.ok(ig.includes(x), '.gitignore must list ' + x);
  assert.ok(ig.includes('!.env.example'), 'example is tracked');
  const ex = readRoot('.env.example');
  for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'ALLOWED_HOSTS', 'DB_PATH', 'COOKIE_SECURE', 'TRUST_PROXY']) assert.match(ex, new RegExp('^' + k + '=', 'm'), k);
  assert.match(ex, /^TELEGRAM_BOT_TOKEN=\s*$/m); assert.match(ex, /^TELEGRAM_CHAT_ID=\s*$/m, 'placeholders are empty');
  const scan = [...walk(root, f => /\.(mjs|js|jsx|json|md|yaml|yml|html|css)$/.test(f) && !/node_modules|\/dist|\.data|package-lock|fixtures|\.git\//.test(f))];
  for (const f of scan) { const t = readFileSync(f, 'utf8'); assert.doesNotMatch(t, /\bbot\d{6,}:[A-Za-z0-9_-]{20,}/, 'Telegram token in ' + f); assert.doesNotMatch(t, /chat_id["']?\s*[:=]\s*["']?-?\d{6,}/, 'hard-coded chat id in ' + f); assert.doesNotMatch(t, /(?:TELEGRAM_CHAT_ID|chatId)\s*[:=]\s*["']?-?\d{6,}/, 'hard-coded chat id in ' + f); }
  const rd = readRoot('render.yaml'); assert.match(rd, /sync:\s*false/); assert.match(rd, /COOKIE_SECURE/); assert.match(rd, /disk:/); assert.doesNotMatch(rd, /TELEGRAM_BOT_TOKEN\s*,\s*value/);
});

test('package scripts and lockfile exist (npm ci reproducible build)', () => {
  const pkg = JSON.parse(readRoot('package.json'));
  for (const k of ['dev:server', 'dev:client', 'build', 'start', 'test', 'test:ui', 'check']) assert.ok(pkg.scripts[k], k);
  assert.match(pkg.scripts['dev:server'], /ALLOWED_HOSTS=localhost:5173,127\.0\.0\.1:5173/);
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.mjs');
  for (const d of ['react', 'react-dom']) assert.ok(pkg.dependencies[d]); for (const d of ['vite', '@vitejs/plugin-react', 'vitest', 'jsdom', '@testing-library/react']) assert.ok(pkg.devDependencies[d], d);
  assert.ok(existsSync(path.join(root, 'package-lock.json')));
  const cfg = readRoot('vite.config.js'); assert.match(cfg, /5173/); assert.match(cfg, /'\/api': 'http:\/\/127\.0\.0\.1:4173'/); assert.match(cfg, /modulePreload: \{polyfill: false\}/);
});
