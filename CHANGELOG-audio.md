# CHANGELOG — ovoz (Stage 1) va halol Google (Stage 2A)

Model: Sonnet 5.5. Faqat shu papkada ishlandi (staging). O‘rnatishlar, tarmoq, Telegram, sudo, o‘chirishlar yo‘q.

## Nima qilindi
- **Ovoz** — `public/sound.mjs` (yangi, test qilinadigan: Audio/storage/document/win/now tashqaridan beriladi). Sozlamalar faqat `localStorage` (`jenius.sound.v1`), standart: umumiy 80, fon 25, effektlar 70. Gesturedan keyin fon boshlanadi; `play()` rad etilsa xavfsiz (gesture qayta kutiladi); yashirin tabda fon pauza, qaytganda davom; click/select 80 ms throttle; bitta kanal o‘z ustiga qo‘yilmaydi (qayta boshlanadi); correct/win/lose paytida fon 40% gacha pasayadi (`ended`gacha); win/lose har `lessonId:natija` uchun bir marta; `init()` ikki marta listener qo‘shmaydi, `destroy()` hammasini oladi.
- **app.mjs ulanishi** — `select` (variant/harf/so‘z), boshqa tugmalar `click`, `check`/`next` tovushsiz; `correct` faqat server tasdiqlagan javobda; server xatosida ovoz yo‘q; dars tiklanganda (resume) natija ovozi yo‘q. Sozlamalar tugmasi: asosiy sarlavha, kirish/ro‘yxat sahifasi, dars sarlavhasi (+ fon uchun tez slayder). Panel: umumiy + 6 kanal slayder (0–100, `aria-valuetext`), mute (`aria-pressed`), Esc/tashqariga bosish yopadi, slayder siljiganda `render()` chaqirilmaydi.
- **Server** — `/audio/<6 ta aniq yo‘l>`: to‘g‘ri MIME (`audio/wav`, `audio/mpeg`), `Content-Length`, HEAD, bitta Range → 206, chegaradan tashqari → 416, ko‘p/buzuq Range → 200; `media-src 'self'`; `/sound.mjs` `FILES` ichida.
- **Google 2A** — `GET /api/auth/providers` → `{google:{enabled:false}}`; kirish va hisob sahifasida o‘chirilgan tugma + halol tushuntirish (parol xeshi pochtaga yuborilmaydi; Google kirish/tiklash kelajak, OAuth + HTTPS kerak). Mavjud login/parol o‘zgarmadi. DB sxemasi o‘zgarmadi.

## Natijalar (haqiqiy)
- `npm test`: **73 test, 73 o‘tdi, 0 xato** (oldingi 56 + 17 yangi).
- `node --check` server.mjs, public/*.mjs, tests/*.mjs: xatosiz.
- Brauzerda ovoz **eshitib tekshirilmadi** (bu muhitda brauzer/audio yo‘q): faqat soxta Audio bilan testlar va HTTP testlar.

## Google — to‘siq (blocker)
Haqiqiy Google kirish/tiklash qilinmadi va Google bilan hech narsa tekshirilmadi: OAuth client ID/secret, aniq redirect URI va HTTPS kerak — ular yo‘q. Soxta kalitlar yaratilmadi. Admin parol-tiklash skripti ham qilinmadi (so‘ralmagan). Hozir parolni unutgan foydalanuvchi uchun tiklash yo‘li yo‘q.

## O‘zgargan fayllar
Yangi: `public/sound.mjs`, `tests/audio-server.test.mjs`, `tests/sound.test.mjs`, `CHANGELOG-audio.md`.
O‘zgargan: `server.mjs`, `public/app.mjs`, `public/style.css`, `README.md`.
(`public/audio/*` va `PLAN-audio-google.md` tegilmadi.)

---

# Davomi: natija o‘tishi, mute/yashirin tab, fokus tuzog‘i (Sonnet 5.5, faqat staging)

Aktivlar (`public/audio/*`), mapping, chegaralar (threshold) va hisob/akkaunt — **o‘zgarmadi**. O‘rnatish, tarmoq, o‘chirish, servis, /tmp ishlatilmadi (faqat vaqtincha mutatsiya-tekshiruv uchun `/tmp/sound.bak` nusxasi).

## Tuzatilgan xatolar
- **correct (4.5 s) va win/lose ustma-ust tushishi** — `playOnce()` endi terminal natijada (win/lose, shu jumladan no_hearts/review/exam_failed) avval `correct`ni to‘xtatadi (pauza + boshiga), uning va boshqa terminal kanalning fon pasaytirishini (duck) hamda qolib ketgan qo‘lda `duck()`ni xavfsiz tozalaydi. Win/lose o‘zi mute/0 bo‘lsa ham `correct` to‘xtaydi (jimlik, “dum” yo‘q). Oddiy `continue` (keyingi savol) hech narsani to‘xtatmaydi. Eski to‘xtatilgan `play()` va‘dasining kech rad etilishi yangi duckni bo‘shatmaydi (har kanalga token).
- **Umumiy yoki kanal mute / 0 ovoz o‘ynash vaqtida** — o‘ynayotgan effekt darhol to‘xtaydi (avval faqat `volume=0` bo‘lib, jimgina davom etar va fonni pasaytirib turardi). Ovoz qayta ko‘tarilsa/mute olinsa eski effekt qayta boshlanmaydi. 0 dan katta pasaytirish esa o‘sha zahoti qo‘llanadi. Boshqa tab (`storage` hodisasi) mute qilsa ham xuddi shunday.
- **Yashirin tab** — endi fon bilan birga **barcha effektlar** to‘xtatiladi (boshiga qaytariladi, duck olinadi); qaytganda faqat fon davom etadi, eski effekt va duck qolmaydi. Yashirin tabda yangi effekt ham chalinmaydi.
- **Fokus tuzog‘i (Tab)** — avval yopiq (`hidden`) ovoz panelidagi slayder/tugmalar ham hisobga olinardi (Tab ko‘rinmas elementga tushardi, Shift+Tab oxirgisi ham ko‘rinmas bo‘lardi). Endi `focusables()` `hidden` ota-elementi, `disabled`, `type=hidden`, `tabindex=-1` bo‘lganlarni o‘tkazib yuboradi; bo‘sh dialogda xato yo‘q; fokus tashqarida/yashirin elementda bo‘lsa ichkariga qaytariladi. Panel ochilsa, uning slayder va mute tugmalari Tab bilan yetib boriladi.
- **Slayderda Enter dars javobini yubormasin** — avval `Enter` har qanday `button` bo‘lmagan elementda (jumladan range slayder) `check()/next()` chaqirardi. Endi faqat javob maydoni (`#answer`) yoki fokus yo‘q (body) bo‘lganda yuboriladi; tugma, havola, select, textarea, har qanday range va `.sound-panel` ichida — yo‘q (brauzerning o‘z xatti-harakati qoladi). IME yozish (`isComposing`) paytida ham yubormaydi.

## Fayllar
Yangi: `public/keys.mjs` (Tab/Enter qoidalari — brauzersiz test qilinadi), `tests/sound-transitions.test.mjs` (12 test), `tests/keys.test.mjs` (7 test), shu bo‘lim.
O‘zgargan: `public/sound.mjs` (aktiv effektlar to‘plami, `stopEffect/stopAllEffects/silenceMutedEffects`, `playOnce` terminal mantiq, `visibilitychange`), `public/app.mjs` (import + keydown: Enter/Tab), `server.mjs` (`/keys.mjs` FILES ro‘yxatiga).

## Test haqiqati
- `npm test`: **92 test, 92 o‘tdi, 0 xato** (oldingi 73 + 12 sound-transitions + 7 keys). `node --check` public/*.mjs xatosiz.
- Yangi testlar **haqiqatan xatoni ushlashi** tekshirildi: kodga vaqtincha 3 ta nosozlik kiritildi (terminalda correct to‘xtamasin / mute’da to‘xtamasin / yashirin tabda to‘xtamasin) — mos ravishda 3, 3 va 1 test qizil bo‘ldi; kod qaytarildi.
- **Cheklov:** haqiqiy brauzerda (DOM, Tab, ovoz eshitish) tekshirilmadi. UI regressiya testlari — soxta DOM (`hidden` ota-elementi mantig‘i brauzerdagidek) + `app.mjs`/CSS matn-simmetriyasi (eski qoidalar yo‘qligi, panel `hidden` bilan chiqishi). To‘liq jsdom/brauzer testi uchun paket o‘rnatish kerak (bu vazifada taqiqlangan); tizimda `chromium` bor, keyinchalik CDP orqali e2e yozish mumkin.
