import {COURSES, PRACTICE_NOTE} from '@shared/data.mjs';
import Modal from '../components/layout/Modal.jsx';

// course — курс, для которого окно ОТКРЫЛИ. Запрос уходит именно с ним: если курс успел смениться в другой вкладке,
// сервер ответит 409 и ничего не сохранит (выбор не попадёт не в тот курс).
export default function TierPicker({course, canClose, onPick, onClose}) {
  const C = COURSES[course];
  return (
    <Modal className="tier-dialog" labelledBy="tier-heading">
      <div className="eyebrow">JENIUS’GA XUSH KELIBSAN</div>
      <h2 id="tier-heading">Qayerdan boshlaymiz? 🌱</h2>
      <p>{C.name}: darajangizni tanlang. Keyin o‘zgartirish mumkin.{course === 'ru' && <> <small>{PRACTICE_NOTE}</small></>}</p>
      <div className="tier-options">
        {C.tiers.map((t, i) => (
          <button key={t.id ?? i} type="button" data-tier={i} data-tier-course={course} className="tier-option" onClick={() => onPick(i, course)}>
            <span>{t.icon}</span><div><strong>{t.name}</strong><small>{t.description}</small></div><b>→</b>
          </button>
        ))}
      </div>
      {canClose && <button type="button" className="text-link" data-action="close" onClick={onClose}>Ortga qaytish</button>}
    </Modal>
  );
}
