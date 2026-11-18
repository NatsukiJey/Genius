import {useCallback} from 'react';
import {givenOf} from './lessonReducer.js';
import {answerOf} from '@shared/data.mjs';
import {secondsLeft} from '../lib/format.js';
import {sleep} from '../api/client.js';

// Все действия пользователя, которые идут на сервер. Текст сообщений (узбекский) — как в оригинале.
// Правила: перед ответом сервера ничего не «засчитываем»; нет сети -> честное сообщение; 409 -> данные берём заново.
export function useActions({game, sound, toast, session, sessionRef, dispatch, setDialog, setPage}) {
  const {store, api, exclusive, navigate, channel} = game;
  const closeAll = useCallback(() => { dispatch({type: 'close'}); setDialog(null); }, [dispatch, setDialog]);
  const openCourses = useCallback(() => setDialog({kind: 'courses'}), [setDialog]);
  const openTiers = useCallback(() => setDialog({kind: 'tiers', course: store.get().state.activeCourse}), [setDialog, store]);

  const openSession = useCallback((lesson, resumed) => {
    dispatch({type: 'open', lesson, resumed});
    setDialog({kind: 'session'});
  }, [dispatch, setDialog, sound]);

  const doCourse = useCallback(id => exclusive(async () => {
    const r = await api.course(id);
    if (r.netError) return toast('Server bilan aloqa yo‘q — kurs almashmadi.');
    if (r.status !== 200) { setDialog(null); return toast('Kursni almashtirib bo‘lmadi. Ma’lumotlar yangilandi.'); }
    dispatch({type: 'close'}); setDialog(null); setPage('learn');
    const a = r.data.abandoned;
    if (a) toast(a.cooldown ? 'Dars to‘xtatildi. Yakuniy test uchun 5 daqiqa kutish eski kursga yozildi.' : 'Dars to‘xtatildi.');
    if (store.get().state.tier === null) openTiers();
  }), [exclusive, api, toast, setDialog, dispatch, setPage, store, openTiers]);

  const chooseCourse = useCallback(id => {
    if (game.busy.current) return;
    const {state, lesson} = store.get();
    if (state.activeCourse === id) { setDialog(null); return; }
    if (state.activeCourse && lesson) { setDialog({kind: 'confirm-course', id}); return; }
    doCourse(id);
  }, [game.busy, store, setDialog, doCourse]);

  const pickTier = useCallback((tier, course) => exclusive(async () => {
    const r = await api.tier(tier, course);
    if (r.netError) return toast('Server bilan aloqa yo‘q — tanlov saqlanmadi.');
    if (r.status === 409) {
      setDialog(null);
      toast('Kurs boshqa joyda o‘zgargan. Tanlov saqlanmadi — qaytadan tanlang.');
      if (!store.get().state.activeCourse) openCourses(); else openTiers();
      return;
    }
    setDialog(null);
  }), [exclusive, api, toast, setDialog, store, openCourses, openTiers]);

  const startLevel = useCallback((level, exam = false) => exclusive(async () => {
    const {state} = store.get(), t = state.tier ?? 0;
    if (!state.hearts) { toast('Jonlar tugadi. Shop yoki tiklanishni kuting.'); setPage('shop'); return; }
    const r = await api.startLesson({course: state.activeCourse, tier: t, level, exam});
    if (r.netError) return toast('Server bilan aloqa yo‘q. Level boshlanmadi.');
    if (r.status !== 200) {
      const e = r.data.error;
      if (e === 'cooldown') toast(`Qayta urinishgacha ${secondsLeft(r.data.retryAt, store.serverNow())} soniya.`);
      else if (e === 'no_hearts') { toast('Jonlar tugadi. Shop yoki tiklanishni kuting.'); setPage('shop'); }
      else toast('Bu level hozir ochiq emas. Ma’lumotlar yangilandi.');
      return;
    }
    openSession(r.data.lesson, false);
  }), [exclusive, store, api, toast, setPage, openSession]);

  // Кнопка «Tekin o‘qish»: по очереди — курс, уровень, следующий level или экзамен.
  const startLearning = useCallback(() => {
    const {state} = store.get();
    if (!state.activeCourse) openCourses();
    else if (state.tier === null) openTiers();
    else if (state.completed[state.tier].length === 50) startLevel(50, true);
    else startLevel(state.completed[state.tier].length + 1);
  }, [store, openCourses, openTiers, startLevel]);

  const check = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || s.answered || s.pending || game.busy.current) return;
    const q = s.items[s.index];
    // Если прошлая отправка не подтверждена, шлём именно ЕЁ (тот же lessonId+index+given): сервер повторит результат без штрафа и второй награды.
    const un = s.unconfirmed && s.unconfirmed.index === s.index ? s.unconfirmed : null, given = un ? un.given : givenOf(s);
    if (!given.trim()) { toast('Avval javob kiriting.'); return; }
    game.busy.current = true; dispatch({type: 'pending', value: true});
    let r = await api.answer(s.id, s.index, given);
    // Только ответ в уроке повторяем сами и только с теми же данными (идемпотентно на сервере). Остальные записи — никогда вслепую.
    for (const d of game.retryDelays) {
      if (!r.netError) break;
      await sleep(d);
      const cur = sessionRef.current;
      if (!cur || cur.id !== s.id || cur.index !== s.index) { game.busy.current = false; return; } // урок закрыт/сменился, пока ждали
      r = await api.answer(s.id, s.index, given);
    }
    game.busy.current = false;
    if (r.netError) { dispatch({type: 'unconfirmed', index: s.index, given}); toast('Server javobi kelmadi — javob saqlanganmi, noma’lum. Qayta bossangiz, o‘sha javob xavfsiz qayta yuboriladi.'); return; }
    if (r.status === 409) {
      const L = r.data.lesson; // тот же урок, но сервер ушёл вперёд (напр. ответ уже принят): подтягиваем индекс, а не закрываем урок
      if (L && L.id === s.id) { dispatch({type: 'open', lesson: L, resumed: true}); toast('Dars yangilandi: javob serverda allaqachon qayd etilgan.'); return; }
      closeAll(); toast('Dars boshqa joyda o‘zgargan. Ma’lumotlar yangilandi.'); return;
    }
    if (r.status !== 200) { dispatch({type: 'pending', value: false}); toast('Javob qabul qilinmadi.'); return; }
    const res = r.data.result;
    // Звук «правильно» — только ПОСЛЕ подтверждения сервера.
    if (res.correct) sound.play('correct');
    dispatch({type: 'answered', result: {...res, answer: res.answer || answerOf(q.type, q.word)}});
  }, [sessionRef, game.busy, game.retryDelays, api, dispatch, toast, sound, closeAll]);

  const next = useCallback(() => {
    const s = sessionRef.current, res = s?.last;
    if (!s || !res) return;
    if (res.outcome === 'no_hearts') {
      sound.playOnce(`${s.id}:no_hearts`, 'lose'); closeAll(); setPage('shop');
      toast('Jonlar tugadi. Jon tiklangach qayta urinib ko‘ring.'); return;
    }
    if (res.outcome === 'continue') { dispatch({type: 'advance'}); return; }
    if (res.outcome === 'review') { sound.playOnce(`${s.id}:review`, 'lose'); dispatch({type: 'toReview'}); return; }
    const passed = res.outcome !== 'exam_failed';
    sound.playOnce(`${s.id}:${res.outcome}`, passed ? 'win' : 'lose');
    dispatch({type: 'close'});
    setDialog({kind: 'result', passed, reward: res.reward, correct: s.correct, total: s.items.length, exam: s.exam, typos: s.typos});
  }, [sessionRef, sound, closeAll, setPage, toast, dispatch, setDialog]);

  const exitLesson = useCallback(async () => {
    const s = sessionRef.current;
    closeAll();
    if (s) {
      game.busy.current = true;
      const r = await api.abandon(s.id);
      game.busy.current = false;
      if (r.netError) toast('Chiqish serverga yetib bormadi.');
    }
  }, [sessionRef, closeAll, game.busy, api, toast]);

  const retryLesson = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || game.busy.current) return;
    game.busy.current = true;
    const r = await api.retryLesson(s.id);
    game.busy.current = false;
    if (r.netError) return toast('Server bilan aloqa yo‘q. Qayta urinib ko‘ring.');
    if (r.status !== 200) { closeAll(); toast('Dars o‘zgargan. Ma’lumotlar yangilandi.'); return; }
    dispatch({type: 'restart'});
  }, [sessionRef, game.busy, api, toast, closeAll, dispatch]);

  const buyItem = useCallback(item => exclusive(async () => {
    const r = await api.purchase(item);
    if (r.netError) return toast('Server bilan aloqa yo‘q — xarid saqlanmadi.');
    toast(r.data.purchase?.message || 'Xarid amalga oshmadi.');
  }), [exclusive, api, toast]);

  const logout = useCallback(async () => {
    const r = await api.logout();
    if (r.netError) return toast('Chiqish bajarilmadi: server bilan aloqa yo‘q.');
    channel?.postMessage('logout');
    navigate.replace('/login');
  }, [api, toast, channel, navigate]);

  return {openCourses, openTiers, openSession, chooseCourse, doCourse, pickTier, startLevel, startLearning, check, next, exitLesson, retryLesson, buyItem, logout, closeAll};
}
