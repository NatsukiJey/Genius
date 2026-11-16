import {useAuthSubmit} from '../../hooks/useAuthSubmit.js';

export default function LoginForm({api, navigate}) {
  const {status, sending, submit} = useAuthSubmit({mode: 'login', api, navigate});
  return (<>
    <form id="login-form" method="post" className="auth-form" onSubmit={submit}>
      <label htmlFor="login-username">Login</label>
      <input id="login-username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={20} />
      <label htmlFor="login-password">Parol</label>
      <input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={256} />
      <button className="primary" type="submit" disabled={sending}>Kirish →</button>
      <p id="auth-status" role="alert">{status}</p>
    </form>
    <p className="auth-switch">Hisobingiz yo‘qmi? <a href="/register">Ro‘yxatdan o‘ting</a></p>
  </>);
}
