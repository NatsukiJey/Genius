import Modal from '../components/layout/Modal.jsx';

// Итог урока/экзамена. Данные приходят из ответа сервера (outcome, reward).
export default function ResultScreen({result, onDone}) {
  const {passed, reward, correct, total, exam, typos} = result;
  return (
    <Modal className="result" labelledBy="result-heading">
      <span className="result-icon">{passed ? '🏆' : '🌱'}</span>
      <div className="eyebrow">{passed ? 'YANA BIR G‘ALABA' : 'BU FAQAT BOSHLANISHI'}</div>
      <h2 id="result-heading">{passed ? 'Zo‘r! Sen uddalading.' : 'Yana urinib ko‘ramiz!'}</h2>
      <p>{correct}/{total} to‘g‘ri javob. {exam ? (passed ? 'Bosqich testi muvaffaqiyatli topshirildi!' : '80% kerak. 5 daqiqadan keyin yana urinish mumkin.') : reward ? `+${reward} tanga! Yangi level ochildi.` : 'Takrorlash — bilimning kaliti. Qayta tanga berilmaydi.'}</p>
      {typos.length > 0 && (
        <div className="feedback good typo-note"><b>Imlo eslatmasi:</b>
          {typos.map((t, i) => <div key={i}>{t.target ?? t.en}: {t.given} → {t.answer}</div>)}
        </div>
      )}
      <button type="button" className="primary" data-action="done" onClick={onDone}>Sayohatga qaytish →</button>
    </Modal>
  );
}
