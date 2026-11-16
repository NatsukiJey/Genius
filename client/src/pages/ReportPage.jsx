import {useState} from 'react';
import {sendReport} from '../api/client.js';

// Сообщение об ошибке уходит на сервер, а сервер пересылает его в Telegram (токен лежит только на сервере).
export default function ReportPage() {
  const [message, setMessage] = useState(''), [status, setStatus] = useState(''), [sending, setSending] = useState(false);
  const submit = async e => {
    e.preventDefault(); setSending(true); setStatus('Yuborilmoqda…');
    try { await sendReport(message); setStatus('✓ Xabaringiz yuborildi. Rahmat!'); setMessage(''); }
    catch (error) { setStatus(error.message); }
    finally { setSending(false); }
  };
  return (<>
    <section className="page-heading"><div className="eyebrow">BIRGA YAXSHIROQ QILAMIZ</div><h1>Sening fikring <span>muhim.</span></h1><p>Xatolikni topdingizmi? Bizga yozing.</p></section>
    <form id="report-form" className="card report-form" onSubmit={submit}>
      <label htmlFor="message">Nima sodir bo‘ldi?</label>
      <textarea id="message" name="message" minLength={10} maxLength={2000} required value={message} onChange={e => setMessage(e.target.value)} placeholder="Qaysi levelda qanday xato ko‘rdingiz? Batafsil yozing…"></textarea>
      <small>10–2000 belgi. Parol yoki shaxsiy ma’lumot yubormang. Xabar Jenius jamoasining Telegram guruhiga yuboriladi.</small>
      <button type="submit" className="primary" disabled={sending}>Xabarni yuborish ↗</button>
      <p id="report-status" role="status">{status}</p>
    </form>
  </>);
}
