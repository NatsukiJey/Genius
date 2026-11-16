// Игровая логика на сервере. Браузер присылает только намерения; состояние меняет только этот модуль.
// Все функции синхронные и вызываются внутри tx() — никаких await.
import crypto from 'node:crypto';
import {courseQuestions, isCourse, EXAM_PASS} from '../shared/data.mjs';
import {settle, loseHeart, completeLevel, buy, dayKey, upgradeState, viewState, RETRY_MS} from '../shared/engine.mjs';
import {gradeAnswer} from './grade.mjs';

export const STALE_EXAM_MS = 30 * 60 * 1000, MAX_GIVEN = 200;
const ok = body => ({status: 200, body});
const bad = (status, error, extra = {}) => ({status, error, extra});
const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

export function makeGame({db}) {
  const sql = {
    prog: db.prepare('SELECT state,rev FROM progress WHERE user_id=?'),
    saveProg: db.prepare('UPDATE progress SET state=?,rev=rev+1,updated_at=? WHERE user_id=?'),
    insProg: db.prepare('INSERT INTO progress(user_id,state,rev,updated_at) VALUES(?,?,1,?)'),
    lesson: db.prepare('SELECT * FROM lessons WHERE user_id=?'),
    delLesson: db.prepare('DELETE FROM lessons WHERE user_id=?'),
    insLesson: db.prepare('INSERT INTO lessons(id,user_id,course,tier,level,exam,idx,correct,mistakes,phase,last_answer,started_at,touched_at) VALUES(?,?,?,?,?,?,0,0,0,?,NULL,?,?)'),
    saveLesson: db.prepare('UPDATE lessons SET idx=?,correct=?,mistakes=?,phase=?,last_answer=?,touched_at=? WHERE id=?')
  };
  const lessonView = r => r && {id: r.id, course: r.course, tier: r.tier, level: r.level, exam: !!r.exam, phase: r.phase, index: r.idx, total: r.exam ? 10 : 5, correct: r.correct, mistakes: r.mistakes};

  function load(userId, now) {
    const p = sql.prog.get(userId), before = p.state, state = upgradeState(JSON.parse(before));
    let row = sql.lesson.get(userId);
    settle(state, now);
    if (row && row.exam && row.phase === 'quiz' && now - row.touched_at > STALE_EXAM_MS) { // брошенный экзамен
      state.courses[row.course].retryAt[row.tier] = now + RETRY_MS; row.phase = 'ended'; sql.saveLesson.run(row.idx, row.correct, row.mistakes, 'ended', row.last_answer, row.touched_at, row.id);
    }
    return {userId, state, rev: p.rev, row, before, now};
  }
  function persist(ctx) { // пишем только если что-то изменилось
    const json = JSON.stringify(ctx.state);
    if (json !== ctx.before) { sql.saveProg.run(json, ctx.now, ctx.userId); ctx.rev++; ctx.before = json; }
  }
  const payload = (ctx, extra = {}) => ({state: viewState(ctx.state), rev: ctx.rev, serverNow: ctx.now, today: dayKey(ctx.now),
    lesson: ctx.row && (ctx.row.phase === 'quiz' || ctx.row.phase === 'review') ? lessonView(ctx.row) : null, ...extra});
  const fail = (ctx, r) => { persist(ctx); return {status: r.status, body: {error: r.error, ...r.extra, ...payload(ctx)}}; };
  const done = (ctx, extra) => { persist(ctx); return ok(payload(ctx, extra)); };
  const superseded = ctx => fail(ctx, bad(409, 'lesson_superseded'));

  return {
    createProgress: (userId, state, now) => sql.insProg.run(userId, JSON.stringify(state), now),
    me(userId, now) { const ctx = load(userId, now); return done(ctx); },

    // Выбор / смена курса. Общий кошелёк (жизни, монеты, серия, заморозка) НЕ меняется, прогресс другого курса тоже.
    // Если идёт урок, он явно прекращается (ответ `abandoned`): штраф за брошенный экзамен идёт в курс, где он начат.
    course(userId, b, now) {
      const ctx = load(userId, now), st = ctx.state;
      if (!isCourse(b.course)) return fail(ctx, bad(400, 'bad_course'));
      if (st.activeCourse === b.course) return done(ctx);
      let abandoned = null;
      const row = ctx.row;
      if (row) {
        if (row.phase === 'quiz' || row.phase === 'review') {
          abandoned = {course: row.course, tier: row.tier, level: row.level, exam: !!row.exam, cooldown: false};
          if (row.exam && row.phase === 'quiz') { st.courses[row.course].retryAt[row.tier] = now + RETRY_MS; abandoned.cooldown = true; }
        }
        sql.delLesson.run(userId); ctx.row = null;
      }
      st.activeCourse = b.course;
      return done(ctx, {abandoned});
    },

    tier(userId, b, now) {
      const ctx = load(userId, now), st = ctx.state;
      if (!st.activeCourse) return fail(ctx, bad(409, 'no_course'));
      if (b.course !== undefined && b.course !== st.activeCourse) return fail(ctx, bad(409, 'course_mismatch'));
      if (!isInt(b.tier, 0, 3)) return fail(ctx, bad(400, 'bad_tier'));
      st.courses[st.activeCourse].tier = b.tier; return done(ctx);
    },

    start(userId, b, now) {
      const ctx = load(userId, now), s = ctx.state;
      if (!s.activeCourse) return fail(ctx, bad(409, 'no_course'));
      if (b.course !== undefined && b.course !== s.activeCourse) return fail(ctx, bad(409, 'course_mismatch'));
      const course = s.activeCourse, c = s.courses[course];
      if (!isInt(b.tier, 0, 3) || !isInt(b.level, 1, 50) || (b.exam !== undefined && typeof b.exam !== 'boolean')) return fail(ctx, bad(400, 'bad_request'));
      const exam = !!b.exam;
      if ((c.tier ?? 0) !== b.tier) return fail(ctx, bad(409, 'tier_mismatch'));
      if (!s.hearts) return fail(ctx, bad(403, 'no_hearts'));
      const active = ctx.row && ctx.row.exam && ctx.row.phase === 'quiz' ? ctx.row : null;
      if (exam && active && active.course === course && active.tier === b.tier && active.level === b.level) return done(ctx); // повтор старта того же экзамена: идемпотентно, без штрафа
      const have = c.completed[b.tier].length;
      if (exam) {
        if (b.level !== 50 || have !== 50) return fail(ctx, bad(403, 'exam_locked'));
        if (c.retryAt[b.tier] > now) return fail(ctx, bad(403, 'cooldown', {retryAt: c.retryAt[b.tier]}));
      } else if (b.level > have + 1) return fail(ctx, bad(403, 'level_locked'));
      if (active) s.courses[active.course].retryAt[active.tier] = now + RETRY_MS; // штраф ТОЛЬКО когда действительно заменяем активный экзамен, и именно в его курс
      sql.delLesson.run(userId);
      sql.insLesson.run(crypto.randomUUID(), userId, course, b.tier, b.level, exam ? 1 : 0, 'quiz', now, now);
      ctx.row = sql.lesson.get(userId);
      return done(ctx);
    },

    answer(userId, b, now) {
      const ctx = load(userId, now), row = ctx.row;
      if (typeof b.lessonId !== 'string' || !isInt(b.index, 0, 9) || typeof b.given !== 'string' || b.given.length > MAX_GIVEN) return fail(ctx, bad(400, 'bad_request'));
      if (!row || row.id !== b.lessonId) return superseded(ctx);
      const last = row.last_answer ? JSON.parse(row.last_answer) : null;
      if (last && last.index === b.index && last.given === b.given && b.index === row.idx - 1) return done(ctx, {result: last.result, replay: true}); // повтор: штрафа нет
      if (row.phase !== 'quiz') return fail(ctx, bad(409, 'lesson_not_active'));
      if (b.index !== row.idx) return fail(ctx, bad(409, 'out_of_sync'));
      if (!b.given.trim()) return fail(ctx, bad(400, 'empty_answer'));
      const items = courseQuestions(row.course, row.tier, row.level, !!row.exam), s = row, st = ctx.state, cs = st.courses[row.course]; // курс берём из УРОКА, а не из activeCourse
      const q = items[row.idx];
      {
        const g = gradeAnswer(q, b.given, row.course);
        if(g.ok)s.correct++;else{s.mistakes++;if(!q.type.startsWith('write'))loseHeart(st,now)}
        s.idx++;
        const result = {correct: g.ok, answer: g.answer, note: g.note, typo: g.typo, outcome: 'continue', reward: 0, correctCount: 0, total: items.length};
        if (!st.hearts) { s.phase = 'ended'; result.outcome = 'no_hearts'; if (row.exam) cs.retryAt[row.tier] = now + RETRY_MS; }
        else if (s.idx >= items.length) {
          if (row.exam) {
            if (s.correct >= EXAM_PASS) { cs.passed[row.tier] = true; result.outcome = 'exam_passed'; } else { cs.retryAt[row.tier] = now + RETRY_MS; result.outcome = 'exam_failed'; }
            s.phase = 'done';
          } else if (s.mistakes > 0) { s.phase = 'review'; result.outcome = 'review'; }
          else { result.reward = completeLevel(st, row.course, row.tier, row.level, now); s.phase = 'done'; result.outcome = 'done'; }
        }
        result.correctCount = s.correct;
        sql.saveLesson.run(s.idx, s.correct, s.mistakes, s.phase, JSON.stringify({index: b.index, given: b.given, result}), now, row.id);
        ctx.row = sql.lesson.get(userId);
        return done(ctx, {result});
      }
    },

    retry(userId, b, now) {
      const ctx = load(userId, now), row = ctx.row;
      if (!row || row.id !== b.lessonId) return superseded(ctx);
      if (row.phase !== 'review') return fail(ctx, bad(409, 'lesson_not_active'));
      if (!ctx.state.hearts) return fail(ctx, bad(403, 'no_hearts'));
      sql.saveLesson.run(0, 0, 0, 'quiz', null, now, row.id); ctx.row = sql.lesson.get(userId);
      return done(ctx);
    },

    abandon(userId, b, now) {
      const ctx = load(userId, now), row = ctx.row;
      if (row && row.id !== b.lessonId) return superseded(ctx);
      if (row) { if (row.exam && row.phase === 'quiz') ctx.state.courses[row.course].retryAt[row.tier] = now + RETRY_MS; sql.delLesson.run(userId); ctx.row = null; }
      return done(ctx);
    },

    buy(userId, b, now) {
      const ctx = load(userId, now);
      if (typeof b.item !== 'string') return fail(ctx, bad(400, 'bad_request'));
      const r = buy(ctx.state, b.item, now);
      return done(ctx, {purchase: r});
    }
  };
}
