// Kurze Hinweise oben am Bildschirm.

import { esc } from '../util.js';

const root = () => document.getElementById('toasts');

/**
 * @param {string} message
 * @param {{type?: 'info'|'success'|'error', image?: string, price?: string, action?: {label, fn}, ms?: number}} opts
 */
export function toast(message, { type = 'info', image, price, action, ms = 3200 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    ${image ? `<img src="${esc(image)}" alt="" onerror="this.remove()">` : '<span class="t-dot"></span>'}
    <span>${esc(message)}${price ? ` <span class="t-price">${esc(price)}</span>` : ''}</span>
    ${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) {
    el.querySelector('button').addEventListener('click', () => {
      action.fn();
      close();
    });
  }
  const close = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 260);
  };
  el.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') close();
  });
  root().append(el);
  while (root().children.length > 3) root().firstElementChild.remove();
  setTimeout(close, ms);
  return close;
}

/** Kleiner Glitzer-Effekt für wertvolle Funde. */
export function sparkle(x = window.innerWidth / 2, y = window.innerHeight / 2) {
  const wrap = document.createElement('div');
  wrap.className = 'sparkle-burst';
  const colors = ['#ffe08a', '#ff8ad8', '#8f9bff', '#5ff3d6', '#f5c451', '#fff'];
  for (let i = 0; i < 36; i++) {
    const p = document.createElement('i');
    const a = (Math.PI * 2 * i) / 36 + Math.random() * 0.3;
    const dist = 80 + Math.random() * 160;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(a) * dist + 60}px`);
    p.style.setProperty('--r', `${Math.random() * 540}deg`);
    p.style.animationDelay = `${Math.random() * 0.08}s`;
    wrap.append(p);
  }
  document.body.append(wrap);
  setTimeout(() => wrap.remove(), 1500);
}
