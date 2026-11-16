// Один кружок карты: пройден / текущий / закрыт. Закрытый — настоящий disabled, поэтому недоступен и клавиатуре.
export default function LevelNode({level, i, completed, onStart}) {
  const done = completed.length, finished = completed.includes(level), current = level === done + 1, locked = level > done + 1;
  return (
    <div className={`map-row pos-${i % 8}`}>
      {current && <div className="you-are-here">SEN SHU YERDASAN ↓</div>}
      <button type="button" className={`level ${finished ? 'finished' : current ? 'current' : 'locked'}`} data-level={level} disabled={locked}
        aria-label={`${level}-level${finished ? ', tugatilgan' : locked ? ', qulflangan' : ''}`} onClick={() => onStart(level)}>
        <small>{level}-LEVEL</small><span>{finished ? '✓' : locked ? '▣' : level % 10 === 0 ? '♜' : '★'}</span>
      </button>
      {level % 10 === 0 && <span className="milestone">{level / 10}-bekat · Sen uddalaysan!</span>}
    </div>
  );
}
