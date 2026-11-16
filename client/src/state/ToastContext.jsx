import {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

// Один постоянный элемент #toast (role=status, aria-live): скринридер читает текст, когда он меняется.
export function ToastProvider({children, duration = 3500}) {
  const [text, setText] = useState(''), [show, setShow] = useState(false), timer = useRef(0);
  const toast = useCallback(msg => {
    clearTimeout(timer.current); setText(msg); setShow(true);
    timer.current = setTimeout(() => setShow(false), duration);
  }, [duration]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div id="toast" className={show ? 'show' : ''} role="status" aria-live="polite">{text}</div>
    </ToastContext.Provider>
  );
}
