# Vercel sozlash (faqat panelda qiladigan qadamlar)

Kod tayyor: `vercel.json`, `api/index.mjs`, `migrations/`. Quyidagilarni **o‘zingiz** Vercel/Neon panelida bajarasiz. Parol va `DATABASE_URL` ni hech kimga (chatga ham) yubormang.

1. **Project → Settings → General**
   - **Root Directory**: `package.json` va `vercel.json` turgan papka (repozitoriy ildizi). Agar loyiha boshqa papka ichida bo‘lsa, o‘sha papkani tanlang.
   - **Framework Preset**: Vite. **Build Command**: `npm run build`. **Output Directory**: `dist`. **Install Command**: `npm ci`. (`vercel.json` shularni o‘zi beradi.)
   - **Node.js Version**: 26.x (`package.json` → `engines`; sinov faqat lokal Node 26.13 da o‘tkazilgan).
2. **Storage → Create → Neon (Postgres)** va loyihaga ulang. Vercel `DATABASE_URL` ni o‘zi qo‘shadi. Qiymatni ko‘chirib yubormang.
3. **Sxemani bir marta qo‘llang** (yig‘ishda avtomatik emas). Terminalda, `DATABASE_URL` ni xavfsiz yuklab (masalan `vercel env pull .env.local`, fayl git’ga tushmaydi):
   `npm run db:migrate` — qayta ishga tushirish xavfsiz.
4. **Settings → Environment Variables**:
   - o‘z domeningiz bo‘lsa: `ALLOWED_HOSTS=sizning-domen.uz` (aniq nom, `*` ishlamaydi). `*.vercel.app` manzillarini Vercel o‘zi beradi (`VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`).
   - ixtiyoriy: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (bo‘lmasa «xato haqida xabar» 503 qaytaradi, qolgani ishlaydi).
5. **Redeploy** (Deployments → ⋯ → Redeploy). Keyin production manzilni oching: `/login` va `/register` ochilishi kerak, README emas.

Muammo bo‘lsa: `/api/auth/providers` **503** + «DATABASE_URL» → 2-qadam yetishmaydi; 503 + «db:migrate» → 3-qadam; 421 → manzil `ALLOWED_HOSTS`/`VERCEL_URL` da yo‘q.

**Eski lokal akkauntlar** avtomatik ko‘chmaydi. Xohlasangiz, aniq buyruq bilan (bo‘sh bazaga, `--yes` kerak): `npm run db:import-sqlite -- --from data/jenius.db --yes`. Sessiyalar ko‘chmaydi, qayta kirasiz.

**GitHub Pages ≠ Jenius.** `https://<login>.github.io/<repo>/` — статический хостинг: он не запускает `/api` и не хранит базу, поэтому полноценно работать здесь Jenius не может. Если Pages показывает README — это Jekyll, который рендерит README.md репозитория (Settings → Pages → «Deploy from a branch»); приложением там не пахнет. Для работы нужен Vercel + Neon по шагам выше (или свой Node-сервер).
**Белый экран на Vercel:** теперь вместо пустоты видно «Yuklanmoqda…» / «Server bilan aloqa yo‘q» с причиной (HTTP-код, DATABASE_URL, HTML вместо API). Если виден только «Jenius yuklanmoqda…» — не загрузился `/assets/*.js`: проверьте Root Directory и Output Directory (`dist`).
