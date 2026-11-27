// jsdom не знает matchMedia: делаем управляемую заглушку (dark: matches, .set(v) — смена системной темы).
export function fakeMedia(dark) {
  const ls = new Set(), mq = {matches: dark, media: '(prefers-color-scheme: dark)', addEventListener: (t, f) => t === 'change' && ls.add(f), removeEventListener: (t, f) => ls.delete(f), set(v) { mq.matches = v; ls.forEach(f => f({matches: v})); }};
  const fn = q => (/prefers-color-scheme: dark/.test(q) ? mq : {matches: false, media: q, addEventListener() {}, removeEventListener() {}});
  fn.mq = mq; return fn;
}

