// Единственное место, где браузер говорит с сервером. Все ответы прогоняются через store.apply(),
// сеть/5xx включают баннер «нет сети», 401 отправляет на /login. Браузер ничего не решает сам: правда — на сервере.
export const AUTH_PATHS = ['/login', '/register'];
export const isAuthPath = p => AUTH_PATHS.includes(p);
// POST-запросы, после которых другим вкладкам НЕ нужно обновляться.
const SILENT = new Set(['/api/login', '/api/register', '/api/report']);

export function createApi({store, navigate, channel = null, getPath = () => window.location.pathname}) {
  async function call(path, body, quiet = false) {
    try {
      const init = {method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin'};
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') init.signal = AbortSignal.timeout(10000);
      const r = await fetch(path, init);
      let data = {}; try { data = await r.json(); } catch {}
      if (r.status >= 500) { store.set({netDown: true}); return {status: r.status, data, netError: true}; }
      store.set({netDown: false});
      if (r.status === 401 && !quiet && !isAuthPath(getPath())) { navigate.replace('/login'); return {status: 401, data}; }
      store.apply(data);
      if (r.ok && body !== undefined && !SILENT.has(path)) channel?.postMessage('changed');
      return {status: r.status, data};
    } catch { store.set({netDown: true}); return {status: 0, data: {}, netError: true}; }
  }
  return {call};
}

// Отчёт об ошибке идёт мимо баннера: свои сообщения об ошибках.
export async function sendReport(message) {
  const r = await fetch('/api/report', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message})});
  const data = await r.json();
  if (!r.ok || !data.ok) throw Error(data.error || 'Xabar yuborilmadi.');
}
