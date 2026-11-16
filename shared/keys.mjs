// Клавиатура Jenius: ловушка Tab внутри диалога и правило «Enter отправляет ответ».
// Всё принимает «элементы» как есть (tagName, id, type, disabled, tabIndex, closest), поэтому тестируется без браузера.
export const FOCUSABLE = 'button,input,textarea,select,a[href],[tabindex]';

// Элементы, до которых реально можно дойти клавишей Tab. Скрытые панели (hidden), disabled, type=hidden, tabindex=-1 — не считаются.
export function focusables(root) {
  if (!root || !root.querySelectorAll) return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter(el =>
    !el.disabled && el.type !== 'hidden' && !(el.tabIndex < 0) && !el.hidden && !(el.closest && el.closest('[hidden]')));
}

// Куда перенести фокус при Tab. Возвращает элемент (и нужно вызвать preventDefault) или null (пусть браузер сам идёт дальше).
export function trapTarget(els, active, shift) {
  if (!els.length) return null;
  const first = els[0], last = els[els.length - 1];
  if (!els.includes(active)) return shift ? last : first;   // фокус вне диалога/на скрытом элементе — возвращаем внутрь
  if (shift && active === first) return last;
  if (!shift && active === last) return first;
  return null;
}

// Enter на кнопке/ссылке/ползунке/выборе/в панели звука должен делать СВОЁ дело, а не отправлять ответ урока.
// Отправляем только с поля ответа (#answer) или когда фокус нигде (body).
export function enterSubmits(t) {
  if (!t || !t.tagName) return true;
  if (t.closest && t.closest('.sound-panel')) return false;
  const tag = String(t.tagName).toLowerCase();
  if (tag === 'input') return t.id === 'answer';
  return !['button', 'a', 'select', 'textarea'].includes(tag);
}
