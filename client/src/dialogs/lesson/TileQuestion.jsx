export default function TileQuestion({tiles, chosen, answered, onPick, onReset}) {
  return (<>
    <div id="assembled" className="assembled" aria-live="polite">{chosen.length ? chosen.map(i => tiles[i].v).join('') : 'Harflarni tanlang…'}</div>
    <div className="tiles">
      {tiles.map((x, i) => <button key={i} type="button" data-tile={i} data-sfx="select" disabled={answered || chosen.includes(i)} onClick={() => onPick(i)}>{x.v === ' ' ? '␣' : x.v}</button>)}
    </div>
    <button type="button" className="text-link" data-action="reset-tiles" onClick={onReset}>Qayta yig‘ish ↻</button>
  </>);
}
