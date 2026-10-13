// 3D-Neigung mit Holo-Glanz – reagiert auf Finger/Maus und (wenn erlaubt) Gyroskop.

import { clamp } from '../util.js';

const active = new Set();
let gyroBound = false;

function apply(el, px, py, strength = 1) {
  // px/py: 0..1 relativ zur Karte
  const rx = (0.5 - py) * 22 * strength;
  const ry = (px - 0.5) * 26 * strength;
  el.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
  el.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
  el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
  el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
  el.style.setProperty('--o', '1');
}

function reset(el) {
  el.classList.remove('is-active');
  el.style.setProperty('--rx', '0deg');
  el.style.setProperty('--ry', '0deg');
  el.style.setProperty('--o', '0');
}

function onOrientation(e) {
  if (e.beta == null || e.gamma == null) return;
  const px = clamp(0.5 + e.gamma / 50, 0, 1);
  const py = clamp(0.5 + (e.beta - 45) / 60, 0, 1);
  for (const el of active) {
    if (!el.isConnected) {
      active.delete(el);
      continue;
    }
    if (el.classList.contains('is-active')) continue;
    apply(el, px, py, 0.6);
  }
}

export function enableHolo(el) {
  if (!el) return;
  active.add(el);
  const move = (e) => {
    const r = el.getBoundingClientRect();
    const px = clamp((e.clientX - r.left) / r.width, 0, 1);
    const py = clamp((e.clientY - r.top) / r.height, 0, 1);
    el.classList.add('is-active');
    apply(el, px, py);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerdown', move);
  el.addEventListener('pointerleave', () => reset(el));
  el.addEventListener('pointercancel', () => reset(el));
  el.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') reset(el);
  });

  if (!gyroBound && 'DeviceOrientationEvent' in window && typeof DeviceOrientationEvent.requestPermission !== 'function') {
    gyroBound = true;
    window.addEventListener('deviceorientation', onOrientation, { passive: true });
  }
  // sanfter Einstieg
  requestAnimationFrame(() => {
    apply(el, 0.7, 0.3, 0.5);
    setTimeout(() => reset(el), 650);
  });
}

/** iOS verlangt eine Erlaubnis für Bewegungssensoren (nur nach Nutzeraktion). */
export async function requestGyro() {
  if (gyroBound || typeof DeviceOrientationEvent?.requestPermission !== 'function') return;
  try {
    if ((await DeviceOrientationEvent.requestPermission()) === 'granted') {
      gyroBound = true;
      window.addEventListener('deviceorientation', onOrientation, { passive: true });
    }
  } catch {
    /* abgelehnt */
  }
}
