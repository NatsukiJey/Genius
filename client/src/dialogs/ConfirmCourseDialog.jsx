import {COURSES} from '@shared/data.mjs';
import Modal from '../components/layout/Modal.jsx';

// Смена курса во время урока: честно предупреждаем о паузе экзамена и о том, что жизни/монеты общие.
export default function ConfirmCourseDialog({courseId, onConfirm, onCancel}) {
  return (
    <Modal labelledBy="cc-heading">
      <h2 id="cc-heading">{COURSES[courseId].name}ga o‘tamizmi?</h2>
      <p>Hozirgi dars to‘xtatiladi. Agar bu yakuniy test bo‘lsa, shu kursda 5 daqiqa kutish jazosi qo‘llanadi. Jon, tanga va strayk umumiy bo‘lib qoladi — almashtirish ularni tiklamaydi.</p>
      <button type="button" className="primary wide" data-course-confirm={courseId} onClick={() => onConfirm(courseId)}>Ha, o‘tish</button>
      <button type="button" className="text-link" data-action="close" onClick={onCancel}>Yo‘q, qolaman</button>
    </Modal>
  );
}
