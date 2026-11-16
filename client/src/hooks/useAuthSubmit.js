import {useCallback, useState} from 'react';
import {markMigrated} from '../lib/localImport.js';

// Отправка формы входа/регистрации: честные статусы, лимиты (429), редирект location.replace('/').
export function useAuthSubmit({mode, api, navigate, getImport}) {
  const [status, setStatus] = useState(''), [sending, setSending] = useState(false);
  const submit = useCallback(async e => {
    e.preventDefault();
    const form = e.currentTarget, username = form.elements.username.value.trim(), password = form.elements.password.value;
    setSending(true); setStatus('Yuborilmoqda…');
    const body = {username, password};
    if (mode === 'register' && form.elements.import?.checked) { const c = getImport(); if (c) body.importLocal = c; }
    const r = await (mode === 'register' ? api.register(body) : api.login(body));
    setSending(false);
    if (r.netError || r.status === 0) { setStatus('Server bilan aloqa yo‘q. Keyinroq urinib ko‘ring.'); return; }
    if (r.status !== 200) {
      let msg = r.data.error || 'Xatolik yuz berdi.';
      if (r.status === 429 && r.data.retryAfter) msg += ` (${Math.ceil(r.data.retryAfter / 60)} daqiqadan keyin)`;
      setStatus(msg); return;
    }
    if (mode === 'register' && r.data.imported) markMigrated(r.data.user.username);
    setStatus('✓ Tayyor! Yo‘naltirilmoqda…');
    navigate.replace('/');
  }, [mode, api, navigate, getImport]);
  return {status, sending, submit};
}
