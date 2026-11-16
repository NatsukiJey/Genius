export default function ChoiceQuestion({choices, selected, answered, onSelect}) {
  return (
    <div className="choices">
      {choices.map((c, i) => (
        <button key={i} type="button" className={`choice ${selected === i ? 'selected' : ''}`.trim()} data-choice={i} data-sfx="select" disabled={answered} onClick={() => onSelect(i)}>
          <small>{i + 1}</small>{c}
        </button>
      ))}
    </div>
  );
}
