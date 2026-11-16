import {PRACTICE_NOTE} from '@shared/data.mjs';

// Кнопка итогового теста + пояснения. Для русского курса — честная пометка: A1–B2 это упражнения, а не сертификат.
export default function ExamButton({done, passed, courseId, onExam}) {
  return (<>
    <button type="button" className="exam-button" data-action="exam" disabled={done < 50} onClick={onExam}>🏆 Bosqich yakuniy testi {passed ? '✓' : ''}</button>
    <p className="exam-note">10 savol · O‘tish: 80% · Qayta urinish: 5 daqiqadan so‘ng</p>
    {courseId === 'ru' && <p className="exam-note practice-note">{PRACTICE_NOTE}</p>}
  </>);
}
