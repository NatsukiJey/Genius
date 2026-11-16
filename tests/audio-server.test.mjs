import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {boot, FIXTURE_ASSET_JS} from './helpers.mjs';

const ASSETS = {'background.mp3': 'audio/mpeg', 'click.wav': 'audio/wav', 'correct.wav': 'audio/wav', 'lose.wav': 'audio/wav', 'select.wav': 'audio/wav', 'win.wav': 'audio/wav'};
const bytes = n => readFile(new URL('../client/public/audio/' + n, import.meta.url));

test('each audio asset: 200, exact MIME, length, bytes, HEAD without body', async () => {
  const env = await boot();
  try {
    for (const [name, mime] of Object.entries(ASSETS)) {
      const file = await bytes(name), r = await fetch(`${env.base}/audio/${name}`);
      assert.equal(r.status, 200, name); assert.equal(r.headers.get('content-type'), mime);
      assert.equal(r.headers.get('accept-ranges'), 'bytes'); assert.equal(Number(r.headers.get('content-length')), file.length);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(Buffer.from(await r.arrayBuffer()).equals(file), name + ' bytes');
      const h = await fetch(`${env.base}/audio/${name}`, {method: 'HEAD'});
      assert.equal(h.status, 200); assert.equal(Number(h.headers.get('content-length')), file.length); assert.equal((await h.arrayBuffer()).byteLength, 0);
    }
  } finally { await env.app.close(); }
});

test('single byte ranges: a-b, a-, -n give 206 with right bytes; out of range 416; multi/garbage -> 200', async () => {
  const env = await boot(), url = `${env.base}/audio/click.wav`, file = await bytes('click.wav'), n = file.length;
  const get = async range => { const r = await fetch(url, {headers: {Range: range}}); return {r, b: Buffer.from(await r.arrayBuffer())}; };
  try {
    let x = await get('bytes=0-99'); assert.equal(x.r.status, 206); assert.equal(x.r.headers.get('content-range'), `bytes 0-99/${n}`); assert.equal(x.r.headers.get('content-length'), '100'); assert.ok(x.b.equals(file.subarray(0, 100)));
    x = await get('bytes=100-'); assert.equal(x.r.status, 206); assert.equal(x.r.headers.get('content-range'), `bytes 100-${n - 1}/${n}`); assert.ok(x.b.equals(file.subarray(100)));
    x = await get('bytes=-100'); assert.equal(x.r.status, 206); assert.equal(x.r.headers.get('content-range'), `bytes ${n - 100}-${n - 1}/${n}`); assert.ok(x.b.equals(file.subarray(n - 100)));
    x = await get(`bytes=10-${n + 5000}`); assert.equal(x.r.status, 206); assert.equal(x.r.headers.get('content-range'), `bytes 10-${n - 1}/${n}`);
    x = await get(`bytes=${n}-`); assert.equal(x.r.status, 416); assert.equal(x.r.headers.get('content-range'), `bytes */${n}`);
    x = await get('bytes=-0'); assert.equal(x.r.status, 416);
    x = await get('bytes=0-1,5-9'); assert.equal(x.r.status, 200); assert.equal(x.b.length, n);
    x = await get('bytes=abc'); assert.equal(x.r.status, 200);
    const h = await fetch(url, {method: 'HEAD', headers: {Range: 'bytes=0-9'}}); assert.equal(h.status, 206); assert.equal(h.headers.get('content-length'), '10'); assert.equal((await h.arrayBuffer()).byteLength, 0);
  } finally { await env.app.close(); }
});

test('only allowlisted audio paths; traversal/unknown 404; POST 405; CSP has media-src self; built JS asset served with a JS type', async () => {
  const env = await boot();
  try {
    for (const p of ['/audio/x.wav', '/audio/', '/audio', '/audio/..%2Fserver.mjs', '/audio/%2e%2e/server.mjs', '/audio/../server.mjs', '/audio/click.wav/', '/audio/CLICK.wav']) assert.equal((await fetch(env.base + p)).status, 404, p);
    assert.equal((await fetch(env.base + '/audio/click.wav', {method: 'POST'})).status, 405);
    const css = (await fetch(env.base + '/')).headers.get('content-security-policy');
    assert.match(css, /media-src 'self'/); assert.match(css, /script-src 'self'/);
    const s = await fetch(`${env.base}/assets/${FIXTURE_ASSET_JS}`); assert.equal(s.status, 200); assert.match(s.headers.get('content-type'), /javascript/);
  } finally { await env.app.close(); }
});

test('Google stage 2A: providers report disabled and leak no secrets', async () => {
  const env = await boot();
  try {
    const r = await fetch(env.base + '/api/auth/providers'); assert.equal(r.status, 200);
    const t = await r.text(), j = JSON.parse(t);
    assert.deepEqual(j, {google: {enabled: false}});
    assert.doesNotMatch(t, /client|secret|token|key/i);
    assert.equal((await fetch(env.base + '/api/auth/providers', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, 405);
    assert.equal((await fetch(env.base + '/api/auth/google/start')).status, 404);
  } finally { await env.app.close(); }
});
