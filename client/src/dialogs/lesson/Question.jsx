import {promptOf, instructionOf, promptIsTarget} from '@shared/data.mjs';
import ChoiceQuestion from './ChoiceQuestion.jsx';
import TileQuestion from './TileQuestion.jsx';
import TypeQuestion from './TypeQuestion.jsx';
import Feedback from './Feedback.jsx';

// Один вопрос урока: прогресс, инструкция по-узбекски, само задание, ответ сервера, кнопка «Tekshirish»/«Davom etish».
export default function Question({s, dispatch, onCheck, onNext}) {
  const q = s.items[s.index];
  return (<>
    <progress className="quiz-progress" value={s.index} max={s.items.length} aria-label="Dars jarayoni"></progress>
    <div className="quiz-meta">{s.exam ? 'YAKUNIY TEST' : `${s.level}-LEVEL`} <span>{s.index + 1} / {s.items.length}</span></div>
    <h2>{instructionOf(q.type, s.course)}</h2>
    <div className="question-word" lang={promptIsTarget(q.type) ? s.course : undefined}>{promptOf(q.type, q.word)}</div>
    {q.type.startsWith('write')
      ? <TypeQuestion type={q.type} course={s.course} text={s.text} answered={s.answered} onText={text => dispatch({type: 'setText', text})} />
      : q.type === 'assemble'
        ? <TileQuestion tiles={s.tiles} chosen={s.chosen} answered={s.answered} onPick={index => dispatch({type: 'pickTile', index})} onReset={() => dispatch({type: 'resetTiles'})} />
        : <ChoiceQuestion choices={q.choices} selected={s.selected} answered={s.answered} onSelect={index => dispatch({type: 'select', index})} />}
    <Feedback last={s.last} />
    <button type="button" className="primary wide" data-action={s.answered ? 'next' : 'check'} data-sfx="none" disabled={s.pending} onClick={s.answered ? onNext : onCheck}>
      {s.answered ? 'Davom etish →' : 'Tekshirish →'}
    </button>
  </>);
}
