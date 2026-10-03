// Kamera: Start/Stopp, Taschenlampe, Ausschnitt des Kartenrahmens, Auto-Auslöser.

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.track = null;
    this.caps = {};
    this.torchOn = false;
  }

  get active() {
    return !!this.stream && this.track?.readyState === 'live';
  }

  get hasTorch() {
    return !!this.caps.torch;
  }

  async start() {
    if (this.active) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('Kamera wird von diesem Browser nicht unterstützt.'), { code: 'unsupported' });
    }
    const tries = [
      { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
      { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      { facingMode: 'environment' },
      true,
    ];
    let lastErr;
    for (const video of tries) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
        break;
      } catch (err) {
        lastErr = err;
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') break;
      }
    }
    if (!this.stream) throw lastErr;
    this.track = this.stream.getVideoTracks()[0];
    this.caps = this.track.getCapabilities?.() || {};
    try {
      const adv = {};
      if (this.caps.focusMode?.includes('continuous')) adv.focusMode = 'continuous';
      if (this.caps.exposureMode?.includes('continuous')) adv.exposureMode = 'continuous';
      if (Object.keys(adv).length) await this.track.applyConstraints({ advanced: [adv] });
    } catch {
      /* optional */
    }
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    await this.video.play().catch(() => {});
    await new Promise((resolve) => {
      if (this.video.videoWidth) resolve();
      else this.video.addEventListener('loadedmetadata', resolve, { once: true });
    });
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.torchOn = false;
    this.video.srcObject = null;
  }

  async setTorch(on) {
    if (!this.hasTorch) return false;
    try {
      await this.track.applyConstraints({ advanced: [{ torch: on }] });
      this.torchOn = on;
    } catch {
      this.torchOn = false;
    }
    return this.torchOn;
  }

  /** Bereich des Rahmens in Videopixeln (Video wird mit object-fit: cover dargestellt). */
  regionFor(guide, margin = 0.04) {
    const v = this.video;
    const vr = v.getBoundingClientRect();
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return null;
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const offX = (vr.width - vw * scale) / 2;
    const offY = (vr.height - vh * scale) / 2;
    const g = guide.getBoundingClientRect();
    const mx = g.width * margin;
    const my = g.height * margin;
    let x = (g.left - vr.left - offX - mx) / scale;
    let y = (g.top - vr.top - offY - my) / scale;
    let w = (g.width + 2 * mx) / scale;
    let h = (g.height + 2 * my) / scale;
    x = Math.max(0, x);
    y = Math.max(0, y);
    w = Math.min(vw - x, w);
    h = Math.min(vh - y, h);
    return { x, y, w, h };
  }

  /** Aktuelles Bild des Rahmenbereichs als Canvas. */
  grab(guide, { margin = 0.04, maxW = 1400 } = {}) {
    const r = this.regionFor(guide, margin);
    if (!r) return null;
    const scale = Math.min(1, maxW / r.w);
    const c = document.createElement('canvas');
    c.width = Math.round(r.w * scale);
    c.height = Math.round(r.h * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.video, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    return c;
  }

  /** Vollbild (für das eingefrorene Vorschaubild). */
  snapshot(canvas) {
    const v = this.video;
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
  }
}

/**
 * Erkennt, wann eine Karte ruhig im Rahmen liegt, und löst dann aus.
 * Misst Bildruhe (Differenz aufeinanderfolgender Frames) und Detailreichtum (Kanten).
 */
export class AutoTrigger {
  constructor(camera, guide, { onProgress, onFire }) {
    this.camera = camera;
    this.guide = guide;
    this.onProgress = onProgress;
    this.onFire = onFire;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 48;
    this.canvas.height = 67;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.prev = null;
    this.lastFired = null;
    this.stable = 0;
    this.timer = null;
    this.paused = false;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick(), 220);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.stable = 0;
    this.onProgress?.(0);
  }

  pause(v) {
    this.paused = v;
    if (v) {
      this.stable = 0;
      this.onProgress?.(0);
    }
  }

  sample() {
    const r = this.camera.regionFor(this.guide, 0);
    if (!r) return null;
    const { ctx, canvas } = this;
    ctx.drawImage(this.camera.video, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const g = new Float32Array(canvas.width * canvas.height);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = (d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 2) / 10;
    return g;
  }

  tick() {
    if (this.paused || !this.camera.active || document.hidden) return;
    const g = this.sample();
    if (!g) return;
    const W = this.canvas.width;
    let edges = 0;
    for (let y = 1; y < this.canvas.height; y++) {
      for (let x = 1; x < W; x++) {
        const i = y * W + x;
        edges += Math.abs(g[i] - g[i - 1]) + Math.abs(g[i] - g[i - W]);
      }
    }
    edges /= g.length;
    let diff = 255;
    if (this.prev) {
      diff = 0;
      for (let i = 0; i < g.length; i++) diff += Math.abs(g[i] - this.prev[i]);
      diff /= g.length;
    }
    this.prev = g;

    // Schon gescannte Szene? Erst nach deutlicher Veränderung erneut auslösen.
    let changed = true;
    if (this.lastFired) {
      let d2 = 0;
      for (let i = 0; i < g.length; i++) d2 += Math.abs(g[i] - this.lastFired[i]);
      changed = d2 / g.length > 18;
    }

    const steady = diff < 6 && edges > 9 && changed;
    this.stable = steady ? this.stable + 1 : 0;
    const needed = 5;
    this.onProgress?.(Math.min(1, this.stable / needed));
    if (this.stable >= needed) {
      this.stable = 0;
      this.lastFired = g;
      this.onFire?.();
    }
  }
}
