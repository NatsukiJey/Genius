import {courseQuestions, answerOf} from '@shared/data.mjs';

// Чистая логика сессии урока: слова -> вопрос -> проверка -> следующий/повтор/результат.
// Сервер — источник правды (оценка, жизни, монеты); здесь только то, что нужно для показа.
export const initialSession = null;

// Плитки для вопроса «собери слово»: порядок детерминированный (не случайный), чтобы один и тот же вопрос выглядел одинаково.
export function makeTiles(q, level) {
  return answerOf(q.type, q.word).split('').map((v, id) => ({v, id})).sort((a, b) => ((a.id * 17 + level * 3) % 23) - ((b.id * 17 + level * 3) % 23));
}

// Подготовка текущего вопроса: чистим выбор/ввод/ответ.
function prepare(s) {
  const q = s.items[s.index], fresh = {...s, selected: null, chosen: [], text: '', answered: false, last: null, pending: false};
  if (s.phase === 'quiz' && q?.type === 'assemble') fresh.tiles = makeTiles(q, s.level);
  else fresh.tiles = [];
  return fresh;
}

export function sessionFromLesson(L, resumed) {
  const items = courseQuestions(L.course, L.tier, L.level, L.exam);
  const phase = L.phase === 'review' ? 'review' : (L.exam || resumed || L.index > 0 ? 'quiz' : 'learn');
  return prepare({id: L.id, course: L.course, tier: L.tier, level: L.level, exam: L.exam, phase, items, index: Math.min(L.index, L.total - 1), correct: L.correct, mistakes: L.mistakes, typos: []});
}

export function lessonReducer(s, a) {
  switch (a.type) {
    case 'open': return sessionFromLesson(a.lesson, a.resumed);
    case 'close': return null;
    default: if (!s) return s;
  }
  switch (a.type) {
    case 'startQuiz': return prepare({...s, phase: 'quiz'});
    case 'select': return s.answered ? s : {...s, selected: a.index};
    case 'pickTile': return s.answered || s.chosen.includes(a.index) ? s : {...s, chosen: [...s.chosen, a.index]};
    case 'resetTiles': return s.answered ? s : {...s, chosen: []};
    case 'setText': return s.answered ? s : {...s, text: a.text};
    case 'pending': return {...s, pending: a.value};
    case 'answered': {
      const res = a.result;
      return {...s, pending: false, answered: true, last: res, correct: s.correct + (res.correct ? 1 : 0), mistakes: s.mistakes + (res.correct ? 0 : 1), typos: res.typo ? [...s.typos, res.typo] : s.typos};
    }
    case 'advance': return prepare({...s, index: s.index + 1});
    case 'toReview': return {...s, phase: 'review', pending: false};
    case 'restart': return prepare({...s, index: 0, correct: 0, mistakes: 0, typos: [], phase: 'quiz'});
    default: return s;
  }
}

// Что отправить серверу как ответ на текущий вопрос.
export function givenOf(s) {
  const q = s.items[s.index];
  if (q.type.startsWith('write')) return s.text;
  if (q.type === 'assemble') return s.chosen.map(i => s.tiles[i].v).join('');
  return s.selected === null ? '' : q.choices[s.selected];
}
