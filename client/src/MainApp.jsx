import {useCallback, useEffect, useReducer, useRef, useState} from 'react';
import {useGame} from './state/GameContext.jsx';
import {useSound} from './state/SoundContext.jsx';
import {useToast} from './state/ToastContext.jsx';
import {lessonReducer} from './state/lessonReducer.js';
import {useActions} from './state/useActions.js';
import {useRefresh} from './hooks/useRefresh.js';
import Sidebar from './components/layout/Sidebar.jsx';
import Header from './components/layout/Header.jsx';
import Footer from './components/layout/Footer.jsx';
import LearnPage from './pages/LearnPage.jsx';
import ShopPage from './pages/ShopPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import ReportPage from './pages/ReportPage.jsx';
import DialogHost from './dialogs/DialogHost.jsx';

// Вошедший пользователь: каркас + текущая страница + окно диалога. Здесь живёт «что сейчас открыто» (page, dialog, session).
export default function MainApp() {
  const game = useGame(), {snap, store} = game, {state, user, today} = snap;
  const {sound} = useSound(), toast = useToast();
  const [page, setPage] = useState('learn'), [dialog, setDialog] = useState(null);
  const [session, dispatch] = useReducer(lessonReducer, null);
  const sessionRef = useRef(null); sessionRef.current = session;

  const actions = useActions({game, sound, toast, session, sessionRef, dispatch, setDialog, setPage});

  // Урок начат на другом устройстве: закрываем свой и честно говорим об этом.
  const onStaleLesson = useCallback(() => { dispatch({type: 'close'}); setDialog(null); toast('Dars boshqa qurilmada boshlandi. Ma’lumotlar yangilandi.'); }, [toast]);
  const hasSession = useCallback(() => !!sessionRef.current, []);
  const getSessionId = useCallback(() => sessionRef.current?.id, []);
  useRefresh({game, hasSession, getSessionId, onStaleLesson});

  // При первом показе: нет курса -> выбор курса; нет уровня -> выбор уровня; есть незаконченный урок -> продолжаем его.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; started.current = true;
    const {state: st, lesson} = store.get();
    if (!st.activeCourse) actions.openCourses();
    else if (st.tier === null) actions.openTiers();
    else if (lesson) actions.openSession(lesson, true);
  }, [store, actions]);

  const go = useCallback(id => { setPage(id); window.scrollTo?.(0, 0); }, []);
  const home = useCallback(() => setPage('learn'), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  let content;
  if (page === 'learn') content = <LearnPage state={state} today={today} onStart={actions.startLearning} onStartLevel={actions.startLevel} onExam={() => actions.startLevel(50, true)} onTiers={actions.openTiers} onShop={() => go('shop')} />;
  else if (page === 'shop') content = <ShopPage regenAt={state.regenAt} serverNow={store.serverNow} onBuy={actions.buyItem} />;
  else if (page === 'account') content = <AccountPage username={user.username} onLogout={actions.logout} />;
  else content = <ReportPage />;

  return (<>
    <div id="app">
      <Sidebar page={page} username={user.username} onNavigate={go} onHome={home} />
      <div className="main-shell">
        <Header page={page} activeCourse={state.activeCourse} onChooseCourse={actions.chooseCourse} onHome={home} />
        <main>{content}</main>
        <Footer />
      </div>
    </div>
    <DialogHost dialog={dialog} state={state} session={session} dispatch={dispatch} actions={actions} onClose={closeDialog} />
  </>);
}
