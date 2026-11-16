export default function GoalCard({doneToday}) {
  const v = doneToday ? 1 : 0;
  return (
    <div className="card daily">
      <div className="card-title"><h3>Kunlik maqsad</h3><span>☀</span></div>
      <p>Bugun o‘zingga sarmoya kirit.</p>
      <div className="goal"><span>⚡</span><div><strong>{v} / 1 level</strong><small>Kichik odat, katta o‘zgarish.</small></div></div>
      <progress className="progress-track" value={v} max="1" aria-label="Kunlik maqsad"></progress>
    </div>
  );
}
