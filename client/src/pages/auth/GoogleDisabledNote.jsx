// Google-вход пока не настроен на сервере: кнопка честно выключена, обещаний нет.
export default function GoogleDisabledNote({variant}) {
  if (variant === 'login') return (
    <div className="google-box">
      <button type="button" className="google-btn" disabled aria-describedby="google-note">Google orqali kirish — hali sozlanmagan</button>
      <p id="google-note" className="google-note">Google bilan kirish hozircha ishlamaydi: server uchun Google OAuth hali sozlanmagan.</p>
      <details className="forgot"><summary>Parolni unutdingizmi?</summary><p>Parollar serverda faqat xesh ko‘rinishida saqlanadi va hech qachon pochta orqali yuborilmaydi. Hozircha parolni tiklash imkoni yo‘q. Google orqali kirish va tiklash kelajakda, OAuth sozlangach va sayt HTTPS’da ishlaganda qo‘shilishi mumkin — bu hali va’da emas. Mavjud hisoblar login va parol bilan avvalgidek ishlaydi.</p></details>
    </div>
  );
  return (
    <div className="google-box">
      <button type="button" className="google-btn" disabled aria-describedby="google-note">Google bilan bog‘lash — hali sozlanmagan</button>
      <p id="google-note" className="google-note">Google OAuth bu serverda sozlanmagan, shuning uchun hisobni Google bilan bog‘lab bo‘lmaydi. Parolingiz xesh ko‘rinishida saqlanadi va pochtaga yuborilmaydi. Google orqali kirish/tiklash kelajak rejasi: buning uchun sozlangan OAuth kliyent va HTTPS kerak. Hozir login va parol avvalgidek ishlaydi.</p>
    </div>
  );
}
