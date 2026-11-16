import CourseChooser from './CourseChooser.jsx';
import ConfirmCourseDialog from './ConfirmCourseDialog.jsx';
import TierPicker from './TierPicker.jsx';
import LessonDialog from './LessonDialog.jsx';
import ReviewDialog from './ReviewDialog.jsx';
import ResultScreen from './ResultScreen.jsx';

// Один постоянный контейнер #modal: показывает ровно один диалог (по dialog.kind) или ничего.
export default function DialogHost({dialog, state, session, dispatch, actions, onClose}) {
  let body = null;
  switch (dialog?.kind) {
    case 'courses': body = <CourseChooser key="courses" canClose={!!state.activeCourse} onChoose={actions.chooseCourse} onClose={onClose} />; break;
    case 'confirm-course': body = <ConfirmCourseDialog key="confirm" courseId={dialog.id} onConfirm={actions.doCourse} onCancel={onClose} />; break;
    case 'tiers': body = <TierPicker key="tiers" course={dialog.course} canClose={state.tier !== null} onPick={actions.pickTier} onClose={onClose} />; break;
    case 'session':
      if (session) body = session.phase === 'review'
        ? <ReviewDialog key="review" correct={session.correct} onRetry={actions.retryLesson} onExit={actions.exitLesson} />
        : <LessonDialog key="lesson" session={session} dispatch={dispatch} onCheck={actions.check} onNext={actions.next} onExit={actions.exitLesson} />;
      break;
    case 'result': body = <ResultScreen key="result" result={dialog} onDone={onClose} />; break;
    default: break;
  }
  return <div id="modal">{body}</div>;
}
