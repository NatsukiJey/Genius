// Постоянный элемент #banner (role=alert): виден, пока сервер недоступен. Скрыт атрибутом hidden — DOM не пересоздаётся.
export default function OfflineBanner({show, onRetry}) {
  return (
    <div id="banner" role="alert" hidden={!show}>
      {show && (<>
        <span>Server bilan aloqa yo‘q — natija saqlanmadi.</span>
        <button type="button" data-action="retry-net" onClick={onRetry}>Qayta urinish</button>
      </>)}
    </div>
  );
}
