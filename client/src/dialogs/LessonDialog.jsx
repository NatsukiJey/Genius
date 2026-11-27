import {useEffect, useRef} from 'react';
import {enterSubmits} from '@shared/keys.mjs';
import Modal from '../components/layout/Modal.jsx';
import Stats from '../components/layout/Stats.jsx';
import SoundButton from '../components/sound/SoundButton.jsx';
import ThemeButton from '../components/theme/ThemeButton.jsx';
import QuickBackground from '../components/sound/QuickBackground.jsx';
import {useSound} from '../state/SoundContext.jsx';
import WordIntro from './lesson/WordIntro.jsx';
import Question from './lesson/Question.jsx';

// Окно урока: шапка (выход, статистика, звук, быстрый ползунок фона) + слова или вопрос.
export default function LessonDialog({session: s, dispatch, onCheck, onNext, onExit}) {
  const {setOpen} = useSound();
  useEffect(() => { setOpen(false); }, [setOpen]);          // панель звука при входе в урок закрыта

  // Enter отправляет ответ только с поля ответа или «из пустоты» (enterSubmits): на ползунках/кнопках Enter делает своё дело.
  const live = useRef({});
  live.current = {s, onCheck, onNext};
  useEffect(() => {
    const onKey = e => {
      const {s: cur, onCheck: check, onNext: next} = live.current;
      if (e.key === 'Enter' && cur.phase === 'quiz' && !e.isComposing && enterSubmits(e.target)) {
        e.preventDefault(); if (cur.answered) next(); else check();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Modal className="lesson-dialog" label="Dars" focusFirst={false} focusKey={`${s.phase}:${s.index}`}>
      <div className="lesson-header">
        <button type="button" className="close" data-action="exit" aria-label="Darsdan chiqish" onClick={onExit}>×</button>
        <Stats />
        <SoundButton where="lesson" />
        <ThemeButton />
        <QuickBackground />
      </div>
      {s.phase === 'learn'
        ? <WordIntro course={s.course} tier={s.tier} level={s.level} onStart={() => dispatch({type: 'startQuiz'})} />
        : <Question s={s} dispatch={dispatch} onCheck={onCheck} onNext={onNext} />}
    </Modal>
  );
}
