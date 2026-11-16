import {useSound} from '../../state/SoundContext.jsx';

// 7 строк: общий + 6 каналов. Ползунок меняет громкость, кнопка — mute. Закрытая панель получает hidden,
// поэтому её элементы выпадают из Tab-цикла (focusables() пропускает всё внутри [hidden]).
export const SND = [['master', 'Umumiy'], ['background', 'Fon musiqasi'], ['click', 'Bosish'], ['select', 'Tanlash'], ['correct', 'To‘g‘ri javob'], ['win', 'G‘alaba'], ['lose', 'Mag‘lubiyat']];
export const entryOf = (prefs, k) => (k === 'master' ? prefs.master : prefs.ch[k]);

export default function SoundPanel({where}) {
  const {sound, prefs, open} = useSound();
  return (
    <div className="sound-panel" id={`sound-panel-${where}`} role="group" aria-label="Ovoz sozlamalari" hidden={!open}>
      {SND.map(([k, label]) => {
        const e = entryOf(prefs, k);
        return (
          <div className="sound-row" key={k}>
            <label htmlFor={`snd-${where}-${k}`}>{label}</label>
            <input id={`snd-${where}-${k}`} type="range" min="0" max="100" step="5" value={e.vol} data-snd={k} aria-valuetext={`${e.vol}%`}
              onChange={ev => sound.setVolume(k, ev.target.value)}
              onPointerUp={() => sound.sample(k)} onKeyUp={ev => { if (ev.key.startsWith('Arrow') || ev.key === 'Home' || ev.key === 'End' || ev.key.startsWith('Page')) sound.sample(k); }} />
            <output data-snd-out={k}>{e.vol}%</output>
            <button type="button" className="snd-mute" data-snd-mute={k} data-sfx="none" aria-pressed={e.muted} aria-label={`${label}: ovozni o‘chirish`}
              onClick={() => sound.toggleMuted(k)}>{e.muted ? '🔇' : '🔊'}</button>
          </div>
        );
      })}
    </div>
  );
}
