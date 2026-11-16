// Первый запуск без рабочего сервера: приложению нечего показать, потому что прогресс хранится на сервере.
// problem — честная причина (сообщение сервера про DATABASE_URL/миграцию или «API вернул HTML»), чтобы экран не был загадкой.
export default function OfflineScreen({onReload, problem}) {
  return (
    <div className="auth-wrap"><section className="card auth-card">
      <h1>Server bilan aloqa yo‘q</h1>
      <p className="auth-lead">Natijalar serverda saqlanadi, shuning uchun ilova ishlashi uchun server kerak.</p>
      {problem && <p className="boot-detail" data-problem>{problem}</p>}
      <button className="primary" type="button" data-action="reload" onClick={onReload}>Qayta urinish</button>
    </section></div>
  );
}
