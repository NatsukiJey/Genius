# CHANGELOG — hisoblar va serverda saqlanadigan progress

## Qo‘shildi
- `server.mjs`: `createServer(opts)` eksport qilinadi (`dbPath`, `now`, `allowedHosts`, `scrypt`, `cookieSecure`, `trustProxy`, `limits`, `telegram`, `fetch`, `log`); `listen` faqat fayl to‘g‘ridan-to‘g‘ri ishga tushirilganda. Telegram sozlamasi (`telegram-config.json`) avvalgidek faqat serverda o‘qiladi.
- `server/db.mjs` (SQLite `node:sqlite`, WAL, `user_version`, `tx()`), `server/auth.mjs` (scrypt, sessiya, cookie, throttle, Host/Origin), `server/nickname.mjs`, `server/game.mjs` (dars/javob/retry/abandon/do‘kon/tier), `server/grade.mjs` (yagona baholash), `server/migrate-local.mjs`.
- Ro‘yxatdan o‘tish/kirish/chiqish, `/login` va `/register` sahifalari, “Hisob” sahifasi, aloqa uzilganda ochiq banner.
- Sinovlar: `tests/api.test.mjs` (20 ta integratsion sinov), `tests/helpers.mjs`.
- `.gitignore`: `data/`, `tests/.data/`, `*.db*`.

## O‘zgardi
- `public/engine.mjs`: `buy(s,item,now)` endi `now` qabul qiladi (fake soat uchun). Boshqa mantiq o‘zgarmadi.
- `public/app.mjs`: brauzer endi hech narsani baholamaydi/saqlamaydi/hisoblamaydi, faqat server javobini ko‘rsatadi. `localStorage`’ga progress yozilmaydi.
- Eski 2 ta “manba matnini tekshiruvchi” sinov (`tests/engine.test.mjs`) endi baholash joylashgan fayllarni (`server/grade.mjs`, `server/game.mjs`) tekshiradi — qoidalar (`write-uz` uchun yumshoq baho, faqat tanlash/yig‘ishda jon ketadi) o‘sha-o‘sha, + brauzer baholamasligi tekshiriladi. Qolgan 22 eski sinov tegilmagan. `tests/direction.test.mjs` o‘zgarmagan.
- Dars, savollar (4×50), tarjima yo‘nalishlari va o‘zbekcha yumshoq tekshiruv o‘zgarmagan. Dizayn va moslashuvchan uslublar saqlangan (`style.css` ga faqat qo‘shimchalar).
- Barcha `POST /api/*` (shu jumladan `/api/report`) endi `Origin` va `application/json` talab qiladi; barcha so‘rovlarda `Host` tekshiriladi.
- Brauzerdagi “Natijalar ushbu brauzerda saqlanadi. Hisob yaratish shart emas” matni almashtirildi; README’dagi eski yo‘l tuzatildi.

## Ma’lum cheklovlar
- Nik filtri mukammal emas (README).
- Parol tiklash yo‘q.
- Brauzerning “parolni saqlash” oynasi kafolatlanmaydi.
- Boshqa qurilmalar uchun HTTPS orqali ochiq server kerak; standart — faqat `127.0.0.1`.
- Throttle hisoblagichlari xotirada (qayta ishga tushganda nolga tushadi).
- Javoblar ochiq `data.mjs` da — server mukofotlarni himoya qiladi, javob sirini emas.
- Mijoz (`app.mjs`) avtomatik DOM/brauzer sinovidan o‘tmagan: faqat sintaksis va server API sinovlari bor.
- Sinovlar `tests/.data/*.db` fayllarini qoldiradi (git’da yo‘q; kerak bo‘lsa qo‘lda o‘chiring).

## Follow-up: CSP retry, nik filtri, kirish throttle
- `public/app.mjs`: inline `onclick="location.reload()"` olib tashlandi (CSP `script-src 'self'` uni bloklardi) → `data-action="reload"`, tashqi `click` tinglovchisi ishlaydi. Banner/ekrandagi «Qayta urinish» (`retry-net`) endi `user=null` bo‘lganda ham ishlaydi (`retryNet()`): serverga `/api/me` yuboradi; server yo‘q bo‘lsa — banner qoladi; kirish formasi ekranda bo‘lsa — forma o‘chirilmaydi; aks holda `boot()` qayta ishlaydi.
- `server/nickname.mjs`: `gay` WHOLE_WORDS’dan olib tashlandi (o‘zi haqorat emas); `fvck` va `f4ck/f@ck` (→ `fack`) ildizlari qo‘shildi. Filtr baribir mukammal emas (yangi yozilishlarni o‘tkazadi, `Fackler` kabi zararsiz nikni rad etishi mumkin).
- `server/auth.mjs` + `server.mjs`: kirishda urinish scrypt’DAN OLDIN `lim.reserve()` bilan band qilinadi; faol (inflight) urinishlar o‘tgan xatolar bilan birga sanaladi (IP+login va IP bo‘yicha). Muvaffaqiyatli kirish faqat yozilgan xatolarni tozalaydi (`clear`), boshqa parallel rezervlarni emas. `release()` idempotent, `finally` da chaqiriladi (503 xato hisoblanmaydi).
- Sinovlar: `tests/client-retry.test.mjs` (inline handler yo‘q, reload/retry boot va login’da), `tests/api.test.mjs` (nik ro‘yxati, 15 ta parallel kirish → aynan 5 ta 401, IP bo‘yicha burst, `limiter.reserve`). Natija: 50/50 o‘tdi; yangi throttle sinovlari eski mantiqda yiqiladi.
