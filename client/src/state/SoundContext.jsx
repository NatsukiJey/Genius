import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {createSound} from '@shared/sound.mjs';
import {safeStorage} from '../lib/storage.js';

const SoundContext = createContext(null);

// Без Audio (старые/тестовые среды) звук просто молчит.
const SilentAudio = class { play() { return Promise.resolve(); } pause() {} addEventListener() {} removeEventListener() {} };

// Настройки звука отдаём React как внешнее хранилище. Снимок кешируем: getPrefs() каждый раз делает копию,
// а useSyncExternalStore требует одинаковый объект между вызовами.
function makePrefsStore(sound) {
  let snap = sound.getPrefs();
  const subs = new Set();
  sound.onChange(p => { snap = p; subs.forEach(f => f()); });
  return {get: () => snap, subscribe: f => { subs.add(f); return () => subs.delete(f); }};
}

export function SoundProvider({children, AudioImpl}) {
  const [core] = useState(() => {
    const A = AudioImpl || (typeof Audio === 'function' ? Audio : SilentAudio);
    const sound = createSound({Audio: A, storage: safeStorage(), document, win: window});
    sound.init();                       // настройки читаются СРАЗУ, чтобы первый показ ползунков был верным
    return {sound, prefsStore: makePrefsStore(sound)};
  });
  const {sound, prefsStore} = core;
  const prefs = useSyncExternalStore(prefsStore.subscribe, prefsStore.get);
  const [open, setOpenState] = useState(false), openRef = useRef(false), toggleBtn = useRef(null);
  const setOpen = useCallback(v => { openRef.current = v; setOpenState(v); }, []);

  useEffect(() => () => sound.destroy(), [sound]);

  useEffect(() => {
    // CAPTURE-фаза: слушатель срабатывает ДО обработчиков React, пока кнопка ещё не disabled/не перерисована.
    const onClick = e => {
      if (openRef.current && !e.target.closest('.sound-wrap') && !e.target.closest('.quick-bg')) setOpen(false);
      const b = e.target.closest('button,a');
      if (!b || b.disabled) return;
      const sfx = b.dataset.sfx;
      if (sfx === 'none') return;      // кнопки ползунков/«проверить»/«дальше»: свой звук (или тишина)
      sound.play(sfx === 'select' ? 'select' : 'click');
    };
    const onKey = e => { if (e.key === 'Escape' && openRef.current) { setOpen(false); toggleBtn.current?.focus(); } };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick, true); document.removeEventListener('keydown', onKey); };
  }, [sound, setOpen]);

  const value = useMemo(() => ({sound, prefs, open, setOpen, toggleBtn}), [sound, prefs, open, setOpen]);
  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function useSound() {
  const v = useContext(SoundContext);
  if (!v) throw new Error('useSound must be used inside <SoundProvider>');
  return v;
}
