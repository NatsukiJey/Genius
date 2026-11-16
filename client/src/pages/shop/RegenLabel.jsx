import {useEffect, useState} from 'react';
import {regenText} from '../../lib/format.js';

// «Keyingi jon: m:ss» — своё обновление раз в секунду, остальной интерфейс не перерисовывается.
export default function RegenLabel({regenAt, serverNow}) {
  const [, tick] = useState(0);
  useEffect(() => { if (!regenAt) return undefined; const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t); }, [regenAt]);
  return <span id="regen-label">{regenText(regenAt, serverNow())}</span>;
}
