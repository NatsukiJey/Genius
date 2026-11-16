import {useLayoutEffect, useRef} from 'react';
import RuKeys from './RuKeys.jsx';

// Вопрос «напиши». Поле контролируется состоянием сессии; кнопки русской клавиатуры вставляют букву в позицию курсора.
export default function TypeQuestion({type, course, text, answered, onText}) {
  const ref = useRef(null), caret = useRef(null);
  useLayoutEffect(() => { if (caret.current !== null && ref.current) { ref.current.setSelectionRange(caret.current, caret.current); caret.current = null; } }, [text]);
  const edit = fn => {
    const inp = ref.current; if (!inp || inp.disabled) return;
    const a = inp.selectionStart ?? inp.value.length, z = inp.selectionEnd ?? a, [value, pos] = fn(inp.value, a, z);
    caret.current = pos; onText(value); inp.focus();
  };
  const onChar = ch => edit((v, a, z) => [v.slice(0, a) + ch + v.slice(z), a + 1]);
  const onBack = () => edit((v, a, z) => { const from = a === z ? Math.max(0, a - 1) : a; return [v.slice(0, from) + v.slice(z), from]; });
  return (<>
    <input id="answer" ref={ref} className="answer-input" lang={type === 'write-en' ? course : undefined} autoComplete="off" spellCheck={false} placeholder="Javobingiz…" aria-label="Javobingiz"
      value={text} disabled={answered} onChange={e => onText(e.target.value)} />
    <small className="no-heart">♡ Bu mashqda xato uchun jon olinmaydi.</small>
    {type === 'write-en' && course === 'ru' && <RuKeys disabled={answered} onChar={onChar} onBack={onBack} />}
  </>);
}
