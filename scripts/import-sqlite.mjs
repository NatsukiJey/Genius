// Ручной перенос: DATABASE_URL=... npm run db:import-sqlite -- --from data/jenius.db --yes
// Без --yes ничего не делает. Источник открывается только для чтения. Перед этим выполните npm run db:migrate.
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {pgPoolDriver} from '../server/store-pg.mjs';
import {importSqliteToPg} from '../server/import-sqlite.mjs';

const args = process.argv.slice(2), i = args.indexOf('--from');
const from = i >= 0 ? args[i + 1] : null, url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!from || !args.includes('--yes')) { console.error('Foydalanish: npm run db:import-sqlite -- --from data/jenius.db --yes\nBu buyruq lokal akkauntlarni bo‘sh PostgreSQL bazasiga ko‘chiradi. --yes bo‘lmasa hech narsa qilmaydi.'); process.exit(1); }
if (!url) { console.error('XATO: DATABASE_URL berilmagan.'); process.exit(1); }
const src = new DatabaseSync(path.resolve(from), {readOnly: true}), driver = await pgPoolDriver(url, {max: 1});
try { const r = await importSqliteToPg(src, driver); console.log(`Ko‘chirildi: ${r.users} akkaunt, ${r.lessons} faol dars. Sessiyalar ko‘chirilmaydi: qayta kiring.`); }
catch (e) { console.error(`Import to‘xtadi: ${e && e.message && !/:\/\//.test(e.message) ? e.message : e && e.name}`); process.exitCode = 1; }
finally { src.close(); await driver.close(); }
