import ProductCard from './shop/ProductCard.jsx';
import RegenLabel from './shop/RegenLabel.jsx';

// Цены дублируют серверные (engine.buy) только для показа; списывает и проверяет всё сервер.
export const PRODUCTS = [
  {id: 'heart', icon: '❤️', name: 'Bitta jon', text: 'Sayohatni davom ettirish uchun +1 jon.', cost: 150},
  {id: 'refill', icon: '💝', name: 'To‘liq quvvat', text: 'Jonlaringni maksimum 5 tagacha to‘ldir.', cost: 500},
  {id: 'freeze', icon: '🧊', name: 'Strayk himoyasi', text: 'Bir kunni o‘tkazib yuborsang, straykingni bir marta saqlaydi. Oldindan xarid qil.', cost: 300}
];

export default function ShopPage({regenAt, serverNow, onBuy}) {
  return (<>
    <section className="page-heading"><div className="eyebrow">SAYOHATINGGA YORDAMCHILAR</div><h1>Kichik yordam, <span>katta davom.</span></h1><p>Tangalarni o‘rganib top. Kerak paytda kuchingni tikla.</p></section>
    <div className="shop-grid">{PRODUCTS.map(x => <ProductCard key={x.id} item={x} onBuy={onBuy} />)}</div>
    <div className="card economy">
      <h3>Tangalar qanday ishlaydi?</h3>
      <p>Yangi level: <b>20 tanga</b>. Har 10-level: <b>30 tanga</b>. Bir bosqichdan jami <b>1 050 tanga</b>. Takroriy level va yakuniy test uchun tanga berilmaydi.</p>
      <p>Jon maksimum 5 ta. Har 30 daqiqada 1 jon tiklanadi. Yozish mashqlaridagi xatolar jon olmaydi. <RegenLabel regenAt={regenAt} serverNow={serverNow} /></p>
      <p>Himoya faqat bitta o‘tkazib yuborilgan kunni qoplaydi. Ikki va undan ko‘p kun o‘tsa, strayk qaytadan boshlanadi.</p>
    </div>
  </>);
}
