import {useState} from 'react';
import {courseLessonWords} from '@shared/data.mjs';

// Знакомство со словами: нажми на карточку — увидишь перевод.
export default function WordIntro({course, tier, level, onStart}) {
  const [shown, setShown] = useState(() => new Set());
  const words = courseLessonWords(course, tier, level);
  return (<>
    <div className="eyebrow">{level}-LEVEL · YANGI SO‘ZLAR</div>
    <h2>Avval tanishib olamiz.</h2>
    <p>Tarjimasini ko‘rish uchun so‘z ustiga bos.</p>
    <div className="word-list">
      {words.map((w, i) => (
        <button key={i} type="button" className={`word-card ${shown.has(i) ? 'revealed' : ''}`.trim()} data-word={w.uz} data-sfx="select"
          onClick={() => setShown(new Set(shown).add(i))}>
          <strong lang={course}>{w.t}</strong><span>{shown.has(i) ? w.uz : 'Tarjimasini ochish ↗'}</span>
        </button>
      ))}
    </div>
    <button type="button" className="primary wide" data-action="quiz" onClick={onStart}>Tayyorman, boshladik →</button>
  </>);
}
