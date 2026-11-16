import LevelNode from './LevelNode.jsx';
import ExamButton from './ExamButton.jsx';

export const LEVELS = 50;

export default function LevelMap({course, tier, completed, passed, onStart, onExam}) {
  const T = course.tiers[tier];
  return (<>
    <div className="chapter">
      <span className="chapter-icon">{T.icon}</span>
      <div><small>{T.label.toUpperCase()} · 50 LEVEL</small><h3>{course.chapters[tier]}</h3></div>
      <span className="chapter-progress">{completed.length}/50</span>
    </div>
    <div className="map">
      {Array.from({length: LEVELS}, (_, i) => <LevelNode key={i + 1} level={i + 1} i={i} completed={completed} onStart={onStart} />)}
      <ExamButton done={completed.length} passed={passed} courseId={course.id} onExam={onExam} />
    </div>
  </>);
}
