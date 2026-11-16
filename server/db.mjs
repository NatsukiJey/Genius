// SQLite (node:sqlite, встроенный). Схема версионируется через PRAGMA user_version.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, chmodSync} from 'node:fs';
import path from 'node:path';
import {upgradeState} from '../shared/engine.mjs';

export const SCHEMA_V1 = `
CREATE TABLE users(
 id INTEGER PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
 pw_hash BLOB NOT NULL, pw_salt BLOB NOT NULL, pw_params TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE sessions(
 token_hash BLOB PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE progress(
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 state TEXT NOT NULL, rev INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE lessons(
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 tier INTEGER NOT NULL, level INTEGER NOT NULL, exam INTEGER NOT NULL, idx INTEGER NOT NULL,
 correct INTEGER NOT NULL, mistakes INTEGER NOT NULL, phase TEXT NOT NULL,
 last_answer TEXT, started_at INTEGER NOT NULL, touched_at INTEGER NOT NULL);`;

export function openDb(dbPath = ':memory:') {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    mkdirSync(dir, {recursive: true, mode: 0o700});
    chmodSync(dir, 0o700); // даже если папка уже была (только папка выбранной БД, не родители); ошибка = не стартуем
  }
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') { try { chmodSync(dbPath, 0o600); } catch {} }
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  try {
    const v = db.prepare('PRAGMA user_version').get().user_version;
    if (v < 1) { db.exec('BEGIN'); db.exec(SCHEMA_V1); db.exec('PRAGMA user_version=1'); db.exec('COMMIT'); }
    if (v < 2) migrateV2(db);
  } catch (e) { try { db.close(); } catch {} throw e; }
  return db;
}

// Схема 2: курсы. ВСЁ в одной транзакции: колонка lessons.course (старые уроки = 'en'), каждая строка progress
// переводится в состояние v2 (upgradeState, без потерь), затем user_version=2. Нечитаемый JSON (или не объект,
// или неизвестная версия) бросает ошибку -> ROLLBACK -> база остаётся ровно как была (версия 1), ничего молча не теряется.
// Повторный запуск не нужен и безопасен: при user_version>=2 эта функция не вызывается; upgradeState идемпотентен.
export function migrateV2(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec("ALTER TABLE lessons ADD COLUMN course TEXT NOT NULL DEFAULT 'en'");
    const upd = db.prepare('UPDATE progress SET state=? WHERE user_id=?');
    for (const r of db.prepare('SELECT user_id,state FROM progress').all()) {
      let st; try { st = JSON.parse(r.state); } catch { throw new Error(`migration: invalid progress JSON for user ${r.user_id}`); }
      upd.run(JSON.stringify(upgradeState(st)), r.user_id);
    }
    db.exec('PRAGMA user_version=2');
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

// node:sqlite не имеет transaction(). BEGIN IMMEDIATE -> fn -> COMMIT.
// ВАЖНО: внутри fn нельзя использовать await (тогда транзакция атомарна в процессе).
export function makeTx(db) {
  return fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  };
}
