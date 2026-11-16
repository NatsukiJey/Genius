// Маленькое внешнее хранилище: копия серверного состояния для показа. Браузер ничего не сохраняет сам.
// Нужно, чтобы async-действия читали СВЕЖЕЕ значение сразу после await (в замыкании React оно бывает старым).
export function createGameStore() {
  let snap = {phase: 'boot', user: null, state: null, today: null, lesson: null, clockOffset: 0, netDown: false};
  const subs = new Set();
  const store = {
    get: () => snap,
    subscribe: f => { subs.add(f); return () => subs.delete(f); },
    set(patch) { snap = {...snap, ...patch}; for (const f of [...subs]) f(); },
    apply(d) { if (d && d.state) store.set({state: d.state, today: d.today, clockOffset: d.serverNow - Date.now(), lesson: d.lesson ?? null}); },
    serverNow: () => Date.now() + snap.clockOffset
  };
  return store;
}
