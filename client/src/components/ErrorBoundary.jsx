import {Component} from 'react';

// Последняя линия обороны от «белого экрана»: если React падает при показе, человек видит понятный текст и кнопку, а не пустую страницу.
export default class ErrorBoundary extends Component {
  state = {error: null};
  static getDerivedStateFromError(error) { return {error}; }
  componentDidCatch(error) { console.error('Jenius UI crashed:', error); }
  render() {
    const {error} = this.state;
    if (!error) return this.props.children;
    const reload = this.props.onReload || (() => window.location.reload());
    return (
      <div className="auth-wrap"><section className="card auth-card" role="alert">
        <h1>Xatolik yuz berdi</h1>
        <p className="auth-lead">Ilova kutilmagan xatoga duch keldi. Sahifani qayta yuklab ko‘ring.</p>
        <p className="boot-detail">{String(error && error.message || error)}</p>
        <button className="primary" type="button" onClick={reload}>Qayta yuklash</button>
      </section></div>
    );
  }
}
