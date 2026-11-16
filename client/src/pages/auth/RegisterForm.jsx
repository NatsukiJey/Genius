import {useState} from 'react';
import {useAuthSubmit} from '../../hooks/useAuthSubmit.js';
import {localImportCandidate} from '../../lib/localImport.js';
import LocalImportCheckbox from './LocalImportCheckbox.jsx';

export default function RegisterForm({api, navigate}) {
  const [candidate] = useState(() => localImportCandidate());
  const {status, sending, submit} = useAuthSubmit({mode: 'register', api, navigate, getImport: () => candidate});
  return (<>
    <form id="register-form" method="post" className="auth-form" onSubmit={submit}>
      <label htmlFor="reg-username">Login</label>
      <input id="reg-username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]{3,20}" aria-describedby="reg-hint" />
      <small id="reg-hint">3–20 ta lotin harfi, raqam yoki _ . Haqorat va zararli niklar qabul qilinmaydi.</small>
      <label htmlFor="reg-password">Parol</label>
      <input id="reg-password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={256} />
      <small>Kamida 8 belgi. Parolni unutsangiz, hisobni tiklab bo‘lmaydi — brauzer menejerida saqlang.</small>
      {candidate && <LocalImportCheckbox candidate={candidate} />}
      <button className="primary" type="submit" disabled={sending}>Hisob yaratish →</button>
      <p id="auth-status" role="alert">{status}</p>
    </form>
    <p className="auth-switch">Hisobingiz bormi? <a href="/login">Kirish</a></p>
  </>);
}
