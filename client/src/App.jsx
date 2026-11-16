import {GameProvider, useGame} from './state/GameContext.jsx';
import {SoundProvider} from './state/SoundContext.jsx';
import {ToastProvider} from './state/ToastContext.jsx';
import {usePath} from './hooks/usePath.js';
import OfflineBanner from './components/layout/OfflineBanner.jsx';
import OfflineScreen from './pages/OfflineScreen.jsx';
import AuthPage from './pages/AuthPage.jsx';
import MainApp from './MainApp.jsx';
import './App.css';

// Что показать: загрузка -> (нет сети | форма входа | приложение). Баннер «нет сети» — над всем.
function Shell() {
  const {snap, retryNet, api, navigate} = useGame(), path = usePath();
  let body;
  if (snap.phase === 'ready') return (<><OfflineBanner show={snap.netDown} onRetry={retryNet} /><MainApp /></>);
  if (snap.phase === 'offline') body = <OfflineScreen onReload={() => navigate.reload()} />;
  else if (snap.phase === 'auth') body = <AuthPage mode={path === '/register' ? 'register' : 'login'} api={api} navigate={navigate} />;
  return (<><OfflineBanner show={snap.netDown} onRetry={retryNet} /><div id="app">{body}</div><div id="modal"></div></>);
}

// env — для тестов: можно подставить свой navigate/channel. В браузере не нужен.
export default function App({env}) {
  return (
    <GameProvider env={env}>
      <SoundProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </SoundProvider>
    </GameProvider>
  );
}
