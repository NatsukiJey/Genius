# CHANGELOG — rus tili kursi (Russian course)

Ingliz tili kursi bilan yonma-yon rus tili qo‘shildi. Hammasi shu staging papkada (`/home/jaloliddin/projects/jenius-russian`) qilingan; asl loyiha, shaxsiy fayllar, kalitlar, tarmoq va Telegram ishlatilmagan.

## Nima qo‘shildi

| Qism | Qanday |
|---|---|
| Kurslar | `COURSES = {en, ru}` (`public/data.mjs`). Har bir kursning so‘zlari, darajalari, matnlari va topshiriq yo‘riqnomalari shu yerda. |
| Rus darajalari | **A1 / A2 / B1 / B2**, har birida 50 ta 5 savollik dars + yakuniy test (10 savol, 80% = 8/10, qayta urinish 5 daqiqadan keyin). |
| Lug‘at | Har darajada 50, jami **200 ta noyob** rus–o‘zbek juftligi (noyob rus so‘zi **va** noyob o‘zbekcha tarjima). A1 — kundalik so‘zlar; A2 — kundalik hayot; B1 — mavhum so‘zlar, fe’llar, bog‘lovchilar; B2 — murakkab so‘zlar va turg‘un iboralar. Faqat kirill harflari va bo‘shliq. |
| Yo‘riqnomalar | O‘zbek tilida: «Ruscha so‘zning o‘zbekcha tarjimasini toping», «Harflardan ruscha so‘zni yig‘ing», «Rus tilida yozing», … |
| Kirill yig‘ish | `assemble` savollarida harflar rus javobidan olinadi (kirill harflari + probel). |
| Rus klaviatura maslahati | «Rus tilida yozing» savolida 33 harf + probel + ⌫ tugmalari (`.ru-keys`), `lang="ru"` atributlari. |
| Halol yorliq | Rus darajalari «mashq darajasi», **rasmiy sertifikat yoki TORFL emas** (`PRACTICE_NOTE`, kurs sahifasida va daraja tanlashda ko‘rinadi). |
| Umumiy yordamchilar | `courseQuestions/courseLessonWords(course, tier, level, exam)`, `promptOf/answerOf/instructionOf(type, course)`, `TYPE_SPECS` (`target`/`uz`). So‘z `{t, uz}` shaklida; umumiy kod `word.en` ni o‘qimaydi (testda tekshiriladi). |
| Eski nomlar | `QUESTION_TYPES` (en/uz ko‘rinishi), `questions(tier, level, exam)`, `lessonWords`, `WORDS` hamda `write-en` tur nomi o‘zgarmagan (`write-en` = «maqsad tilida yozing»). Ingliz so‘zlari qo‘shimcha `en` maydonini saqlaydi (faqat eski kod uchun). |

## Holat (progress) v2

```
{version:2, activeCourse:null|'en'|'ru',
 hearts, coins, regenAt, streak, lastDay, freeze,            // UMUMIY hamyon
 courses:{en:{tier,completed[4],passed[4],retryAt[4]}, ru:{…}}}  // har kurs alohida
```

* Jon, tanga, jon tiklanishi, strayk va muzlatish **umumiy**: kursni almashtirish jonni to‘ldirmaydi, takror o‘ynash tanga bermaydi.
* Daraja, tugatilgan darajalar, topshirilgan testlar va 5 daqiqalik kutish **har kursda alohida**.
* Mijozga `state` da faol kursning `tier/completed/passed/retryAt` maydonlari **hisoblab** qo‘shiladi (`viewState`); bazada ular takrorlanmaydi. `state.courses` da ikkala kurs ham bor.
* `upgradeState(v1)` — yo‘qotishsiz (noma’lum maydonlar ham saqlanadi), `downgradeState` teskari amal, ikki marta qo‘llash hech narsani o‘zgartirmaydi.

## SQLite sxema 2 (`server/db.mjs`)

Bitta tranzaksiyada: `lessons.course TEXT NOT NULL DEFAULT 'en'` (eski tugallanmagan darslar inglizcha bo‘lib qoladi), har bir `progress` qatori `upgradeState` orqali v2 ga o‘tadi, so‘ng `user_version=2`. O‘qib bo‘lmaydigan JSON (yoki obyekt bo‘lmagan / noma’lum versiya) → xato → `ROLLBACK`: baza 1-versiyada qoladi, hech narsa jimgina yo‘qolmaydi. Ikkinchi ishga tushirish xavfsiz. **Haqiqiy bazada ishga tushirishdan oldin fayl nusxasini qo‘lda oling** (bu yerda haqiqiy baza ochilmagan).

## Server (`server/game.mjs`, `server.mjs`)

* `POST /api/course {course}` — kirish talab qilinadi; noto‘g‘ri kurs → 400 `bad_course`; shu kurs qayta tanlansa hech narsa o‘zgarmaydi.
* Kurs tanlanmagan bo‘lsa `tier`/`start` → 409 `no_course`. So‘rovdagi `course` faol kursga mos kelmasa → 409 `course_mismatch`.
* Dars yaratilganda `lessons.course` ga yoziladi va **o‘zgarmaydi**: `answer/retry/abandon`, baholash, mukofot, test o‘tish va kutish jazosi `row.course` bo‘yicha. Boshqa kursga mukofot berib bo‘lmaydi (bazani qo‘lda buzib sinaldi).
* Kursni almashtirganda davom etayotgan dars **aniq** to‘xtatiladi (javobda `abandoned:{course,tier,level,exam,cooldown}`); tugamagan yakuniy test uchun 5 daqiqalik jazo **eski kursga** yoziladi. Eski darsga javob → 409 `lesson_superseded`.
* Mukofotlar, jon va tanga faqat serverda hisoblanadi (oldingidek).
* Baholash: rus yozuvi qat’iy — faqat harf registri, bo‘shliqlar va **ё = е** e’tiborga olinmaydi (`normalizeRu`; tinish belgilari va harf xatolari rad etiladi). Ingliz yozuvi eski `normalize`. O‘zbekcha (`write-uz`) javobdagi imlo xatolariga bardosh har ikki kursda ishlaydi; o‘xshash so‘zlar tekshiruvi faqat **shu kursning** so‘zlari bo‘yicha.
* Brauzerdagi eski (localStorage) progressni import qilish o‘zgarmagan: faqat 1-versiya, tozalanadi, **faqat ingliz** (`activeCourse:'en'`).

## Mijoz (`public/app.mjs`, `style.css`)

Ro‘yxatdan o‘tgach avval kurs (Ingliz/Rus), keyin daraja tanlanadi. Sarlavhada EN/RU almashtirgich (`aria-pressed`, 40–44 px tugmalar, ≤620 px da sarlavha qatorlarga o‘raladi). Dars davom etayotgan bo‘lsa almashtirishdan oldin tasdiqlash oynasi chiqadi. Eski ingliz hisoblari `en` da qoladi. Ovoz: **oldingi 6 ta audio fayl, balandlik/kanallar va tugmalar o‘zgarmagan, ikkala kursda bir xil**; so‘z talaffuzi qo‘shilmagan (reja bu haqda noto‘g‘ri taxmin qilgan edi).

## Testlar — haqiqiy natija

`npm test` → **136 ta test, 136 muvaffaqiyatli, 0 xato** (~9 s). 93 ta eski test avvalgidek o‘tadi; 43 ta yangi.

| Fayl | Testlar | Nimani tekshiradi |
|---|---|---|
| `russian-data.test.mjs` | 11 | 200 noyob juft, kirill, qiyinlik o‘sishi, **ikkala kurs bo‘yicha 400 dars × 5 = 2000 dars savoli + 8 test × 10 = 80 test savoli**: 4 ta noyob variant, javob sizmaydi, to‘g‘ri til; ingliz savollari eski versiya snapshot‑iga (`tests/fixtures/en-questions-v1.json`, 204 slot) aynan teng |
| `courses-state.test.mjs` | 12 | v1↔v2 yo‘qotishsiz, takror, noto‘g‘ri JSON; umumiy hamyon; qat’iy rus yozuvi (200 so‘z); ingliz o‘zgarmagan; rus kursida o‘zbekcha imlo bardoshi; SQLite migratsiya, rollback, takror ochish |
| `courses-api.test.mjs` | 14 | kurs tanlash, 400/409 xatolar, alohida progress, umumiy jon/tanga/strayk/xarid, alohida kutish, dars o‘rtasida almashtirish va eski javob 409, darsning kursga bog‘langanligi, to‘liq A1 yo‘li, **barcha 4 daraja × 50 dars + 4 test API orqali**, eski bazani qayta ishga tushirish (faol dars saqlanadi), import, ovoz |
| `client-courses.test.mjs` | 6 | haqiqiy `app.mjs` mini‑brauzerda: kurs tanlash, A1–B2, kirill so‘zlar, klaviatura maslahati, ingliz darsi o‘zgarmagan |

Mavjud testlarda faqat interfeys moslashtirildi (kutilgan natijalar emas): `helpers.mjs` (`signup` yangi hisobda kursni tanlaydi, `patchState` kurs bo‘yicha yozadi, `correctGiven` dars kursini ishlatadi), `engine.test.mjs` (`s.courses.en.completed`), `direction.test.mjs` (`instructionOf(q.type,` regex). Hech bir test o‘chirilmagan.

## Cheklovlar va ochiq qolganlar

* Rus so‘zlari va o‘zbekcha tarjimalarini **rus tilini biladigan inson tekshirib chiqishi kerak**; testlar faqat tuzilishni (noyoblik, kirill, yo‘nalish) tekshiradi, ma’no to‘g‘riligini emas.
* «A1–B2» — faqat mashq darajalari nomi, rasmiy daraja yoki sertifikat emas. 50 dars ichida har so‘z bir necha marta takrorlanadi (ingliz kursidagi formula).
* Rus yozuvida imlo xatosiga bardosh YO‘Q (shartga ko‘ra qat’iy); `й/и`, `ъ/ь` farq qiladi. Faqat o‘zbekcha javoblarda imlo xatosi kechiriladi.
* Brauzerda real klik/mobil ekran qo‘lda ko‘rib chiqilmadi (servis/tarmoq yo‘q): UI mini‑DOM testi va CSS qoidalari orqali tekshirilgan. Mobil ko‘rinishni telefonda ko‘zdan kechiring.
* `/api/course` uchun alohida tezlik cheklovi yo‘q (boshqa o‘yin yo‘llari kabi); CSP, kirish/ro‘yxatdan o‘tish cheklovlari o‘zgarmagan.
* Ish jarayonida beixtiyor tizimning vaqtinchalik papkasida ikkita kichik nusxa fayl (`data.mjs`, `jr_head.txt`) yaratildi (shartga zid). Loyihaga ta’sir qilmaydi; o‘chirishga ruxsat so‘ralmagani uchun joyida qoldi.
