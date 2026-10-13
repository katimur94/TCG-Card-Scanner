// Rückkamera (mind. 1080p), Taschenlampe, Einzelbilder. Start ist gegen Doppelaufrufe geschützt:
// ein laufender Start wird geteilt, und ein Stopp während des Starts schließt den Stream sofort wieder.

import type { RGBA } from './rgba';
import { bitmapToRGBA } from './vision';

type Caps = MediaTrackCapabilities & { torch?: boolean; focusMode?: string[]; exposureMode?: string[] };

export class Camera {
  video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private starting: Promise<void> | null = null;
  private wanted = false;
  caps: Caps = {};
  torchOn = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  get active() {
    return !!this.stream?.active;
  }
  get hasTorch() {
    return !!this.caps.torch;
  }

  start(): Promise<void> {
    this.wanted = true;
    if (this.active) return Promise.resolve();
    this.starting ||= this.open().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async open() {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('Kamera wird von diesem Browser nicht unterstützt.'), { name: 'Unsupported' });
    const tries: MediaTrackConstraints[] = [
      { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      { facingMode: { ideal: 'environment' } },
    ];
    let stream: MediaStream | null = null;
    let lastErr: unknown;
    for (const video of tries) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
        break;
      } catch (err) {
        lastErr = err;
        if ((err as Error).name === 'NotAllowedError' || (err as Error).name === 'SecurityError') break;
      }
    }
    if (!stream) throw lastErr;
    // Während des Starts wurde gestoppt (z. B. Binder geöffnet): sofort wieder schließen
    if (!this.wanted) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    this.track = stream.getVideoTracks()[0];
    this.caps = (this.track.getCapabilities?.() as Caps) || {};
    try {
      const adv: Record<string, string> = {};
      if (this.caps.focusMode?.includes('continuous')) adv.focusMode = 'continuous';
      if (this.caps.exposureMode?.includes('continuous')) adv.exposureMode = 'continuous';
      if (Object.keys(adv).length) await this.track.applyConstraints({ advanced: [adv as MediaTrackConstraintSet] });
    } catch {
      /* optional */
    }
    this.video.srcObject = stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play().catch(() => {});
    if (!this.video.videoWidth) await new Promise((r) => this.video.addEventListener('loadedmetadata', r, { once: true }));
  }

  stop() {
    this.wanted = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.torchOn = false;
    this.video.srcObject = null;
  }

  async setTorch(on: boolean) {
    if (!this.hasTorch || !this.track) return false;
    try {
      await this.track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      this.torchOn = on;
    } catch {
      this.torchOn = false;
    }
    return this.torchOn;
  }

  /** Vorschaubild (klein) für die schnelle Kartensuche. */
  frame(maxSide = 640): RGBA | null {
    const v = this.video;
    if (!v.videoWidth) return null;
    return bitmapToRGBA(v, maxSide, v.videoWidth, v.videoHeight);
  }

  /** Volles Foto: ImageCapture (beste Auflösung), sonst das aktuelle Videobild. */
  async photo(maxSide = 2000): Promise<RGBA | null> {
    const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> } }).ImageCapture;
    if (IC && this.track) {
      try {
        const bmp = await new IC(this.track).grabFrame();
        try {
          return bitmapToRGBA(bmp, maxSide);
        } finally {
          bmp.close();
        }
      } catch {
        /* Videobild nehmen */
      }
    }
    return this.frame(maxSide);
  }

  /** Abbildung Videopixel -> Bildschirm (Video mit object-fit: cover). */
  toScreen(): ((x: number, y: number) => [number, number]) | null {
    const v = this.video;
    const r = v.getBoundingClientRect();
    if (!v.videoWidth) return null;
    const s = Math.max(r.width / v.videoWidth, r.height / v.videoHeight);
    const ox = r.left + (r.width - v.videoWidth * s) / 2;
    const oy = r.top + (r.height - v.videoHeight * s) / 2;
    return (x, y) => [ox + x * s, oy + y * s];
  }
}

/** Kamera schon erlaubt? Dann kann sie ohne Tipp starten. */
export async function cameraGranted(): Promise<boolean> {
  try {
    const p = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    return p?.state === 'granted';
  } catch {
    return false;
  }
}
