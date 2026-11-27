/* Jenius theme boot v1: ставит data-theme на <html> ДО загрузки CSS/бандла (нет белой вспышки). Без inline-кода, CSP 'self'.
   Файл не имеет хеша, а кеш «immutable»: при ЛЮБОМ изменении переименуйте в theme-boot-v2.js и обновите client/index.html + тест. */
(function () {
  try {
    var t = null;
    try { t = window.localStorage.getItem('jenius.theme'); } catch (e) {}
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
