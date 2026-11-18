// Постоянный элемент #banner (role=alert): виден, пока сервер недоступен. Скрыт атрибутом hidden — DOM не пересоздаётся.
// kind: 'write' — действие/ответ не подтверждены сервером; 'read' — не удалось только обновить данные (введённое и урок на месте).
export default function OfflineBanner({show, onRetry, kind = 'write'}) {
  return (
    <div id="banner" role="alert" hidden={!show}>
      {show && (<>
        <span>{kind === 'read' ? 'Aloqa vaqtincha yo‘q — ma’lumotlar yangilanmadi. Kiritganingiz joyida turibdi.' : 'Server bilan aloqa yo‘q — natija saqlanmadi.'}</span>
        <button type="button" data-action="retry-net" onClick={onRetry}>Qayta urinish</button>
      </>)}
    </div>
  );
}
