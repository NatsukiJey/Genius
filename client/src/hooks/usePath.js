import {useEffect, useState} from 'react';

// Три адреса без react-router: / (приложение), /login, /register. После входа делаем location.replace('/'),
// поэтому браузер видит настоящий переход и предлагает сохранить пароль.
export function usePath() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return path;
}
