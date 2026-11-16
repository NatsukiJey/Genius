// Единственное место проверки ответа (используется сервером и тестами).
import {answerOf, COURSES, TYPE_SPECS} from '../shared/data.mjs';
import {normalizeFor, gradeUzbek} from '../shared/engine.mjs';
// Кандидаты для нечёткой проверки узбекского — только слова СВОЕГО курса.
const UZ = Object.fromEntries(Object.entries(COURSES).map(([id, c]) => [id, c.words.flat().map(w => w.uz)]));
// Нечёткая проверка (опечатки) — ТОЛЬКО для write-uz (ответ по-узбекски, в любом курсе);
// остальные типы — точное сравнение (для русского: только регистр, пробелы и ё=е, см. normalizeRu).
export function gradeAnswer(q, given, course = 'en') {
  given = String(given);
  const answer = answerOf(q.type, q.word);
  const fuzzy = q.type==='write-uz'?gradeUzbek(given, answer, UZ[course]):null;
  const norm = TYPE_SPECS[q.type].answerLang === 'target' ? normalizeFor(course) : normalizeFor('en');
  const ok = fuzzy ? fuzzy.ok : norm(given) === norm(answer);
  const note = fuzzy && fuzzy.feedback ? fuzzy.feedback : null;
  const typo = note ? {given: fuzzy.given, answer, target: q.word.t, ...(course === 'en' ? {en: q.word.t} : {}), kind: fuzzy.kind} : null;
  return {ok, answer, note, typo};
}
