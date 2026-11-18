// Единственное место, где браузер говорит с сервером. Все ответы прогоняются через store.apply(),
// сеть/5xx включают баннер «нет сети», 401 отправляет на /login. Браузер ничего не решает сам: правда — на сервере.
export const AUTH_PATHS = ['/login', '/register'];
export const isAuthPath = p => AUTH_PATHS.includes(p);
// POST-запросы, после которых другим вкладкам НЕ нужно обновляться.
const SILENT = new Set(['/api/login', '/api/register', '/api/report']);
// Паузы между повторами. Повторяются ТОЛЬКО чтения (GET) и ответ в уроке (тот же lessonId+index+given, сервер идемпотентен).
export const DEFAULT_RETRY_DELAYS = [600, 1500];
// Безопасная диагностика сбоя для баннера: только вид сбоя, HTTP-статус, причина сервера (код вроде db_timeout) и id запроса. Без cookie и текста ошибок.
export function diagOf(status, data, nonJson, ref) {
  const reason = typeof data?.reason === 'string' && /^[a-z_]{2,30}$/.test(data.reason) ? data.reason : null;
  const kind = nonJson ? 'bad_response' : reason ? 'server_' + reason : status === 503 ? 'server_unavailable' : 'server_error';
  return {kind, status, ref};
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function createApi({store, navigate, channel = null, getPath = () => window.location.pathname, retryDelays = DEFAULT_RETRY_DELAYS}) {
  // Версия «записей»: растёт, когда POST стартует и когда заканчивается. Чтение, начатое до записи, к моменту ответа уже устарело:
  // его ответ нельзя применять (иначе старое состояние затрёт свежее), а его сбой — не повод кричать «результат не сохранён».
  let writes = 0, epoch = 0;

  async function attempt(path, body) {
    try {
      const init = {method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin'};
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') init.signal = AbortSignal.timeout(10000);
      const r = await fetch(path, init);
      let data = {}, nonJson = false; try { data = await r.json(); } catch { nonJson = true; }
      const ref = (r.headers?.get?.('x-vercel-id') || '').split('::').pop() || null; // публичный id запроса: по нему ищут запись в логах Vercel
      const res = {status: r.status, data, nonJson, netError: r.status >= 500};
      if (res.netError) res.diag = diagOf(r.status, data, nonJson, ref);
      return res;
    } catch (e) { return {status: 0, data: {}, netError: true, diag: {kind: e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'network', status: 0}}; }
  }

  // opts.force — ручное «Qayta urinish»: успех гасит и баннер неподтверждённой записи.
  async function call(path, body, quiet = false, opts = {}) {
    const isRead = body === undefined;
    if (!isRead) { writes++; epoch++; }
    const startEpoch = epoch;
    try {
      let res = await attempt(path, body);
      if (isRead) { // чтение безопасно повторять: холодный старт/обрыв часто проходит со второй попытки
        for (const d of (opts.retryDelays ?? retryDelays)) {
          if (!res.netError) break;
          await sleep(d);
          if (writes > 0 || epoch !== startEpoch) break; // пока ждали, пользователь что-то отправил — это чтение уже не нужно
          res = await attempt(path, body);
        }
      }
      const stale = isRead && (writes > 0 || epoch !== startEpoch);
      if (res.netError) {
        if (!stale) store.set({netDown: true, netKind: isRead ? 'read' : 'write', netDiag: res.diag || null});
        return {...res, stale};
      }
      if (res.status === 401 && !quiet && !isAuthPath(getPath())) { navigate.replace('/login'); return {...res, stale}; }
      if (stale) return {...res, stale: true}; // устаревший ответ чтения: ни состояние, ни баннер не трогаем
      // Успех записи гасит любой баннер. Успех чтения гасит только баннер чтения: сбой записи («ответ не подтверждён») им не скрыть.
      if (!isRead || opts.force || store.get().netKind !== 'write') store.set({netDown: false, netKind: null, netDiag: null});
      store.apply(res.data);
      if (res.status >= 200 && res.status < 300 && !isRead && !SILENT.has(path)) channel?.postMessage('changed');
      return res;
    } finally { if (!isRead) { writes--; epoch++; } }
  }
  return {call};
}

// Отчёт об ошибке идёт мимо баннера: свои сообщения об ошибках.
export async function sendReport(message) {
  const r = await fetch('/api/report', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message})});
  const data = await r.json();
  if (!r.ok || !data.ok) throw Error(data.error || 'Xabar yuborilmadi.');
}
