import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, chmodSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {boot, signup, startLevel, patchState} from './helpers.mjs';
import {nicknameAllowed} from '../server/nickname.mjs';
import {openDb} from '../server/db.mjs';

const MIN = 60000;
const here = path.dirname(fileURLToPath(import.meta.url));

test('benign names that merely contain a root are allowed (filter is imperfect, but these must pass)', () => {
  for (const n of ['Nigora', 'Nigina', 'Gulnigor', 'Nigmatov', 'Knight', 'Night', 'Midnight', 'Rashit', 'Rashitov', 'Eshitmoq', 'Yoshito', 'Ashita', 'Asuka', 'Tsukasa', 'Hoshi_Tora'])
    assert.equal(nicknameAllowed(n), true, n);
});

test('abusive nicks stay rejected, and the benign allowlist cannot excuse bad compositions', () => {
  for (const n of ['fuck', 'fvck', 'f4ck', 'F4CK_me', 'fuuuuck', 'f_u_c_k', 'Sh1t', 'shiiit', 'suka', 'suuuka', 'nigga', 'niiiggger', 'Nigora_fuck', 'Nigorafuck', 'Rashit_fuck', 'Rashitfuck', 'Asuka_suka', 'Knight_shit', 'Hoshi_shit', 'Midnight_nigga', 'fuc_ker'])
    assert.equal(nicknameAllowed(n), false, n);
});

test('DB directory is forced to 0700 even if it already existed, file is 0600', () => {
  const dir = path.join(here, '.data', 'perm-check');
  mkdirSync(dir, {recursive: true}); chmodSync(dir, 0o755);
  const db = openDb(path.join(dir, 'perm.db'));
  try {
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(statSync(path.join(dir, 'perm.db')).mode & 0o777, 0o600);
  } finally { db.close(); }
});

async function examReady(env) {
  const u = await signup(env);
  patchState(env, u.name, s => { s.completed[0] = Array.from({length: 50}, (_, i) => i + 1); s.tier = 0; });
  return u;
}
const stateOf = async jar => (await jar.get('/api/me')).data.state;

test('exam: repeated start of the same active exam is idempotent, no cooldown, same lesson', async () => {
  const env = await boot();
  try {
    const {jar} = await examReady(env);
    const a = await startLevel(jar, 50, 0, true); assert.equal(a.status, 200);
    const b = await startLevel(jar, 50, 0, true);
    assert.equal(b.status, 200);
    assert.equal(b.data.lesson.id, a.data.lesson.id, 'same lesson returned');
    assert.equal(b.data.lesson.exam, true);
    assert.deepEqual((await stateOf(jar)).retryAt, a.data.state.retryAt, 'no cooldown penalty');
    assert.equal((await jar.get('/api/me')).data.lesson.id, a.data.lesson.id, 'exam still active');
  } finally { await env.app.close(); }
});

test('exam: rejected start (exam_locked, wrong tier, bad body) leaves active exam and state untouched', async () => {
  const env = await boot();
  try {
    const {jar} = await examReady(env);
    const a = await startLevel(jar, 50, 0, true);
    const before = JSON.stringify(await stateOf(jar));
    assert.equal((await startLevel(jar, 99, 0)).status, 400);                  // bad_request
    assert.equal((await startLevel(jar, 5, 1)).status, 409);                   // tier_mismatch
    assert.equal((await jar.post('/api/lesson/start', {tier: 0, level: 5, exam: 'yes'})).status, 400);
    assert.equal((await startLevel(jar, 49, 0, true)).status, 403, 'exam_locked');
    assert.equal(JSON.stringify(await stateOf(jar)), before, 'state unchanged');
    const me = await jar.get('/api/me');
    assert.equal(me.data.lesson.id, a.data.lesson.id, 'same exam still active');
  } finally { await env.app.close(); }
});

test('exam: rejected replacement because of no hearts has no side effects; real replacement sets cooldown', async () => {
  const env = await boot();
  try {
    const {jar, name} = await examReady(env);
    const a = await startLevel(jar, 50, 0, true);
    const before = (await stateOf(jar)).retryAt[0];
    assert.equal(before <= env.clock.t, true);
    // валидная замена обычным уровнем => экзамен брошен => cooldown
    const r = await startLevel(jar, 3, 0);
    assert.equal(r.status, 200); assert.notEqual(r.data.lesson.id, a.data.lesson.id); assert.equal(r.data.lesson.exam, false);
    const st = await stateOf(jar);
    assert.equal(st.retryAt[0], env.clock.t + 5 * MIN, 'abandon cooldown applied on actual replacement');
    assert.equal((await startLevel(jar, 50, 0, true)).data.error, 'cooldown');
    // отказ из-за отсутствия жизней: активный экзамен без штрафа сверх уже существующего
    env.clock.t += 6 * MIN;
    const e2 = await startLevel(jar, 50, 0, true); assert.equal(e2.status, 200);
    patchState(env, name, s => { s.hearts = 0; });
    const rej = await startLevel(jar, 3, 0);
    assert.equal(rej.status, 403); assert.equal(rej.data.error, 'no_hearts');
    assert.ok(!(rej.data.state.retryAt[0] > env.clock.t), 'rejected start did not set cooldown');
  } finally { await env.app.close(); }
});
