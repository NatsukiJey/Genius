// Ограничитель попыток. Интерфейс асинхронный и одинаков для двух реализаций:
//  - память (makeMemoryLimiter, локальный SQLite-режим: сбрасывается при рестарте);
//  - PostgreSQL (makePgLimiter): счётчики лежат в таблице throttle_events и общие для всех экземпляров функции Vercel.
// retryAfter(key,max,win) -> секунды ожидания (0 = можно); consume = проверка + запись попытки АТОМАРНО;
// hit / clear; reserve(specs) -> {retryAfter} | {release(), done({hit:[[key,win]], clear:[key]})}.
import {makeLimiter} from './auth.mjs';

export function makeMemoryLimiter(now) {
  const m = makeLimiter(now);
  return {
    async retryAfter(k, max, win) { return m.retryAfter(k, max, win); },
    async consume(k, max, win) { const r = m.retryAfter(k, max, win); if (!r) m.hit(k, win); return r; },
    async hit(k, win) { m.hit(k, win); },
    async clear(k) { m.clear(k); },
    async reserve(specs) {
      const s = m.reserve(specs); if (s.retryAfter) return s;
      return {
        async release() { s.release(); },
        async done({hit = [], clear = []} = {}) { s.release(); for (const [k, w] of hit) m.hit(k, w); for (const k of clear) m.clear(k); }
      };
    }
  };
}

const RSV_TTL = 120000, KEEP = 2 * 3600000; // резерв «живёт» 2 минуты (на случай, если функцию заморозили); события старше 2 ч удаляем
export function makePgLimiter(store, now) {
  const placeholders = ids => ids.map(() => '?').join(',');
  const lockKeys = async (repo, keys) => { for (const k of [...new Set(keys)].sort()) await repo.sql('SELECT pg_advisory_xact_lock(hashtextextended(?,0))', [k]); };
  const stat = async (repo, key, win, t) => (await repo.sql(
    "SELECT count(*) FILTER (WHERE kind='h' AND at>?) AS hits, count(*) FILTER (WHERE kind='r' AND at>?) AS rsv, min(at) FILTER (WHERE kind='h' AND at>?) AS oldest FROM throttle_events WHERE key=?",
    [t - win, t - RSV_TTL, t - win, key]))[0];
  const wait = (s, win, t) => s.oldest != null && Number(s.hits) ? Math.ceil((Number(s.oldest) + win - t) / 1000) : 1;
  const prune = (repo, t) => repo.sql('DELETE FROM throttle_events WHERE at<?', [t - KEEP]);
  const addHit = (repo, key, win, t) => repo.sql("INSERT INTO throttle_events(key,kind,at,win) VALUES(?,'h',?,?)", [key, t, win]);
  return {
    async retryAfter(key, max, win) {
      const t = now(), s = await stat(store.repo, key, win, t);
      return Number(s.hits) >= max ? wait(s, win, t) : 0;
    },
    consume: (key, max, win) => store.tx(async repo => {
      const t = now(); await lockKeys(repo, [key]); await prune(repo, t);
      const s = await stat(repo, key, win, t);
      if (Number(s.hits) >= max) return wait(s, win, t);
      await addHit(repo, key, win, t); return 0;
    }),
    hit: (key, win) => addHit(store.repo, key, win, now()),
    clear: key => store.repo.sql("DELETE FROM throttle_events WHERE key=? AND kind='h'", [key]),
    async reserve(specs) {
      const res = await store.tx(async repo => {
        const t = now(); await lockKeys(repo, specs.map(s => s[0])); await prune(repo, t);
        for (const [key, max, win] of specs) {
          const s = await stat(repo, key, win, t);
          if (Number(s.hits) + Number(s.rsv) >= max) return {retryAfter: wait(s, win, t)};
        }
        const ids = [];
        for (const [key, , win] of specs) ids.push(Number((await repo.sql("INSERT INTO throttle_events(key,kind,at,win) VALUES(?,'r',?,?) RETURNING id", [key, t, win]))[0].id));
        return {ids};
      });
      if (res.retryAfter) return res;
      let finished = false;
      const finish = async ({hit = [], clear = []} = {}) => {
        if (finished) return; finished = true;
        try {
          await store.tx(async repo => {
            const t = now(); await lockKeys(repo, [...hit.map(h => h[0]), ...clear]);
            await repo.sql(`DELETE FROM throttle_events WHERE id IN (${placeholders(res.ids)})`, res.ids);
            for (const k of clear) await repo.sql("DELETE FROM throttle_events WHERE key=? AND kind='h'", [k]);
            for (const [k, w] of hit) await addHit(repo, k, w, t);
          });
        } catch { finished = false; /* резерв сам истечёт через RSV_TTL */ if (hit.length) throw new Error('throttle write failed'); }
      };
      return {release: () => finish().catch(() => {}), done: finish};
    }
  };
}
