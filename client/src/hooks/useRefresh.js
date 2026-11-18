import {useCallback, useEffect, useRef} from 'react';

// Держит копию состояния свежей: при возврате на вкладку/окно, раз в минуту, когда подошёл срок жизни,
// и когда другая вкладка сообщила об изменении (BroadcastChannel).
// hasSession() — идёт ли урок; onStaleLesson() вызывается, если на сервере уже ДРУГОЙ урок (начат на другом устройстве).
export function useRefresh({game, hasSession, getSessionId, onStaleLesson}) {
  const {store, api, busy, channel, refreshRef, navigate} = game;
  const refreshing = useRef(0), last = useRef(Date.now());

  const refresh = useCallback(async arg => {
    const force = arg && arg.force === true; // refresh используется и как обработчик события — аргумент может быть Event
    if (busy.current || (refreshing.current > 0 && !force) || !store.get().user) return; // ручной повтор не ждёт фоновый запрос
    refreshing.current++; last.current = Date.now();
    const r = await api.refresh(force);
    refreshing.current--;
    if (r.status !== 200 || r.stale) return; // устаревший ответ не применялся — урок сравнивать не с чем
    const sid = getSessionId(), lesson = store.get().lesson;
    if (sid && lesson && lesson.id !== sid) onStaleLesson();
  }, [api, store, busy, getSessionId, onStaleLesson]);

  useEffect(() => { refreshRef.current = refresh; return () => { if (refreshRef.current === refresh) refreshRef.current = null; }; }, [refresh, refreshRef]);

  useEffect(() => {
    const tick = () => {
      const {user, state} = store.get();
      if (!user || !state) return;
      if (state.regenAt && Math.ceil((state.regenAt - store.serverNow()) / 1000) <= 0 && Date.now() - last.current > 5000) refresh();
      if (Date.now() - last.current > 60000 && !hasSession()) refresh();
    };
    const timer = setInterval(tick, 1000);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', refresh);
    const prevHandler = channel?.onmessage;
    if (channel) channel.onmessage = e => {
      if (e.data === 'logout' && store.get().user) navigate.replace('/login');
      else if (e.data === 'changed') refresh();
    };
    return () => {
      clearInterval(timer); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', refresh);
      if (channel) channel.onmessage = prevHandler ?? null;
    };
  }, [store, channel, navigate, refresh, hasSession]);

  return refresh;
}
