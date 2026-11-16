-- Схема Jenius для PostgreSQL (Neon). Идемпотентна: повторный запуск ничего не ломает.
-- Применяется ТОЛЬКО вручную: npm run db:migrate (см. VERCEL-SETUP.md). При сборке не запускается.
-- Время хранится в миллисекундах (BIGINT), как и в SQLite-версии; состояние игры — JSON как TEXT
-- (именно текст, чтобы сервер мог сравнить «изменилось ли», как в SQLite).
CREATE TABLE IF NOT EXISTS users(
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  pw_hash BYTEA NOT NULL,
  pw_salt BYTEA NOT NULL,
  pw_params TEXT NOT NULL,
  created_at BIGINT NOT NULL);

CREATE TABLE IF NOT EXISTS sessions(
  seq BIGSERIAL,
  token_hash BYTEA PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  last_seen BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS progress(
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  rev BIGINT NOT NULL,
  updated_at BIGINT NOT NULL);

CREATE TABLE IF NOT EXISTS lessons(
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  course TEXT NOT NULL DEFAULT 'en',
  tier INTEGER NOT NULL, level INTEGER NOT NULL, exam INTEGER NOT NULL, idx INTEGER NOT NULL,
  correct INTEGER NOT NULL, mistakes INTEGER NOT NULL, phase TEXT NOT NULL,
  last_answer TEXT, started_at BIGINT NOT NULL, touched_at BIGINT NOT NULL);

-- Счётчики попыток входа/регистрации/отчётов: общие для всех экземпляров serverless-функции.
-- kind 'h' = записанная неудача/попытка, 'r' = временный резерв на время scrypt.
CREATE TABLE IF NOT EXISTS throttle_events(
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  kind CHAR(1) NOT NULL CHECK (kind IN ('h','r')),
  at BIGINT NOT NULL,
  win BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS throttle_key ON throttle_events(key, at);
CREATE INDEX IF NOT EXISTS throttle_at ON throttle_events(at);
