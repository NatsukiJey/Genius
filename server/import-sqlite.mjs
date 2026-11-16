// НЕОБЯЗАТЕЛЬНЫЙ ручной перенос аккаунтов из локальной SQLite-базы в ПУСТОЙ PostgreSQL. Автоматически не вызывается никогда.
// Переносит users + progress + текущий урок (пароли остаются хешами scrypt). Сессии не переносятся: нужно войти заново.
export async function importSqliteToPg(src, driver) {
  const v = src.prepare('PRAGMA user_version').get().user_version;
  if (v < 2) throw new Error('Eski SQLite bazasi: avval lokal serverni (npm start) bir marta ishga tushiring, u bazani yangilaydi.');
  const users = src.prepare('SELECT * FROM users ORDER BY id').all(), prog = new Map(src.prepare('SELECT * FROM progress').all().map(r => [r.user_id, r]));
  const lessons = new Map(src.prepare('SELECT * FROM lessons').all().map(r => [r.user_id, r]));
  return driver.transaction(async tx => {
    const n = Number((await tx.query('SELECT count(*) AS n FROM users')).rows[0].n);
    if (n > 0) throw new Error('PostgreSQL bazasi bo‘sh emas: import to‘xtatildi (mavjud akkauntlar buzilmasligi uchun).');
    let nu = 0, nl = 0;
    for (const u of users) {
      await tx.query('INSERT INTO users(id,username,username_key,pw_hash,pw_salt,pw_params,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [u.id, u.username, u.username_key, Buffer.from(u.pw_hash), Buffer.from(u.pw_salt), u.pw_params, u.created_at]);
      const p = prog.get(u.id);
      if (p) await tx.query('INSERT INTO progress(user_id,state,rev,updated_at) VALUES($1,$2,$3,$4)', [u.id, p.state, p.rev, p.updated_at]);
      const l = lessons.get(u.id);
      if (l) { await tx.query('INSERT INTO lessons(id,user_id,course,tier,level,exam,idx,correct,mistakes,phase,last_answer,started_at,touched_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [l.id, l.user_id, l.course, l.tier, l.level, l.exam, l.idx, l.correct, l.mistakes, l.phase, l.last_answer, l.started_at, l.touched_at]); nl++; }
      nu++;
    }
    if (nu) await tx.query("SELECT setval(pg_get_serial_sequence('users','id'), (SELECT max(id) FROM users))");
    return {users: nu, lessons: nl};
  });
}
