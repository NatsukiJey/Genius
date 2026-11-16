import Modal from '../components/layout/Modal.jsx';

// После 5 вопросов с ошибками: ещё одна короткая серия «без ошибок». Правила жизней и монет те же.
export default function ReviewDialog({correct, onRetry, onExit}) {
  return (
    <Modal className="result" labelledBy="review-heading">
      <span className="result-icon">🌱</span>
      <h2 id="review-heading">Yana bir kichik mashq!</h2>
      <p>{correct}/5 to‘g‘ri. O‘rganganlaringni mustahkamlash uchun shu 5 savolni xatosiz tugat. Jon va tanga qoidalari o‘zgarmaydi.</p>
      <button type="button" className="primary" data-action="retry-lesson" onClick={onRetry}>Qayta mashq qilish →</button>
      <button type="button" className="text-link" data-action="exit" onClick={onExit}>Hozircha chiqish</button>
    </Modal>
  );
}
