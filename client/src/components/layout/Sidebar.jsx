import Mascot from './Mascot.jsx';

const NAV = [['learn', '◈', 'O‘rganish'], ['shop', '▣', 'Shop', 'YANGI'], ['account', '☺', 'Hisob'], ['report', '☏', 'Bizga yozing']];

export default function Sidebar({page, username, onNavigate, onHome}) {
  return (
    <aside className="sidebar">
      <a className="brand" href="#" data-action="home" onClick={e => { e.preventDefault(); onHome(); }}><span className="brand-icon">j</span> jenius<span className="brand-dot">.</span></a>
      <div className="nav-caption">SENING SAYOHATING</div>
      <nav>
        {NAV.map(([id, icon, label, badge]) => (
          <button key={id} type="button" data-page={id} className={`nav-item ${page === id ? 'active' : ''}`.trim()} aria-current={page === id ? 'page' : undefined} onClick={() => onNavigate(id)}>
            <span>{icon}</span> {label}{badge && <> <em>{badge}</em></>}
          </button>
        ))}
      </nav>
      <div className="sidebar-note"><Mascot size="mini" /><strong>Kichik qadamlar.<br />Katta imkoniyatlar.</strong><p>Bugungi 5 daqiqa — ertangi yangi sen.</p></div>
      <div className="profile"><span>{username[0].toUpperCase()}</span><div><strong>{username}</strong><small>Natijalar serverda saqlanadi</small></div></div>
    </aside>
  );
}
