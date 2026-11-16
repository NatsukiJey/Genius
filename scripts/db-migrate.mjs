// Применяет схему PostgreSQL вручную: DATABASE_URL=... npm run db:migrate  (см. VERCEL-SETUP.md).
// НЕ запускается при сборке Vercel. Текст ошибки не печатаем: в нём может быть адрес базы.
import {pgPoolDriver} from '../server/store-pg.mjs';
import {migratePg} from '../server/migrate-pg.mjs';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error('XATO: DATABASE_URL berilmagan. Neon bazasini Vercel Storage orqali ulang yoki o‘zingizning .env faylingizdan yuklang (VERCEL-SETUP.md).'); process.exit(1); }
const driver = await pgPoolDriver(url, {max: 1});
try {
  const r = await migratePg(driver);
  console.log(r.applied.length ? `Qo‘llandi: ${r.applied.join(', ')}` : 'Yangi migratsiya yo‘q: baza allaqachon yangilangan.', `(sxema versiyasi ${r.current})`);
} catch (e) {
  console.error(`Migratsiya xatosi (${e && e.name}${e && e.code ? ' ' + e.code : ''}). Ulanishni tekshiring.`); process.exitCode = 1;
} finally { await driver.close(); }
