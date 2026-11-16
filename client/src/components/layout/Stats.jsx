import {useGame} from '../../state/GameContext.jsx';

// Серия, монеты, жизни — общие для обоих курсов. Значения читаются прямо из серверной копии.
export default function Stats() {
  const {snap: {state}} = useGame();
  return (
    <div className="stats">
      <span title="Kunlik strayk">🔥 <b data-stat="streak">{state.streak}</b></span>
      <span title="Tangalar">🪙 <b data-stat="coins">{state.coins}</b></span>
      <span title="Jonlar">♥ <b data-stat="hearts">{state.hearts}/5</b></span>
    </div>
  );
}
