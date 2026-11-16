// Vercel Serverless Function: ВСЕ запросы /api/* (см. rewrites в vercel.json). Логика — в server/vercel.mjs и server/app.mjs.
// При импорте ничего не открывается: подключение к PostgreSQL создаётся лениво, при первом запросе.
import {createVercelHandler} from '../server/vercel.mjs';

export default createVercelHandler();
