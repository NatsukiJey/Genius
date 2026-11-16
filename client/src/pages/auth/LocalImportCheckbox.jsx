import {countLevels} from '../../lib/localImport.js';

// Предлагается только если в этом браузере есть старый прогресс. По умолчанию НЕ отмечено.
export default function LocalImportCheckbox({candidate}) {
  return (
    <label className="check">
      <input type="checkbox" id="reg-import" name="import" />{' '}
      <span>Bu brauzerdagi eski natijani ({countLevels(candidate)} ta level) yangi hisobga ko‘chirish. Eski ma’lumot brauzerda o‘chirilmaydi. Faqat ro‘yxatdan o‘tishda ishlaydi.</span>
    </label>
  );
}
