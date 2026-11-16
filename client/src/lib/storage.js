// localStorage может быть недоступен (приватный режим, запрет cookie): тогда работаем «вхолостую», а не падаем.
export function safeStorage() {
  try { const s = window.localStorage; s.getItem('jenius.probe'); return s; }
  catch { return {getItem: () => null, setItem() {}, removeItem() {}}; }
}
