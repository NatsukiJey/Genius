// Тонкие обёртки над call(): названия понятны, адреса и тела — в одном месте.
export const endpoints = call => ({
  me: (quiet = true, force = false) => call('/api/me', undefined, quiet, {force}),
  refresh: (force = false) => call('/api/me', undefined, false, {force}),
  login: body => call('/api/login', body, true),
  register: body => call('/api/register', body, true),
  logout: () => call('/api/logout', {}, true),
  course: course => call('/api/course', {course}),
  tier: (tier, course) => call('/api/tier', {tier, course}),
  startLesson: body => call('/api/lesson/start', body),
  answer: (lessonId, index, given) => call('/api/lesson/answer', {lessonId, index, given}),
  retryLesson: lessonId => call('/api/lesson/retry', {lessonId}),
  abandon: lessonId => call('/api/lesson/abandon', {lessonId}),
  purchase: item => call('/api/shop/buy', {item})
});
