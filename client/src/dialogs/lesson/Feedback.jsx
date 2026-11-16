// Сообщение после проверки: класс и текст появляются только когда сервер ответил.
export default function Feedback({last}) {
  const cls = last ? (last.correct ? 'feedback good' : 'feedback bad') : undefined;
  return <div id="answer-feedback" role="status" className={cls}>{last ? (last.correct ? last.note || '✓ Ajoyib! To‘g‘ri javob.' : `To‘g‘ri javob: ${last.answer}`) : ''}</div>;
}
