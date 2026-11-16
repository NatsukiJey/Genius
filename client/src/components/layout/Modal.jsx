import {useEffect, useRef} from 'react';
import {useFocusTrap} from '../../hooks/useFocusTrap.js';

// Общая оболочка диалога: оверлей + role=dialog aria-modal. Фокус: при открытии — на первую кнопку (или на то, что
// решит дочерний компонент, если focusFirst=false), Tab ходит по кругу внутри, при закрытии фокус возвращается назад.
export default function Modal({className = '', labelledBy, label, focusFirst = true, focusKey, children}) {
  const ref = useRef(null);
  useFocusTrap(ref);
  useEffect(() => {
    const before = document.activeElement;
    if (focusFirst) ref.current?.querySelector('button')?.focus();
    return () => { if (before && before !== document.body && document.contains(before) && !before.disabled) before.focus(); };
  }, [focusFirst]);
  // Диалог урока перерисовывает вопросы внутри одного окна: на каждый новый вопрос фокус идёт на поле ответа,
  // а если поля нет (выбор/сборка) — на сам диалог, чтобы Tab продолжал ходить внутри него.
  useEffect(() => {
    if (focusKey === undefined) return;
    (ref.current?.querySelector('#answer') || ref.current)?.focus();
  }, [focusKey]);
  return (
    <div className="overlay">
      <section ref={ref} className={`dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-label={label} tabIndex={-1}>
        {children}
      </section>
    </div>
  );
}
