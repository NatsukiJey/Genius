# CHANGELOG — перенос Jenius на React + Vite

Ничего не опубликовано и не развёрнуто. Сеть использовалась только для npm-зависимостей.

## Что сделано
- Клиент переписан на React 19 + Vite 8 (`client/src`, небольшие модули, без `innerHTML`/inline-стилей/inline-скриптов). Сборка — `dist/`.
- Чистые модули (`data`, `engine`, `sound`, `keys`) вынесены в `shared/`; сервер и клиент используют одни и те же.
- `server.mjs` раздаёт только `dist/` (страницы `/`, `/login`, `/register`, `/assets/*.js|css`, 6 аудиофайлов с Range/HEAD); `/api/*` SPA-заглушкой не отвечает. Без `dist/index.html` CLI выходит с понятной ошибкой (кроме `JENIUS_DEV=1`).
- Telegram: токен/chat id из `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, файл — запасной вариант; не настроено → 503.
- `package.json`: белый список `files` (без `public/`, `tests/`, `data/`, `.env`), `engines.node >=26`.
- README переписан (npm ci/build/start, dev, GitHub против Node-хостинга + SQLite, legacy, переменные окружения, Telegram); `render.yaml` и `.env.example` сверены.

## Исправления в этом заходе
- `tests/static.test.mjs`: проверка `/audio/../index.html` была неверной — `fetch` сам схлопывает `..`, а сервер нормализует путь в `/index.html` (обычная SPA-страница). Теперь traversal-пути шлются сырым запросом; добавлены `/audio/..%2F…`, `/audio/%2e%2e/…`, `/audio/background.mp3/../../package.json` (все 404 и без HTML). Покрытие расширено, не ослаблено.
- Проверка legacy: добавлены README-раздел, этот файл и проверка белого списка `files`.
- `tests/ui/modal-focus.test.jsx`: хелпер `names()` возвращает `aria-label`, а ожидались `id`. Теперь ожидаются доступные имена (`Fon musiqasi balandligi`, `Javobingiz`), а `id` (`snd-quick-background`, `answer`) проверяются отдельной строкой.
- Дефектов поведения в компонентах не найдено: просмотрены обновление состояния (focus/visibility/60 с/BroadcastChannel), 409-обработка, офлайн-баннер, звук (пауза на скрытой вкладке), focus trap, `location.replace('/')`, импорт старого прогресса только при регистрации.

## Результаты (финальный запуск)
`npm run check` (16.11.2026, Node 26.13): `npm test` — 134/134 прошли; `npm run test:ui` — 54/54 (5 файлов); `npm run build` — успешно (~0,5 с). До правок было 132/134 и 53/54.

## Проверка в настоящем браузере (этот заход)
Новый `tests/browser-e2e.mjs` (`npm run e2e`, в `npm run check` не входит): собранный `dist/` + отдельный сервер `127.0.0.1:4187`, отдельная БД и профиль в `tests/.data/e2e/`, один одноразовый аккаунт. Результат: **28/28**. Покрыто: SPA `/login` и `/register`, окно выбора курса (нельзя закрыть), русский → уровень A1 с пометкой «не TORFL», карта из 50 уровней, вопрос урока, 5 ответов проверены сервером (POST `/api/lesson/answer` → 200), награда `+20 tanga` и рост монет, панель звука (открытие/закрытие), отсутствие горизонтальной прокрутки при 320/375/768/1280 px и в окне урока, офлайн-баннер → «Qayta urinish» → баннер исчез, смена курса ru↔en с сохранением прогресса, 0 ошибок консоли. Первый прогон дал 27/28: падение было ошибкой самого скрипта (`offsetParent` у `position:fixed` всегда `null`), приложение не менялось. Кроме скрипта дефектов в `client/` не найдено. Существующая `data/jenius.db` не затрагивалась.

## Ограничения
- Проверено только на Node 26.13; другие версии не пробовались (`engines` стоит `>=26`).
- Сайт на хостинге не проверялся. Браузер проверен только headless Chromium (`npm run e2e`) на локальном изолированном сервере; на телефоне, в Firefox/Safari и со звуком «вживую» (в e2e `--mute-audio`) не проверялось. Юнит-UI тесты — jsdom с заглушкой `Audio`.
- Папка `public/` и `tests/legacy/` оставлены (удалять без разрешения нельзя), но неактивны и исключены из git/пакета.
- Репозиторий git сейчас — вся домашняя папка; перед публикацией нужен отдельный `git init` в проекте.
- Права на `background.mp3` (3,4 МБ) не проверены. Лимиты входа хранятся в памяти и сбрасываются при перезапуске.
- `render.yaml` не запускался на Render.

## Vercel-совместимость (16.11.2026)
- Общее ядро API вынесено из `server.mjs` в `server/app.mjs`; хранилище подключается как адаптер: `server/store-sqlite.mjs` (локально, мьютекс вокруг await в транзакциях) и `server/store-pg.mjs` (pg.Pool). Весь SQL — `server/repo.mjs` (один код для двух баз); игровые правила по-прежнему только в `server/game.mjs` (теперь async, с блокировкой строки игрока `FOR UPDATE`).
- `api/index.mjs` → `server/vercel.mjs`: Node-функция без `listen`, без записи на диск и без `node:sqlite`; без `DATABASE_URL` — честный 503; Host/Origin по явному списку (`ALLOWED_HOSTS` + `VERCEL_*`), IP из `x-real-ip` (IPv6 → /64), Secure-cookie по умолчанию.
- Счётчики попыток в PostgreSQL (`throttle_events`, advisory-lock) — общие для всех экземпляров функции; локально остаются в памяти.
- `migrations/001_init.sql` + `npm run db:migrate` (вручную, с advisory-lock и `schema_migrations`); необязательный `npm run db:import-sqlite`.
- `vercel.json` (Vite, `dist`, `/api/*` раньше SPA-fallback), `VERCEL-SETUP.md`, `engines.node` = `26.x`, новые зависимости `pg` и (dev) `@electric-sql/pglite`.

## Tungi rejim (dark mode)
- Yorug‘/qorong‘i rejim tugmasi (🌙/☀️, `data-action="theme-toggle"`): asosiy sarlavha, kirish/ro‘yxatdan o‘tish, dars sarlavhasi. Tanlov faqat shu qurilmada (`localStorage` kaliti `jenius.theme`), serverga hech narsa yozilmaydi. Tanlanmaguncha tizim rejimi (`prefers-color-scheme`) amal qiladi; boshqa tab bilan sinxron; «Hisob» sahifasida «Tizim sozlamasiga qaytarish».
- Oq chaqnashsiz yuklash: `client/public/assets/theme-boot-v1.js` (tashqi, versiyalangan fayl; inline kod va CSP o‘zgarmagan). Kesh `immutable`, shuning uchun fayl o‘zgarsa — `-v2` deb qayta nomlang va `client/index.html` + `tests/static.test.mjs` dagi SHA ni yangilang.
- Ranglar: `styles/theme.css` (oxirgi import) faqat `:root[data-theme=dark]` ostida ranglarni almashtiradi; yorug‘ rejim avvalgidek. Matn kontrasti ≥ 4.5:1 (`npm run e2e:dark` o‘lchaydi, skrinshotlar bilan).
- Testlar: `tests/ui/theme.test.jsx`, `tests/static.test.mjs` (boot tartibi/MIME/CSS), `tests/browser-dark.mjs` (haqiqiy Chromium).
- Dars sarlavhasida yangi tugma bo‘lgani uchun `modal-focus` testida Tab tartibi yangilandi (Tungi rejim — 3-element).
