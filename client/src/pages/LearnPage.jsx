import {COURSES} from '@shared/data.mjs';
import Hero from './learn/Hero.jsx';
import LevelMap from './learn/LevelMap.jsx';
import GoalCard from './learn/GoalCard.jsx';
import StreakCard from './learn/StreakCard.jsx';
import TipCard from './learn/TipCard.jsx';

// Главная: герой, карта 50 уровней выбранного курса и уровня, правая колонка.
export default function LearnPage({state, today, onStart, onStartLevel, onExam, onTiers, onShop}) {
  const course = COURSES[state.activeCourse || 'en'], t = state.tier ?? 0, T = course.tiers[t];
  return (<>
    <Hero course={course} onStart={onStart} />
    <div className="learning-grid">
      <section className="journey">
        <div className="section-top">
          <div><div className="eyebrow muted">SENING YO‘LING</div><h2>Bilim sari sayohat <span>↗</span></h2></div>
          <button type="button" className="tier-select" data-action="tiers" onClick={onTiers}>{T.icon} {T.name} ⌄</button>
        </div>
        <LevelMap course={course} tier={t} completed={state.completed[t]} passed={state.passed[t]} onStart={onStartLevel} onExam={onExam} />
      </section>
      <aside className="right-rail">
        <GoalCard doneToday={state.lastDay === today} />
        <StreakCard streak={state.streak} onShop={onShop} />
        <TipCard />
      </aside>
    </div>
  </>);
}
