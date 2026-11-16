# Jenius

Ingliz va rus tillarini o‘zbekcha o‘rganish uchun web-ilova. Rus kursi (A1–B2 mashq darajalari, rasmiy sertifikat emas). Yangi hisob avval kursni, keyin darajani tanlaydi; jon/tanga/strayk ikkala kursda umumiy.

Klient — **React + Vite** (`client/`), server — Node.js + SQLite lokal (`server.mjs`) yoki PostgreSQL Vercel funksiyasi (`api/`), umumiy yadro `server/`. Umumiy sof modullar (savollar, o‘yin mantig‘i, ovoz, klaviatura) `shared/` da.

## Ishga tushirish (production)

Node.js **26+** kerak (o‘rnatilgan `node:sqlite` uchun; boshqa versiyalarda sinalmagan). Paketlar `package-lock.json` bo‘yicha o‘rnatiladi.

```bash
cd /home/jaloliddin/projects/jenius-react
npm ci            # aniq versiyalar (lockfile bo‘yicha)
npm run build     # React klientni yig‘adi -> dist/
npm start         # NODE_ENV=production node server.mjs
```

Brauzer: http://127.0.0.1:4173. `dist/index.html` bo‘lmasa, server tushunarli xabar bilan darrov to‘xtaydi (avval `npm run build`). Standart holatda faqat shu kompyuterdan ochiladi (`127.0.0.1`). Internetga joylashtirish hali bajarilmagan.

## Ishlab chiqish (2 terminal)

```bash
npm run dev:server   # Node API, :4173 (JENIUS_DEV=1: dist shart emas, ALLOWED_HOSTS=localhost:5173,...)
npm run dev:client   # Vite, http://localhost:5173 (/api va /audio ni :4173 ga yo‘naltiradi)
```

Qat’iy CSP faqat production yig‘ilmasida ishlaydi (Vite dev rejimi `<style>` qo‘shadi).

## Vercel (serverless)

Bu repozitoriy **manba kodi**: GitHub sahifasida README ko‘rinishi normal holat va sayt ishlayotganini bildirmaydi. Vercel saytni `vercel.json` bo‘yicha **yig‘ib** (`npm run build` -> `dist/`) beradi, `/api/*` ni esa Node funksiyasi `api/index.mjs` bajaradi (xuddi shu domen, PostgreSQL/Neon `DATABASE_URL` orqali). `DATABASE_URL` bo‘lmasa API halol **503** javob beradi (xotirada soxta saqlash yo‘q).

- Panel qadamlari (qisqa): **[VERCEL-SETUP.md](VERCEL-SETUP.md)**.
- Kod: umumiy API yadrosi `server/app.mjs`; lokal `server.mjs` (SQLite) va Vercel `server/vercel.mjs` (PostgreSQL) bir xil qoidalardan foydalanadi (`server/game.mjs`, `shared/`).
- Sxema: `migrations/*.sql`, qo‘lda `npm run db:migrate` (yig‘ish paytida ishlamaydi). Lokal akkauntlarni ko‘chirish ixtiyoriy: `npm run db:import-sqlite -- --from data/jenius.db --yes`.
- `npm start` avvalgidek SQLite (`data/jenius.db`) bilan ishlaydi.
- Testlar: `npm run check` (SQLite backend, PostgreSQL SQL testlari — haqiqiy PGlite, React, build). **Haqiqiy Neon va Vercel bilan tekshirilmagan** (ulanish va loyiha manzili yo‘q); bir nechta jarayon orasidagi haqiqiy parallel bloklar PGlite (bitta ulanish) da isbotlanmaydi.

## Joylashtirish: GitHub va Node-hosting

- **GitHub faqat kod ombori.** GitHub Pages bu yerda **mos emas**: u tayyor fayllarni beradi, Node ishlatolmaydi, ya’ni SQLite, cookie-sessiya, kirish va javoblarni serverda tekshirish bo‘lmaydi. Frontni Pages’ga, API’ni boshqa saytga qo‘ysangiz, `SameSite=Strict` va Origin/Host tekshiruvi buziladi.
- **Sayt Node-hostingda ishlaydi** (Render, Railway, VPS...): `npm ci && npm run build`, ishga tushirish `npm start`, **doimiy disk** va `DB_PATH` shu diskda (SQLite fayli). Doimiy diskisiz baza har deployda yo‘qoladi. Faqat HTTPS: `COOKIE_SECURE=1`, `HOST=0.0.0.0`, `ALLOWED_HOSTS=<domen>`, proksi bo‘lsa `TRUST_PROXY=1`.
- `render.yaml` — Render uchun **ixtiyoriy namuna**, hech narsa joylashtirilmagan. Sirlar (`sync: false`) panelda qo‘lda kiritiladi.
- Git: loyiha papkasida alohida `git init` qiling (hozir ota papka — butun uy katalogi — repozitoriy!). `git add .` dan oldin `.gitignore` ni tekshiring. Joylashtirishdan oldin `client/public/audio/*` (3,4 MB `background.mp3`) uchun huquqlaringizni tekshiring.

## Eski (legacy) `public/` papkasi — FAOL EMAS

`public/` — React’dan oldingi eski klient (`app.mjs` + `innerHTML`). U **ishga tushmaydi va berilmaydi**: server faqat `dist/` ni beradi; `.gitignore` da `/public/`; `package.json` `files` ro‘yxatida yo‘q (npm-paketga tushmaydi). Faol ovoz fayllari `client/public/audio/`. Eski testlar `tests/legacy/` da, `npm test` ga kirmaydi. Ruxsat bo‘lsa, `public/` va `tests/legacy/` ni butunlay o‘chirish mumkin.

## O‘qish

- Beginner, Elementary, Intermediate, Advanced — har birida 50 level, jami 200 level.
- Har bosqichda 50 so‘z/ibora bor; keyingi levellarda ular takrorlab mustahkamlanadi. Jami 200 noyob lug‘at birligi, 1 000 level-savol joyi; bu 1 000 noyob so‘z emas.
- Level boshida 5 so‘z o‘rgatiladi, bosib tarjimasini ochish mumkin.
- Keyin shu so‘zlardan 5 savol: tarjima tanlash, harflardan yig‘ish, inglizcha yozish, teskari tarjima tanlash, o‘zbekcha yozish.
- Level xatosiz tugatilganda keyingisi ochiladi. Xato bo‘lsa shu 5 savol qayta mashq qilinadi.
- Bosqich oxirida 10 savolli test, o‘tish chegarasi 80%. Muvaffaqiyatsizlik yoki testni tashlab chiqishda 5 daqiqalik kutish saqlanadi.
- Istalgan boshlang‘ich darajani tanlash mumkin; bosqich testlari boshqa darajani tanlashni bloklamaydi.

## Jon, tanga va strayk

- Maksimum 5 jon; tanlash/yig‘ishdagi xato 1 jon oladi; yozishdagi xato jon olmaydi.
- 0 jonda level boshlanmaydi yoki davom ettirilmaydi.
- Har 30 daqiqada 1 jon tiklanadi, sayt yopiq bo‘lsa ham qayta ochilganda hisoblanadi.
- Yangi level uchun 20 tanga, har 10-level uchun 30 tanga. Bir bosqich jami 1 050 tanga.
- Takroriy level yoki yakuniy test tanga bermaydi.
- Shop: +1 jon = 150, 5 tagacha to‘ldirish = 500, 1 kunlik strayk himoyasi = 300 tanga.
- Himoya oldindan olinadi va bir marta ishlaydi. Bir vaqtning o‘zida faqat bitta himoya.
- Strayk uchun har kuni kamida bitta YANGI level tugatiladi; kun SERVER soati va server vaqt mintaqasi bo‘yicha hisoblanadi.

## Hisoblar va server tomonida saqlash

- Ro‘yxatdan o‘tish: login (3–20 ta lotin harfi/raqam/`_`, katta-kichik harf farqsiz) + parol (8–256 belgi). Kirish, chiqish.
- **Server yagona haqiqat manbai.** Brauzer faqat niyat yuboradi (“levelni boshla”, “mana javobim”, “sotib ol”). Javobni tekshirish, jon, tanga, strayk, kutish vaqtlari, do‘kon — hammasi serverda. Tayyor `state` yoki tanga yuboradigan yo‘l yo‘q.
- Parol: salt bilan `scrypt` (N=2^15, r=8, p=1), `timingSafeEqual`. Sessiya tokeni 32 tasodifiy bayt, bazada faqat `sha256`. Cookie: `HttpOnly; SameSite=Strict; Path=/`, 30 kun (kuniga bir marta uzayadi).
- Nik filtri (haqorat, leet `f4ck`, takror harflar, band nomlar `admin`/`jenius`...) **mukammal emas**: yangi shakllarni o‘tkazib yuboradi va ba’zan zararsiz nikni rad etadi. Ro‘yxat `server/nickname.mjs` da, qo‘lda to‘ldiriladi.
- **Parol tiklash yo‘q.** Faqat nik bilan hisobni tiklab bo‘lmaydi (email/telefon yo‘q — egasini tasdiqlab bo‘lmaydi). Parolni brauzer menejerida saqlang.
- Brauzer “parolni saqlaysizmi?” oynasini ko‘rsatishi **kafolatlanmaydi**. Biz standart `<form>`, `autocomplete="username"`, `new-password`, `current-password` va muvaffaqiyatdan keyin haqiqiy sahifa o‘tishini (`location.replace('/')`) ishlatamiz, qolgani brauzerga bog‘liq.
- Offlayn rejim yo‘q: server bilan aloqa uzilsa, ilova “natija saqlanmadi” deydi va hech narsa saqlanmaydi.
- Bir nechta qurilma/brauzer: bir xil server va bir xil hisob = bir xil natija (fokusda va har 60 soniyada qayta so‘raladi). Ikkinchi qurilmada dars boshlansa, birinchisi 409 oladi.
- **Cheklov:** boshqa qurilmalar (telefon) ulana olishi uchun server ular uchun ochiq va **HTTPS** manzilda bo‘lishi kerak. Oddiy `http://` orqali parol va cookie ochiq ketadi. Ota-ona noutbukini internetga ochmang, routerda port ochmang.
- Noutbuk uxlasa yoki server o‘chsa, kirib bo‘lmaydi. Ma’lumotlar bazasi (`data/`, ruxsat 700/600) git’ga tushmaydi.

### Eski natijani ko‘chirish (ixtiyoriy)

Ro‘yxatdan o‘tish formasida, agar shu brauzerda eski `jenius.progress.v1` bo‘lsa, belgilanmagan katakcha chiqadi. Belgilansa, server uni tekshiradi va tozalaydi (`completed` aynan 1..n, n ≤ 50; tanga 0..haqiqatan topilishi mumkin bo‘lgan miqdor; jon 0..5; kutish vaqtlari chegaralangan; strayk/sana tekshiriladi; noto‘g‘ri tuzilma bo‘lsa, ko‘chirilmaydi va yangi hisob bo‘sh ochiladi). **Faqat ro‘yxatdan o‘tishda**, kirishda hech qachon. Eski ma’lumot brauzerda o‘chirilmaydi, faqat `jenius.migratedTo` belgisi qo‘yiladi. Boshqa yangi hisobga qayta ko‘chirish ro‘yxatdan o‘tish limiti bilan cheklanadi, tanga esa topilganidan oshmaydi (xarajatlar bilinmagani uchun ko‘chirilgan tanga biroz ko‘proq bo‘lishi mumkin). **Cheklov:** server eski mahalliy progress haqiqatan o‘yin orqali olinganini isbotlay olmaydi — brauzerdagi ma’lumotni foydalanuvchi o‘zi tahrirlashi mumkin; tekshiruv faqat mantiqiy chegaralarni (yuqoridagilarni) ushlaydi, shuning uchun ko‘chirilgan progressga to‘liq ishonib bo‘lmaydi.

### Marshrutlar

| Marshrut | Vazifa |
|---|---|
| `GET /`, `/login`, `/register` | Sahifa (bitta `index.html`) |
| `GET /api/me` | Joriy foydalanuvchi, state, rev, serverNow, faol dars (401 — kirmagan) |
| `POST /api/register` | `{username,password,importLocal?}` hisob + sessiya |
| `POST /api/login` | `{username,password}` faqat parolni tekshiradi, natijani o‘zgartirmaydi |
| `POST /api/logout` | Sessiyani o‘chiradi, cookie’ni tozalaydi |
| `POST /api/tier` | `{tier:0..3}` |
| `POST /api/lesson/start` | `{tier,level,exam}` |
| `POST /api/lesson/answer` | `{lessonId,index,given}` (takroriy so‘rov xavfsiz: ikkinchi jarima yo‘q) |
| `POST /api/lesson/retry` | `{lessonId}` (faqat xatodan keyingi takror fazasida) |
| `POST /api/lesson/abandon` | `{lessonId}` (yakuniy testni tashlash — 5 daqiqa kutish) |
| `POST /api/shop/buy` | `{item:"heart"|"refill"|"freeze"}` |
| `POST /api/report` | Telegram’ga xabar (avvalgidek) |

Har bir `POST /api/*`: `Content-Type: application/json`, `Origin` majburiy va ruxsat etilgan hostga teng, `Sec-Fetch-Site: cross-site` rad etiladi, tana ≤ 16 KB, noto‘g‘ri JSON — 400. Har bir so‘rovda `Host` tekshiriladi (421). Javoblar `Cache-Control: no-store`. Parol va tanalar logga yozilmaydi.

Kodlar: 400 noto‘g‘ri so‘rov, 401 kirish kerak, 403 Origin/qulf/kutish/jon yo‘q, 409 eskirgan dars (`lesson_superseded`, `out_of_sync`, `tier_mismatch`) yoki band login, 413 katta tana, 415 content-type, 421 begona Host, 429 juda ko‘p urinish (`Retry-After`), 503 band.

Himoya: kirish — 5 ta xato (IP+login) / 30 ta (IP) 15 daqiqada; ro‘yxatdan o‘tish — 5 ta IP uchun soatiga; urinish hashlashdan OLDIN band qilinadi (parallel so‘rovlar limitdan o‘ta olmaydi); bir vaqtda ko‘pi bilan 2 ta scrypt (uzun navbat — 503). Hisoblagichlar xotirada: server qayta ishga tushsa, nolga tushadi. **Cheklov:** limitlar IP bo‘yicha; umumiy proksi/NAT (maktab, ofis, `TRUST_PROXY=0` bilan proksi orqasida) ortidagi hamma foydalanuvchilar bitta IP hisoblanadi — bir kishi limitni to‘ldirsa, boshqalar ham vaqtincha bloklanadi. Nik filtri ham mukammal emas (kichik ro‘yxat; yangi yoki yashirin shakllarni o‘tkazib yuboradi, ba’zan begunoh nikni rad etadi).

### Muhit o‘zgaruvchilari

| O‘zgaruvchi | Standart | Ma’no |
|---|---|---|
| `PORT` | `4173` | Port |
| `HOST` | `127.0.0.1` | Tinglanadigan manzil. `0.0.0.0` ga o‘zgartirsangiz, qurilmangiz tarmoqqa ochiladi (HTTPS bo‘lmasa xavfli) |
| `ALLOWED_HOSTS` | bo‘sh | Vergul bilan: ruxsat etilgan qo‘shimcha `Host` (`host:port`). `127.0.0.1`, `localhost`, `[::1]` doim ruxsat |
| `DB_PATH` | `data/jenius.db` | SQLite fayli |
| `COOKIE_SECURE` | `0` | `1` — `Secure` + `__Host-` cookie (faqat HTTPS bilan; oddiy http’da kirish buziladi) |
| `TRUST_PROXY` | `0` | `1` — IP uchun `X-Forwarded-For` oxirgi qiymati (faqat ishonchli proksi orqasida) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | bo‘sh | «Bizga yozing» xabarlari uchun; bo‘sh bo‘lsa 503 |

Namuna: `.env.example` (nusxasini `.env` qiling; u `.gitignore` da).

Zaxira nusxa: server to‘xtatilganda `data/jenius.db` ni (va `-wal`/`-shm` bo‘lsa, ularni ham) nusxalang.

Ma’lum kompromiss: savol javoblari ochiq `shared/data.mjs` faylida, shuning uchun server mukofot va qoidalarni himoya qiladi, javoblar sirini emas (o‘quv ilovasi).

## Telegram

Token va chat id **muhit o‘zgaruvchilarida** beriladi: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (`.env.example` da faqat bo‘sh joy-to‘ldirgichlar; haqiqiy qiymatlar repoga hech qachon tushmaydi). Zaxira: `telegram-config.json` (`.gitignore` da, ruxsat 600). Sozlanmagan bo‘lsa, `POST /api/report` 503 qaytaradi.

Agar token ilgari oshkor bo‘lgan bo‘lsa, BotFather orqali yangilang. Tokenni frontendga qo‘ymang. Sozlama o‘zgargach serverni qayta ishga tushiring.

Xabarlar haqiqiy Telegram kanaliga yuboriladi. Minimal xabar 10, maksimal 2 000 belgi. Bir IP uchun 60 soniyada bitta yuborish. Token serverda qoladi; ommaviy joylashtirishdan oldin CAPTCHA va ishonchli rate-limit qo‘shish kerak.

## Testlar

```bash
npm test        # server, o‘yin mantig‘i, statika/xavfsizlik (node:test)
npm run test:ui # React interfeysi (vitest + jsdom + Testing Library)
npm run check   # hammasi: test + test:ui + build
npm run e2e     # qo‘lda: haqiqiy dist/ ni headless Chromium’da tekshiradi (check ichiga kirmaydi)
```

`npm run e2e` (avval `npm run build`; `/usr/sbin/chromium` kerak) alohida server (127.0.0.1:4187), alohida baza va brauzer profilini `tests/.data/e2e/` ichida yaratadi, bitta bir martalik hisob ochadi va tekshiradi: SPA `/login` va `/register`, kurs tanlash oynasi, rus tili A1, dars savoli, serverdagi javob/mukofot, ovoz paneli, 320–1280px oralig‘ida gorizontal siljish yo‘qligi, oflayn/qayta urinish, kurs almashtirish. Oxirgi ishga tushirish: 28/28 tekshiruv o‘tdi (16.11.2026). Mavjud `data/jenius.db` ga tegmaydi.

`npm test` ichida haqiqiy Vite yig‘ilmasi `tests/.data/` ga qurilib, server orqali tekshiriladi (SPA sahifalar, assetlar, CSP, `..` bilan yo‘l o‘tish urinishlari). Avtomatik testlar: lug‘at/savollar, normalizatsiya, imlo xatolarini yumshoq tekshirish, jon tiklanishi, iqtisodiyot, do‘kon, strayk va quyidagi serverni: ro‘yxatdan o‘tish/kirish, parol va nik qoidalari, sessiya muddati/chiqish, CSRF/Host/Content-Type, server tomonidagi baholash va mukofotlar, takroriy javob, ikki qurilma, bir vaqtdagi xaridlar, qayta ishga tushgandan keyin saqlanish, ko‘chirish limitlari. Sinov bazasi `tests/.data/` da (git’da yo‘q). Quyidagilar oldingi bosqichda qo‘lda brauzerda tekshirilgan edi (hisoblar qo‘shilgandan keyin brauzerda hali qayta tekshirilmagan): levelni tugatish, qayta level uchun mukofot yo‘qligi, yozishda jon saqlanishi, testdan yiqilish/kutish/muvaffaqiyat, mobil 390px va desktop 1440px ko‘rinishi ham tekshirildi.

## Ovoz (ovozli effektlar va fon musiqasi)

Fayllar `client/public/audio/` (yig‘ilgandan keyin `dist/audio/`): `background.mp3` (fon, takrorlanadi), `click.wav`, `select.wav`, `correct.wav`, `win.wav`, `lose.wav`. Server ularni faqat aniq ro‘yxat bo‘yicha beradi (Range/HEAD qo‘llanadi). Ovoz sozlamalari (umumiy + 6 kanal, 0–100, o‘chirish tugmalari) faqat shu brauzerda (`localStorage`, kalit `jenius.sound.v1`) saqlanadi; natijalar serverda qoladi. Brauzer birinchi bosishdan keyingina ovoz o‘ynatadi.

## Google bilan kirish — HOZIR YO‘Q (tayyorlov ro‘yxati)

Hozir `GET /api/auth/providers` → `{"google":{"enabled":false}}`. Kirish va hisob sahifalarida Google tugmasi o‘chirilgan va buning sababi yozilgan. Parollar xesh ko‘rinishida saqlanadi va hech qachon pochta orqali yuborilmaydi. Google orqali kirish/tiklash **kelajak ishi**, hali ishlamaydi. Kelajakda kerak bo‘ladigan narsalar (hozir hech biri kodda yo‘q, kalitlarni bu yerga yozmang):

1. Google Cloud’da loyiha va OAuth consent screen.
2. «Web application» turidagi OAuth client (client ID va secret — faqat serverda, git’dan tashqarida, fayl ruxsati 600).
3. Aniq redirect URI: `https://<domen>/api/auth/google/callback`.
4. Sayt HTTPS’da: `COOKIE_SECURE=1`, `ALLOWED_HOSTS=<domen>`.
5. Keyin alohida ishlab chiqish va haqiqiy HTTPS’da qo‘lda tekshirish (hisobni email bo‘yicha avtomatik birlashtirmaslik, `state`/PKCE/`nonce` tekshiruvi).
