// Контракт сервера для устойчивости клиента: повтор потерянного ответа идемпотентен (в т.ч. параллельный дубль, пока первый ещё выполняется),
// а 409 несёт тот же урок с актуальным индексом — клиент может «догнать» сервер, а не закрывать урок.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boot, signup, startLevel, correctGiven, wrongGiven} from './helpers.mjs';

test('lost answer response: 3 parallel identical retries cost ONE heart and give identical results', async () => {
  const env = await boot();
  try {
    const {jar} = await signup(env);
    const L = (await startLevel(jar, 1)).data.lesson;
    const body = {lessonId: L.id, index: 0, given: wrongGiven()};
    const rs = await Promise.all([jar.post('/api/lesson/answer', body), jar.post('/api/lesson/answer', body), jar.post('/api/lesson/answer', body)]);
    for (const r of rs) { assert.equal(r.status, 200); assert.equal(r.data.state.hearts, 4, 'one heart total'); assert.deepEqual(r.data.result, rs[0].data.result); }
    assert.equal(rs.filter(r => r.data.replay).length, 2, 'one real grading, two replays');
    assert.equal((await jar.get('/api/me')).data.state.hearts, 4);
  } finally { await env.app.close(); }
});

test('lost final answer: parallel retries pay the level reward once; coins stay +20', async () => {
  const env = await boot();
  try {
    const {jar} = await signup(env);
    const L = (await startLevel(jar, 1)).data.lesson;
    for (let i = 0; i < 4; i++) await jar.post('/api/lesson/answer', {lessonId: L.id, index: i, given: correctGiven(L, i)});
    const body = {lessonId: L.id, index: 4, given: correctGiven(L, 4)};
    const rs = await Promise.all([jar.post('/api/lesson/answer', body), jar.post('/api/lesson/answer', body)]);
    for (const r of rs) { assert.equal(r.status, 200); assert.equal(r.data.state.coins, 20); }
    assert.equal(rs.map(r => r.data.result.reward).sort()[1], 20); assert.equal((await jar.get('/api/me')).data.state.coins, 20);
  } finally { await env.app.close(); }
});

test('after a lost response a DIFFERENT answer for the same index gets 409 carrying the same lesson at the new index (client resyncs); the original still replays', async () => {
  const env = await boot();
  try {
    const {jar} = await signup(env);
    const L = (await startLevel(jar, 1)).data.lesson;
    const orig = {lessonId: L.id, index: 0, given: wrongGiven()};
    const first = await jar.post('/api/lesson/answer', orig); assert.equal(first.status, 200);
    const other = await jar.post('/api/lesson/answer', {lessonId: L.id, index: 0, given: correctGiven(L, 0)});
    assert.equal(other.status, 409); assert.equal(other.data.lesson.id, L.id); assert.equal(other.data.lesson.index, 1);
    assert.equal(other.data.state.hearts, 4, 'the 409 did not cost anything');
    const again = await jar.post('/api/lesson/answer', orig); assert.equal(again.status, 200); assert.equal(again.data.replay, true); assert.equal(again.data.state.hearts, 4);
  } finally { await env.app.close(); }
});
