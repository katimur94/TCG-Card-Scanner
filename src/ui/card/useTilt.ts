// Kippen per Finger und Gyroskop. Gyro auf iOS erst nach Freigabe durch einen Tipp.

import { useEffect, useRef } from 'react';
import { useMotionValue, useReducedMotion, useSpring, type MotionValue } from 'framer-motion';

type Listener = (beta: number, gamma: number) => void;
const listeners = new Set<Listener>();
let gyroOn = false;
let base: { beta: number; gamma: number } | null = null;

function onOrientation(e: DeviceOrientationEvent) {
  if (e.beta == null || e.gamma == null) return;
  // Haltung beim ersten Messwert = Ruhelage
  base ??= { beta: e.beta, gamma: e.gamma };
  const b = e.beta - base.beta;
  const g = e.gamma - base.gamma;
  listeners.forEach((fn) => fn(b, g));
}

function startGyro() {
  if (gyroOn || typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;
  gyroOn = true;
  window.addEventListener('deviceorientation', onOrientation);
}

/** Auf iOS muss der Gyro-Zugriff aus einem Tipp heraus erlaubt werden. */
export async function requestGyro() {
  const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } })
    .DeviceOrientationEvent;
  if (D?.requestPermission) {
    try {
      if ((await D.requestPermission()) === 'granted') startGyro();
    } catch {
      /* abgelehnt */
    }
  } else startGyro();
}

export interface Tilt {
  rx: MotionValue<number>;
  ry: MotionValue<number>;
  gx: MotionValue<number>; // Glanz-Position 0..100
  gy: MotionValue<number>;
  bind: {
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerLeave: () => void;
  };
  reduced: boolean;
}

export function useTilt(max = 14): Tilt {
  const reduced = !!useReducedMotion();
  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const spring = { stiffness: 180, damping: 18, mass: 0.6 };
  const rx = useSpring(ty, spring);
  const ry = useSpring(tx, spring);
  const gx = useSpring(useMotionValue(50), spring);
  const gy = useSpring(useMotionValue(30), spring);
  const touching = useRef(false);

  useEffect(() => {
    if (reduced) return;
    const fn: Listener = (b, g) => {
      if (touching.current) return;
      const clampv = (v: number) => Math.max(-1, Math.min(1, v));
      const nx = clampv(g / 25);
      const ny = clampv(b / 25);
      tx.set(nx * max);
      ty.set(-ny * max);
      gx.set(50 + nx * 40);
      gy.set(40 + ny * 40);
    };
    listeners.add(fn);
    startGyro();
    return () => {
      listeners.delete(fn);
    };
  }, [reduced, max, tx, ty, gx, gy]);

  const bind = {
    onPointerMove: (e: React.PointerEvent) => {
      if (reduced) return;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      touching.current = true;
      tx.set((px - 0.5) * 2 * max);
      ty.set(-(py - 0.5) * 2 * max);
      gx.set(px * 100);
      gy.set(py * 100);
    },
    onPointerLeave: () => {
      touching.current = false;
      tx.set(0);
      ty.set(0);
      gx.set(50);
      gy.set(30);
    },
  };
  return { rx, ry, gx, gy, bind, reduced };
}
