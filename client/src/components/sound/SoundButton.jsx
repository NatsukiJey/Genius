import {useSound} from '../../state/SoundContext.jsx';
import SoundPanel from './SoundPanel.jsx';

// Кнопка 🔊 + панель. where = main | lesson | auth (разные id, одно общее состояние «открыто»).
export default function SoundButton({where}) {
  const {prefs, open, setOpen, toggleBtn} = useSound();
  return (
    <div className="sound-wrap">
      <button type="button" className="icon-btn" data-action="sound-toggle" aria-label="Ovoz sozlamalari" aria-expanded={open} aria-controls={`sound-panel-${where}`}
        onClick={e => { toggleBtn.current = e.currentTarget; setOpen(!open); }}>
        {prefs.master.muted ? '🔇' : '🔊'}
      </button>
      <SoundPanel where={where} />
    </div>
  );
}
