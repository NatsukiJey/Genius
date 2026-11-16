import {createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {createGameStore} from './gameStore.js';
import {createApi, isAuthPath} from '../api/client.js';
import {endpoints} from '../api/endpoints.js';

const GameContext = createContext(null);

// «Окружение» браузера собрано в одном месте, чтобы тесты могли подставить свои navigate/channel.
export const browserEnv = () => ({
  navigate: {replace: p => window.location.replace(p), reload: () => window.location.reload()},
  channel: typeof BroadcastChannel === 'function' ? new BroadcastChannel('jenius') : null,
  getPath: () => window.location.pathname
});

export function GameProvider({env, children}) {
  const [ctx] = useState(() => {
    const e = env || browserEnv(), store = createGameStore();
    const api = createApi({store, navigate: e.navigate, channel: e.channel, getPath: e.getPath});
    return {store, navigate: e.navigate, channel: e.channel, getPath: e.getPath, call: api.call, api: endpoints(api.call), busy: {current: false}, refreshRef: {current: null}};
  });
  const {store, api, navigate, getPath, busy, refreshRef} = ctx;
  const snap = useSyncExternalStore(store.subscribe, store.get);

  // Первый запуск: кто я? 401 -> форма входа, нет сети -> экран «aloqa yo‘q», иначе приложение.
  const boot = useCallback(async () => {
    const r = await api.me(true);
    if (r.netError) { store.set({phase: 'offline'}); return; }
    if (r.status === 401) {
      if (!isAuthPath(getPath())) { navigate.replace('/login'); return; }
      store.set({phase: 'auth'}); return;
    }
    store.set({user: r.data.user});
    if (isAuthPath(getPath())) { navigate.replace('/'); return; }
    store.set({phase: 'ready'});
  }, [api, store, navigate, getPath]);

  // Кнопка баннера «Qayta urinish». Если пользователя ещё нет, refresh() сразу вышел бы — поэтому отдельный путь.
  const retryNet = useCallback(async () => {
    if (store.get().user) return refreshRef.current?.();
    const r = await api.me(true);
    if (r.netError) return;                                   // сервер всё ещё недоступен, баннер остаётся
    if (r.status === 401 && store.get().phase === 'auth') return; // форма входа уже на экране — не стираем введённое
    boot();
  }, [api, store, boot, refreshRef]);

  useEffect(() => { boot(); }, [boot]);
  useEffect(() => () => ctx.channel?.close?.(), [ctx]);

  // Эксклюзивное действие: пока идёт запрос, второй такой же не стартует (как защита от двойного клика).
  const exclusive = useCallback(async fn => {
    if (busy.current) return undefined;
    busy.current = true;
    try { return await fn(); } finally { busy.current = false; }
  }, [busy]);

  const value = useMemo(() => ({...ctx, snap, boot, retryNet, exclusive}), [ctx, snap, boot, retryNet, exclusive]);
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const v = useContext(GameContext);
  if (!v) throw new Error('useGame must be used inside <GameProvider>');
  return v;
}
