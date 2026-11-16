// «Keyingi jon: 12:05» — сколько осталось до восстановления жизни.
export function regenText(regenAt, serverNow) {
  if (!regenAt) return '';
  const left = Math.max(0, Math.ceil((regenAt - serverNow) / 1000));
  return `Keyingi jon: ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}
export const secondsLeft = (retryAt, serverNow) => Math.max(1, Math.ceil((retryAt - serverNow) / 1000));
