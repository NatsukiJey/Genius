// Постоянный элемент #banner (role=alert): виден, пока сервер недоступен. Скрыт атрибутом hidden — DOM не пересоздаётся.
// kind: 'write' — действие/ответ не подтверждены сервером; 'read' — не удалось только обновить данные (введённое и урок на месте).
// diag: {kind, status, ref} — безопасная причина сбоя (без cookie/паролей/текста ошибок), чтобы «ошибка сети» не была загадкой.
export const DIAG_TEXT = {
  timeout: 'server vaqtida javob bermadi (timeout)',
  network: 'internet yo‘q yoki so‘rov yetib bormadi',
  server_unavailable: 'server vaqtincha mavjud emas',
  server_db_connection: 'baza bilan aloqa uzildi',
  server_db_timeout: 'baza javob bermadi (timeout)',
  server_db_schema: 'baza sxemasi tayyor emas',
  server_db_auth: 'bazaga kirish rad etildi',
  server_error: 'serverda xatolik',
  bad_response: 'server noto‘g‘ri javob berdi'
};
export const diagLine = d => d && `${DIAG_TEXT[d.kind] || 'noma’lum xato'}${d.status ? ` · HTTP ${d.status}` : ''}${d.ref ? ` · ref ${d.ref}` : ''}`;
export default function OfflineBanner({show, onRetry, kind = 'write', diag = null}) {
  return (
    <div id="banner" role="alert" hidden={!show}>
      {show && (<>
        <span>{kind === 'read' ? 'Aloqa vaqtincha yo‘q — ma’lumotlar yangilanmadi. Kiritganingiz joyida turibdi.' : 'Server bilan aloqa yo‘q — natija saqlanmadi.'}
          {diag && <small data-diag>Sabab: {diagLine(diag)}</small>}</span>
        <button type="button" data-action="retry-net" onClick={onRetry}>Qayta urinish</button>
      </>)}
    </div>
  );
}
