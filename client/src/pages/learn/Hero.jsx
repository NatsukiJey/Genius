import Mascot from '../../components/layout/Mascot.jsx';

export default function Hero({course, onStart}) {
  const C = course;
  return (
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><span></span> YANGI TIL. YANGI IMKONIYATLAR.</div>
        <h1>Katta orzular,<br /><span>kichik qadamlardan.</span></h1>
        <p>{C.name.split(' ')[0]} tilini yodlama — kashf qil. Qiziqarli savollar,<br className="desktop" /> yangi so‘zlar va har kuni kichik bir g‘alaba.</p>
        <button type="button" className="primary" data-action="start" onClick={onStart}>Tekin o‘qish <span>↗</span></button>
        <div className="hero-meta"><span>✓ Mutlaqo bepul</span><span>✓ Kuniga 5 daqiqa</span></div>
      </div>
      <div className="hero-art">
        <span className="float-label label-a" lang={C.id}>{C.id === 'ru' ? 'Привет!' : 'Hello!'} 👋</span>
        <span className="float-label label-b">Salom!</span>
        <div className="orbit orbit-one"></div><div className="orbit orbit-two"></div>
        <span className="spark spark-a">✦</span><span className="spark spark-b">✧</span>
        <Mascot />
        <div className="art-ground"></div>
        <div className="art-badge">✦ SEN BUNI UDDALAYSAN</div>
      </div>
    </section>
  );
}
