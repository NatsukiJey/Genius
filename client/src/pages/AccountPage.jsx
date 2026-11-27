import GoogleDisabledNote from './auth/GoogleDisabledNote.jsx';
import {resetTheme} from '../lib/theme.js';

export default function AccountPage({username, onLogout}) {
  return (<>
    <section className="page-heading"><div className="eyebrow">SENING HISOBING</div><h1>Salom, <span>{username}!</span></h1><p>Natijalar shu serverdagi hisobingizda saqlanadi.</p></section>
    <div className="card account-card">
      <p><b>Login:</b> {username}</p>
      <p>Tanga, jon, level va strayk serverda hisoblanadi va saqlanadi. Boshqa qurilmada shu login bilan kirsangiz, o‘sha natijani ko‘rasiz — faqat o‘sha qurilma serverga ulana olsa (boshqa qurilmalar uchun server HTTPS orqali ochiq manzilda bo‘lishi kerak).</p>
      <p>Server bilan aloqa uzilsa, natija saqlanmaydi: ilova buni ochiq aytadi.</p>
      <p className="warn-note">Parolni unutsangiz, hisobni tiklab bo‘lmaydi. Parolni brauzer menejerida saqlang.</p>
      <p><button type="button" className="text-link" data-action="theme-reset" onClick={resetTheme}>Tizim sozlamasiga qaytarish</button> <small>Tungi/kunduzgi rejim shu qurilmada saqlanadi.</small></p>
      <GoogleDisabledNote variant="account" />
      <button className="primary" type="button" data-action="logout" onClick={onLogout}>Chiqish ↪</button>
    </div>
  </>);
}
