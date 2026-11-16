// Первый запуск без сервера: приложению нечего показать, потому что прогресс хранится на сервере.
export default function OfflineScreen({onReload}) {
  return (
    <div className="auth-wrap"><section className="card auth-card">
      <h1>Server bilan aloqa yo‘q</h1>
      <p className="auth-lead">Natijalar serverda saqlanadi, shuning uchun ilova ishlashi uchun server kerak.</p>
      <button className="primary" type="button" data-action="reload" onClick={onReload}>Qayta urinish</button>
    </section></div>
  );
}
