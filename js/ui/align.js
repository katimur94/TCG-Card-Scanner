// Foto aus der Galerie per Zoomen, Verschieben und Drehen in den Kartenrahmen legen.

import { clamp } from '../util.js';

const CARD_ASPECT = 63 / 88;

export class PhotoAligner {
  /**
   * @param {HTMLElement} layer   Ebene über dem Kamerabild (fängt die Gesten)
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} guide   Kartenrahmen
   */
  constructor(layer, canvas, guide) {
    this.layer = layer;
    this.canvas = canvas;
    this.guide = guide;
    this.ctx = canvas.getContext('2d');
    this.img = null;
    this.s = 1;
    this.tx = 0;
    this.ty = 0;
    this.rot = 0;
    this.locked = false;
    this.pointers = new Map();
    this.lastTap = 0;
    this.bind();
  }

  get active() {
    return !!this.img;
  }

  /** Größe des (gedrehten) Bildes in Bildpixeln */
  imgSize() {
    const { width: w, height: h } = this.img;
    return Math.round(this.rot / (Math.PI / 2)) % 2 ? [h, w] : [w, h];
  }

  layout() {
    const r = this.layer.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.dpr = dpr;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
  }

  guideRect() {
    const l = this.layer.getBoundingClientRect();
    const g = this.guide.getBoundingClientRect();
    return { x: g.left - l.left, y: g.top - l.top, w: g.width, h: g.height };
  }

  /** Startansicht: Foto ≈ Karte -> direkt in den Rahmen, sonst ganz zeigen. */
  fit() {
    const [iw, ih] = this.imgSize();
    const g = this.guideRect();
    const aspect = iw / ih;
    const contain = Math.min(this.w / iw, this.h / ih);
    // Nur fast exakt kartenförmige Bilder (z. B. zugeschnittene Scans); Handyfotos haben 3:4 = 0.75
    if (aspect > CARD_ASPECT * 0.96 && aspect < CARD_ASPECT * 1.04) {
      this.s = Math.min(g.w / iw, g.h / ih);
      this.tx = g.x + g.w / 2;
      this.ty = g.y + g.h / 2;
    } else {
      this.s = contain * 0.96;
      this.tx = this.w / 2;
      this.ty = g.y + g.h / 2;
    }
    this.minS = contain * 0.25;
    this.maxS = Math.max(contain * 20, 6);
    this.baseS = this.s;
  }

  open(img) {
    this.img = img;
    this.rot = 0;
    this.layer.hidden = false;
    this.layout();
    this.fit();
    this.draw();
  }

  close() {
    this.img?.close?.();
    this.img = null;
    this.pointers.clear();
    this.layer.hidden = true;
  }

  rotate() {
    if (!this.img) return;
    this.rot = (this.rot + Math.PI / 2) % (Math.PI * 2);
    this.draw();
  }

  relayout() {
    if (!this.img) return;
    const ow = this.w;
    const oh = this.h;
    this.layout();
    this.tx *= this.w / ow;
    this.ty *= this.h / oh;
    this.draw();
  }

  render(ctx, k, ox, oy) {
    ctx.setTransform(k, 0, 0, k, -ox * k, -oy * k);
    ctx.translate(this.tx, this.ty);
    ctx.rotate(this.rot);
    ctx.scale(this.s, this.s);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.img, -this.img.width / 2, -this.img.height / 2);
  }

  draw() {
    if (!this.img) return;
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05040b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.render(ctx, this.dpr, 0, 0);
  }

  zoomAt(factor, cx, cy) {
    const ns = clamp(this.s * factor, this.minS, this.maxS);
    const f = ns / this.s;
    this.tx = cx - (cx - this.tx) * f;
    this.ty = cy - (cy - this.ty) * f;
    this.s = ns;
  }

  /**
   * Bereich im Rahmen (plus Rand) als Canvas in Bildauflösung.
   * @returns {HTMLCanvasElement}
   */
  crop(margin = 0.04) {
    const g = this.guideRect();
    const mx = g.w * margin;
    const my = g.h * margin;
    const x = g.x - mx;
    const y = g.y - my;
    const w = g.w + 2 * mx;
    const h = g.h + 2 * my;
    // so viele Bildpixel, wie das Foto im Rahmen hergibt (begrenzt)
    const outW = clamp(Math.round(w / this.s), 700, 1400);
    const k = outW / w;
    const c = document.createElement('canvas');
    c.width = outW;
    c.height = Math.round(h * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, c.width, c.height);
    this.render(ctx, k, x, y);
    return c;
  }

  // ---------- Gesten ----------

  point(e) {
    const r = this.layer.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  bind() {
    const L = this.layer;
    L.addEventListener('pointerdown', (e) => {
      if (!this.img || this.locked) return;
      L.setPointerCapture?.(e.pointerId);
      const p = this.point(e);
      this.pointers.set(e.pointerId, p);
      this.moved = false;
      this.downAt = p;
    });
    L.addEventListener('pointermove', (e) => {
      if (!this.img || this.locked || !this.pointers.has(e.pointerId)) return;
      const p = this.point(e);
      const prev = this.pointers.get(e.pointerId);
      if (this.pointers.size === 1) {
        this.tx += p.x - prev.x;
        this.ty += p.y - prev.y;
      } else if (this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)[1];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
        const d1 = Math.hypot(p.x - other.x, p.y - other.y);
        const m0 = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
        const m1 = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
        if (d0 > 4) this.zoomAt(d1 / d0, m1.x, m1.y);
        this.tx += m1.x - m0.x;
        this.ty += m1.y - m0.y;
      }
      if (this.downAt && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 6) this.moved = true;
      this.pointers.set(e.pointerId, p);
      this.draw();
    });
    const up = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const p = this.point(e);
      this.pointers.delete(e.pointerId);
      // Doppeltippen: hineinzoomen bzw. zurück zur Startansicht
      if (!this.moved && this.pointers.size === 0 && e.type === 'pointerup') {
        const now = performance.now();
        if (now - this.lastTap < 320) {
          if (this.s > this.baseS * 1.15) this.fit();
          else this.zoomAt(2.2, p.x, p.y);
          this.draw();
          this.lastTap = 0;
        } else this.lastTap = now;
      }
    };
    L.addEventListener('pointerup', up);
    L.addEventListener('pointercancel', up);
    L.addEventListener(
      'wheel',
      (e) => {
        if (!this.img || this.locked) return;
        e.preventDefault();
        const p = this.point(e);
        this.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
        this.draw();
      },
      { passive: false },
    );
    // iOS Safari: Seiten-Zoom bei Zwei-Finger-Gesten auf der Ebene verhindern
    for (const evt of ['gesturestart', 'gesturechange']) L.addEventListener(evt, (e) => e.preventDefault());
    window.addEventListener('resize', () => this.relayout());
  }
}
