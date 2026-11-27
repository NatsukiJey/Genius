import {afterEach, beforeEach, vi} from 'vitest';
import {fakeMedia} from './media.js';
import {cleanup} from '@testing-library/react';

// Каждый тест начинается с чистого браузера: пустой localStorage, адрес «/», без таймеров и без звука.
beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, '', '/');
  window.scrollTo = vi.fn();
  document.documentElement.removeAttribute('data-theme');
  window.matchMedia = fakeMedia(false);   // по умолчанию системная тема светлая; тесты темы подменяют
  globalThis.__audios = [];
  // Фальшивый Audio: запоминает, что и когда проиграли (в jsdom звука нет).
  globalThis.Audio = class FakeAudio {
    constructor(src) { this.src = src; this.volume = 1; this.currentTime = 0; this.plays = 0; this.paused = true; this.listeners = {}; globalThis.__audios.push(this); }
    play() { this.plays++; this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
    removeEventListener() {}
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
