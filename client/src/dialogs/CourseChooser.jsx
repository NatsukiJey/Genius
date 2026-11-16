import {COURSES} from '@shared/data.mjs';
import Modal from '../components/layout/Modal.jsx';

// Первый выбор языка. Пока курс не выбран, закрыть нельзя (кнопки «Ortga qaytish» нет).
export default function CourseChooser({canClose, onChoose, onClose}) {
  return (
    <Modal className="tier-dialog" labelledBy="course-heading">
      <div className="eyebrow">JENIUS’GA XUSH KELIBSAN</div>
      <h2 id="course-heading">Qaysi tilni o‘rganamiz? 🌍</h2>
      <p>Kursni tanlang. Keyin tepadagi EN / RU tugmalari bilan almashtirish mumkin. Jon, tanga va strayk ikkala kursda umumiy.</p>
      <div className="tier-options">
        {Object.values(COURSES).map(c => (
          <button key={c.id} type="button" data-course={c.id} className="tier-option" onClick={() => onChoose(c.id)}>
            <span>{c.flag}</span><div><strong>{c.name}</strong><small>{c.tiers.map(t => t.name).join(' · ')}</small></div><b>→</b>
          </button>
        ))}
      </div>
      {canClose && <button type="button" className="text-link" data-action="close" onClick={onClose}>Ortga qaytish</button>}
    </Modal>
  );
}
