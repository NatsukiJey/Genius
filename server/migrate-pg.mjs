// Применяет migrations/*.sql к PostgreSQL. Каждая миграция — один раз (таблица schema_migrations),
// всё под одним advisory-lock, поэтому два параллельных запуска не мешают друг другу. Повторный запуск безопасен.
import {readdir, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const LOCK_KEY = 7421905; // произвольное постоянное число, общее для всех запусков миграций Jenius

export async function listMigrations(dir = MIGRATIONS_DIR) {
  const names = (await readdir(dir)).filter(n => /^\d{3}_[\w-]+\.sql$/.test(n)).sort();
  return Promise.all(names.map(async n => ({version: Number(n.slice(0, 3)), name: n, sql: await readFile(path.join(dir, n), 'utf8')})));
}

// -> {applied: [имена применённых сейчас], current: последняя версия}
export async function migratePg(driver, {dir, now = Date.now} = {}) {
  const migrations = await listMigrations(dir), applied = [];
  await driver.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    await tx.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at BIGINT NOT NULL)');
    const done = new Set((await tx.query('SELECT version FROM schema_migrations')).rows.map(r => Number(r.version)));
    for (const m of migrations) {
      if (done.has(m.version)) continue;
      await tx.exec(m.sql);
      await tx.query('INSERT INTO schema_migrations(version,name,applied_at) VALUES($1,$2,$3)', [m.version, m.name, now()]);
      applied.push(m.name);
    }
  });
  const current = migrations.length ? migrations[migrations.length - 1].version : 0;
  return {applied, current};
}
