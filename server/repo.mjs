// ВСЕ SQL-запросы приложения (пользователи, сессии, прогресс, уроки) — в одном месте и для двух баз.
// exec(sql, params) -> Promise<rows[]>; в SQL пишем `?` (для PostgreSQL адаптер превращает их в $1,$2…).
// Игровые правила здесь НЕ живут: они только в server/game.mjs и shared/engine.mjs.
export function makeRepo(exec, {pg = false} = {}) {
  const FU = pg ? ' FOR UPDATE' : '';          // PostgreSQL: блокировка строки до конца транзакции (SQLite: мьютекс хранилища)
  const SEQ = pg ? 'seq' : 'rowid';            // порядок вставки сессий
  const one = async (sql, p) => (await exec(sql, p))[0] ?? null;
  return {
    sql: exec,
    userByKey: key => one('SELECT * FROM users WHERE username_key=?', [key]),
    // -> id или null, если ник уже занят (ON CONFLICT: одинаково в SQLite и PostgreSQL)
    async insertUser(u) {
      const r = await one('INSERT INTO users(username,username_key,pw_hash,pw_salt,pw_params,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(username_key) DO NOTHING RETURNING id', [u.nick, u.key, u.hash, u.salt, u.params, u.t]);
      return r ? Number(r.id) : null;
    },
    lockUser: id => one(`SELECT id FROM users WHERE id=?${FU}`, [id]),

    insSession: (hash, userId, t, exp) => exec('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,last_seen) VALUES(?,?,?,?,?)', [hash, userId, t, exp, t]),
    session: hash => one('SELECT s.user_id,s.expires_at,s.last_seen,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?', [hash]),
    delSession: hash => exec('DELETE FROM sessions WHERE token_hash=?', [hash]),
    touchSession: (t, exp, hash) => exec('UPDATE sessions SET last_seen=?,expires_at=? WHERE token_hash=?', [t, exp, hash]),
    purgeSessions: t => exec('DELETE FROM sessions WHERE expires_at<=?', [t]),
    capSessions: userId => exec(`DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC, ${SEQ} DESC LIMIT 10)`, [userId, userId]),

    progress: userId => one(`SELECT state,rev FROM progress WHERE user_id=?${FU}`, [userId]),
    saveProgress: (userId, json, now) => exec('UPDATE progress SET state=?,rev=rev+1,updated_at=? WHERE user_id=?', [json, now, userId]),
    insertProgress: (userId, json, now) => exec('INSERT INTO progress(user_id,state,rev,updated_at) VALUES(?,?,1,?)', [userId, json, now]),

    lesson: userId => one('SELECT * FROM lessons WHERE user_id=?', [userId]),
    deleteLesson: userId => exec('DELETE FROM lessons WHERE user_id=?', [userId]),
    insertLesson: l => exec('INSERT INTO lessons(id,user_id,course,tier,level,exam,idx,correct,mistakes,phase,last_answer,started_at,touched_at) VALUES(?,?,?,?,?,?,0,0,0,?,NULL,?,?)', [l.id, l.userId, l.course, l.tier, l.level, l.exam, l.phase, l.now, l.now]),
    saveLesson: (idx, correct, mistakes, phase, lastAnswer, touchedAt, id) => exec('UPDATE lessons SET idx=?,correct=?,mistakes=?,phase=?,last_answer=?,touched_at=? WHERE id=?', [idx, correct, mistakes, phase, lastAnswer, touchedAt, id])
  };
}
