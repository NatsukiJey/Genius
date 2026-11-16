import {COURSES} from '@shared/data.mjs';

export default function CourseSwitch({active, onChoose}) {
  return (
    <div className="course-switch" role="group" aria-label="Kursni tanlash">
      {Object.values(COURSES).map(c => (
        <button key={c.id} type="button" className="course-btn" data-course={c.id} aria-pressed={active === c.id}
          aria-label={`${c.name}${active === c.id ? ' (tanlangan)' : ''}`} onClick={() => onChoose(c.id)}>
          <span aria-hidden="true">{c.flag}</span> {c.short}
        </button>
      ))}
    </div>
  );
}
