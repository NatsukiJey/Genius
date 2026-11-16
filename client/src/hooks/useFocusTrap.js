import {useEffect} from 'react';
import {focusables, trapTarget} from '@shared/keys.mjs';

// Пока диалог открыт, Tab/Shift+Tab ходят по кругу внутри него (скрытые панели и disabled пропускаются).
export function useFocusTrap(ref) {
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Tab' || !ref.current) return;
      const t = trapTarget(focusables(ref.current), document.activeElement, e.shiftKey);
      if (t) { t.focus(); e.preventDefault(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ref]);
}
