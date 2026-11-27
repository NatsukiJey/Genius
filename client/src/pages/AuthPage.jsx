import Mascot from '../components/layout/Mascot.jsx';
import SoundButton from '../components/sound/SoundButton.jsx';
import ThemeButton from '../components/theme/ThemeButton.jsx';
import LoginForm from './auth/LoginForm.jsx';
import RegisterForm from './auth/RegisterForm.jsx';
import GoogleDisabledNote from './auth/GoogleDisabledNote.jsx';

export default function AuthPage({mode, api, navigate}) {
  const reg = mode === 'register';
  return (
    <div className="auth-wrap"><section className="card auth-card">
      <div className="auth-tools"><SoundButton where="auth" /><ThemeButton /></div>
      <Mascot size="mini" />
      <div className="eyebrow">JENIUS</div>
      <h1>{reg ? 'Hisob yaratish' : 'Kirish'}</h1>
      <p className="auth-lead">{reg ? 'Natijalaringiz serverda saqlanadi.' : 'Natijalaringiz serverdagi hisobingizda.'}</p>
      {reg ? <RegisterForm api={api} navigate={navigate} /> : <><LoginForm api={api} navigate={navigate} /><GoogleDisabledNote variant="login" /></>}
    </section></div>
  );
}
