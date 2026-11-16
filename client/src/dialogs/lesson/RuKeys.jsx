import {RU_LETTERS} from '../../lib/ru.js';

// Подсказка-клавиатура для русского: кнопки вставляют букву в позицию курсора.
export default function RuKeys({disabled, onChar, onBack}) {
  return (
    <div className="ru-keys" role="group" aria-label="Rus harflari tugmalari (maslahat)">
      <small>Rus harflari: tugmalarni bosing yoki qurilmangizda rus klaviaturasini (RU) yoqing. Katta-kichik harf farq qilmaydi, «ё» o‘rniga «е» yozsangiz ham bo‘ladi.</small>
      <div className="ru-key-row">
        {RU_LETTERS.map(ch => <button key={ch} type="button" className="ru-key" lang="ru" data-ru-char={ch} aria-label={ch} disabled={disabled} onClick={() => onChar(ch)}>{ch}</button>)}
        <button type="button" className="ru-key wide-key" data-ru-char=" " aria-label="Probel" disabled={disabled} onClick={() => onChar(' ')}>␣</button>
        <button type="button" className="ru-key wide-key" data-ru-back="1" aria-label="Oxirgi harfni o‘chirish" disabled={disabled} onClick={onBack}>⌫</button>
      </div>
    </div>
  );
}
