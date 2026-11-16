import {useSound} from '../../state/SoundContext.jsx';

// Быстрый ползунок фоновой музыки в шапке урока.
export default function QuickBackground() {
  const {sound, prefs} = useSound(), vol = prefs.ch.background.vol;
  return (
    <label className="quick-bg">Fon{' '}
      <input type="range" min="0" max="100" step="5" value={vol} data-snd="background" id="snd-quick-background" aria-label="Fon musiqasi balandligi" aria-valuetext={`${vol}%`}
        onChange={e => sound.setVolume('background', e.target.value)} />
    </label>
  );
}
