// Настоящий PostgreSQL в WASM (PGlite, в памяти) за тем же интерфейсом драйвера, что и pg.Pool в production.
// Это реальный SQL-движок: миграции, транзакции, FOR UPDATE, advisory-lock, ON CONFLICT выполняются по-настоящему.
// Ограничение: PGlite — ОДНО соединение; запросы выстраиваются в очередь, поэтому настоящий параллелизм
// нескольких процессов/соединений (реальные блокировки между клиентами) здесь доказать нельзя.
import {PGlite} from '@electric-sql/pglite';
import {migratePg} from '../server/migrate-pg.mjs';

export async function pgliteDriver() {
  const db = new PGlite({parsers: {20: v => Number(v)}});
  await db.waitReady;
  const driver = {
    db, calls: [],
    query: async (sql, params) => { driver.calls.push(sql); return db.query(sql, params); },
    transaction: fn => db.transaction(tx => fn({query: (s, p) => { driver.calls.push(s); return tx.query(s, p); }, exec: s => tx.exec(s)})),
    close: () => db.close()
  };
  return driver;
}
export async function migratedPglite() { const d = await pgliteDriver(); await migratePg(d); return d; }
