const WEEK = ['D', 'S', 'C', 'P', 'J', 'S', 'Y'];

export default function StreakCard({streak, onShop}) {
  const today = (new Date().getDay() + 6) % 7;   // понедельник = 0
  return (
    <div className="card streak-card">
      <div className="card-title"><h3>Olovni so‘ndirma!</h3><span>🔥</span></div>
      <div className="streak-number">{streak} <small>kunlik strayk</small></div>
      <p>Har kuni yangi levelni tugat va odatingni mustahkamla.</p>
      <div className="week">{WEEK.map((d, i) => <span key={i} className={i === today ? 'today' : ''}>{d}</span>)}</div>
      <button type="button" className="text-link" data-page="shop" onClick={onShop}>Straykni himoyalash →</button>
    </div>
  );
}
