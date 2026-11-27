import {useTheme, toggleTheme} from '../../lib/theme.js';

// Кнопка светлой/тёмной темы. Состояние живёт в отдельном хранилище (lib/theme.js) и меняет только атрибут на <html>:
// провайдеры игры и звука не перерисовываются, сеть не трогается.
export default function ThemeButton() {
  const {theme} = useTheme(), dark = theme === 'dark';
  return (
    <button type="button" className="icon-btn" data-action="theme-toggle" aria-label="Tungi rejim" aria-pressed={dark} title="Tungi rejim" onClick={toggleTheme}>
      <span aria-hidden="true">{dark ? '☀️' : '🌙'}</span>
    </button>
  );
}
