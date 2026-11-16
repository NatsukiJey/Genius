Изучаю копию проекта (сервер, клиент, тесты), чтобы составить план — ничего не меняю.
# План переноса Jenius на React + Vite (только план: файлы не менял, ничего не устанавливал)

Я посмотрел копию в `~/projects/jenius-react`: `server.mjs`, `server/*`, `public/*`, 15 тестов. Сейчас клиент — это один файл `public/app.mjs` (38 КБ, 19 вставок `innerHTML`, около 45 функций). Сервер берёт `engine.mjs` и `data.mjs` прямо из `public/`. База — встроенный в Node `node:sqlite` (Node v26). В интерфейсе узбекский язык, `lang="uz"`.

## ⚠️ Сначала прочитай это

1. **Git-репозиторий сейчас — вся домашняя папка `/home/jaloliddin`.** Папка проекта не отдельный репозиторий. Любой `git add .` или push оттуда может выложить `~/.hermes`, `.claude.json` и другие личные файлы. Первый шаг — `git init` внутри самой папки проекта, и только после того, как готов `.gitignore`.
2. **GitHub Pages здесь не подойдёт.** Он умеет только раздавать готовые файлы. Node там не запустить, значит, не будет SQLite, сессий-cookie, входа и проверки ответов на сервере. Можно держать фронт на Pages, а API на другом сайте, но тогда сломаются `SameSite=Strict` и проверка Origin/Host. Поэтому GitHub — это только хранилище кода, а сайт работает на Node-хостинге.
3. **Перед публикацией:** в README указан старый путь `jenius-accounts`. Ещё он ссылается на файлы, которых нет в копии: `CHANGELOG-russian.md` и `telegram-config.example.json`. И нужно проверить, есть ли права выкладывать `public/audio/*` (там `background.mp3` на 3,4 МБ).

## Новая структура

```
shared/   data.mjs engine.mjs sound.mjs keys.mjs   ← переносим из public/ (чистый код без DOM, его подключают и сервер, и React)
server/   (как сейчас; импорты ../public → ../shared)
server.mjs
client/   index.html (lang="uz", без inline-скриптов) · public/audio/* · src/
  main.jsx  App.jsx  App.css (переменные, база, раскладка, media-запросы)
  api/client.js            fetch: same-origin, JSON, ошибки 401/409/429/сеть
  state/useServerState.js  /api/me, обновление при фокусе и раз в 60 с, clockOffset, rev
  state/lessonReducer.js   чистый: слова → вопрос → проверка → результат/повтор
  hooks/ usePath.js (/, /login, /register без react-router) · useSound.js (useSyncExternalStore поверх createSound) · useFocusTrap.js (keys.mjs)
  components/layout/  Sidebar Header Stats CourseSwitch OfflineBanner Toast(context) Modal Mascot
  components/sound/   SoundButton SoundPanel
  pages/  AuthPage(LoginForm, RegisterForm, LocalImportCheckbox, GoogleDisabledNote) LearnPage(Hero, LevelMap, LevelNode, ExamButton, GoalCard, StreakCard, TipCard) ShopPage(ProductCard) ReportPage AccountPage
  dialogs/ CourseChooser TierPicker ReviewDialog LessonDialog → WordIntro, ChoiceQuestion, TileQuestion, TypeQuestion(+RuKeys), Feedback, ResultScreen
```

Стили компонентов лежат рядом с ними (`*.css`, импорт из компонента). Порядок каскада нужно сохранить: правило `.dialog .sound-panel` должно идти после фиксированных правил для телефона. `dangerouslySetInnerHTML` не используем, функция `esc()` больше не нужна: React сам экранирует текст.

## Шаги

1. **Безопасный старт, зависимости не нужны.**
   - `git init` в папке проекта.
   - В `.gitignore` добавить: `node_modules/ dist/ data/ tests/.data/ *.db *.db-wal *.db-shm .env* telegram-config.json coverage/`.
2. **Перенос в `shared/`.** Перенести 4 модуля, поправить импорты в `server/*` и `tests/*`. Затем `npm test` должен пройти, как и сейчас.
3. **Сервер (Node остаётся единственным бэкендом).**
   - Добавить опцию `distDir`. Пути `/`, `/login`, `/register` отдают `dist/index.html` с `no-cache`.
   - `/assets/*` пропускать только по шаблону `^/assets/[\w.-]+\.(js|css)$`, проверять `resolve` + `startsWith(dist)`, кэш `immutable`.
   - Аудио — тот же список из 6 разрешённых файлов с поддержкой Range, но из `dist/audio`.
   - Если `dist/index.html` нет, сервер падает сразу с понятным сообщением.
   - CSP в production оставить без изменений. Vite-сборка с ней совместима, нужно только `modulePreload.polyfill:false` и `assetsInlineLimit:0`. React ставит стили через `el.style`, это CSP не блокирует.
   - Telegram: читать `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` из env, файл оставить запасным вариантом. Если не настроено — отвечать 503, как сейчас.
   - Старые скрипты проверки с зашитым Telegram не переносить (в этой копии их нет). Добавить в тесты проверку, что в репозитории нет строки `bot[0-9]+:`.
4. **Установка пакетов — только после разрешения родителя.** Сам я ничего не ставлю.
   - Обязательные: `react react-dom` и для разработки `vite @vitejs/plugin-react`.
   - Для тестов интерфейса (по желанию): `vitest jsdom @testing-library/react @testing-library/user-event`.
   - Playwright не берём: он скачивает браузеры по несколько сотен МБ, для этого ноутбука тяжело.
5. **`vite.config.js`.**
   - `root:'client'`, `build.outDir:'../dist'`, `server:{port:5173, strictPort:true, proxy:{'/api':'http://127.0.0.1:4173','/audio':'http://127.0.0.1:4173'}}`.
   - Прокси оставляет Host и Origin как `localhost:5173`, поэтому сервер для разработки запускается с `ALLOWED_HOSTS=localhost:5173,127.0.0.1:5173`.
   - Строгая CSP работает только в production: Vite в режиме разработки вставляет `<style>` прямо в страницу.
6. **Перенос интерфейса по слоям:** api/state → вход и регистрация → каркас → «Учёба» → урок и экзамен → магазин, отчёт, аккаунт → звук. Каждую функцию из `app.mjs` переносим в соответствующий компонент. Поведение сохраняется:
   - после входа `location.replace('/')`, чтобы браузер предложил сохранить пароль;
   - выбор курса нельзя закрыть, пока курс не выбран;
   - при ответе 409 данные заново берутся с сервера, а незаконченный урок продолжается после `/api/me`;
   - баннер «нет сети» с кнопкой повтора, перенос старого прогресса только при регистрации;
   - ловушка фокуса и Enter (Enter на ползунке не отправляет ответ);
   - звук: общий + 6 каналов в `localStorage`, приглушение, пауза на скрытой вкладке;
   - вёрстка для экранов 390 и 1440 px.
7. **Документация.** README (узбекский плюс короткий английский раздел) с разделом Deploy, `.env.example` (только заглушки) и `render.yaml`.

## Скрипты в `package.json`

```json
"dev:server": "ALLOWED_HOSTS=localhost:5173,127.0.0.1:5173 node --watch server.mjs",
"dev:client": "vite",
"build": "vite build",
"start": "NODE_ENV=production node server.mjs",
"preview": "npm run build && npm start",
"test": "node --test tests/*.test.mjs",
"test:ui": "vitest run",
"check": "npm test && npm run test:ui && npm run build"
```

Для разработки — два терминала: `dev:server` и `dev:client`. Пакет `concurrently` не нужен.

## Тесты: что оставить, что заменить

- **Оставить, поправив только пути:** `api`, `courses-api`, `courses-state`, `engine`, `direction`, `russian-data`, `final-fixes`, `sound`, `sound-transitions`, чистые части `keys`. Они проверяют сервер и движок, а не DOM.
- **Заменить, потому что они завязаны на старый код:**
  - `client-courses` и `client-retry` загружают `app.mjs` в самодельный DOM и ищут строки регулярками в `innerHTML`. Замена — тесты на RTL + jsdom с подменённым `fetch`: выбор курса нельзя закрыть; ru → `POST /api/course` → выбор уровня A1–B2 + `PRACTICE_NOTE`; незаконченный урок продолжается; 409 обновляет данные; без сети показывается баннер, повтор перезапускает загрузку; подсказки русской клавиатуры.
  - В `keys.test` проверка «real app.mjs wiring» ищет текст в исходнике регулярками. Замена — проверка поведения: Tab остаётся внутри Modal, у закрытой SoundPanel стоит `hidden`, Enter на ползунке ничего не отправляет.
  - Проверка «нет inline-обработчиков» в исходнике. Замена — проверка, что в `dist/index.html` нет inline-`<script>` и `style`, плюс запрет `dangerouslySetInnerHTML` в `client/src`.
  - CSS-регулярки для звуковой панели: перенести на новый CSS-файл (или проверять вручную).
  - `audio-server`: вместо проверки «сервер отдаёт keys.mjs» — `/assets/*.js` с JS-типом из тестовой папки `dist` в `tests/.data/`.
- **Новые тесты статики:** обход пути через `..` и неизвестный файл → 404; `/login` → index.html; `/api/*` никогда не попадает в SPA; заголовки CSP и кэша.
- **Вручную в браузере:** пройти уровень, проверить, что за повтор нет награды; провалить экзамен (5 минут ожидания); две вкладки (409); экраны 390 и 1440 px; звук.

## `render.yaml` (по желанию, без секретов)

```yaml
services:
  - type: web
    name: jenius
    runtime: node
    plan: starter            # постоянный диск есть только на платных планах
    buildCommand: npm ci && npm run build
    startCommand: npm start
    healthCheckPath: /api/auth/providers
    disk: {name: jenius-data, mountPath: /var/data, sizeGB: 1}
    envVars:
      - {key: NODE_VERSION, value: "22"}
      - {key: HOST, value: 0.0.0.0}
      - {key: DB_PATH, value: /var/data/jenius.db}
      - {key: COOKIE_SECURE, value: "1"}
      - {key: TRUST_PROXY, value: "1"}   # проверить, как Render заполняет X-Forwarded-For
      - {key: ALLOWED_HOSTS, sync: false}
      - {key: TELEGRAM_BOT_TOKEN, sync: false}
      - {key: TELEGRAM_CHAT_ID, sync: false}
```

`PORT` Render задаёт сам. С диском работает только один экземпляр сервиса, и при обновлении будет короткий перерыв. База и ключи в репозиторий не попадают никогда.

## Что дальше

Шаги 1–3 можно делать уже сейчас, пакеты для них не нужны. Шаги 4–7 — после разрешения родителя на установку. Ничего не публикую и не пушу.

[claude-agent] папка: /home/jaloliddin/projects/jenius-react | стоимость: $0.521
