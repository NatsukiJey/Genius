export default function ProductCard({item, onBuy}) {
  return (
    <article className="card product">
      <div className="product-icon">{item.icon}</div>
      <h2>{item.name}</h2>
      <p>{item.text}</p>
      <button type="button" className="primary" data-buy={item.id} onClick={() => onBuy(item.id)}>🪙 {item.cost} tanga</button>
    </article>
  );
}
