// Hauptthread-Seite der Bilderkennung: spricht mit dem Worker, wandelt Bilder in Pixel-Arrays.

import type { AnalyzeResult, DetectResult, ImageLang, RGBA, VisionRequest, VisionResponse } from './visionProtocol';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Payload = VisionRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module', name: 'holoscan-vision' });
  worker.onmessage = (e: MessageEvent<VisionResponse>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Bilderkennung abgestürzt'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  call({ type: 'init', base: new URL(import.meta.env.BASE_URL, location.href).href });
  return worker;
}

function call<T>(msg: Payload, transfer: Transferable[] = []): Promise<T> {
  const w = getWorker();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ ...msg, id }, transfer);
  });
}

/** Modell und Index im Hintergrund laden (ca. 30 MB beim ersten Mal, danach aus dem Cache). */
export const warmupVision = () => call<boolean>({ type: 'warmup' });
export const visionReady = () => call<boolean>({ type: 'ready' });

/** Alle Karten in einem Bild finden und per Bildsuche zuordnen. Das Bild wird übergeben (nicht kopiert). */
export function analyzeImage(image: RGBA, opts?: { straight?: boolean; single?: boolean }) {
  return call<AnalyzeResult>({ type: 'analyze', image, opts }, [image.data.buffer]);
}

/** Schnelle Kartensuche (ohne Bildmodell) für die Live-Vorschau. */
export function detectFast(image: RGBA, side = 360) {
  return call<DetectResult>({ type: 'detect', image, side }, [image.data.buffer]);
}

export function imageLanguage(view: RGBA, setId: string, localId: string) {
  const copy: RGBA = { width: view.width, height: view.height, data: new Uint8ClampedArray(view.data) };
  return call<ImageLang | null>({ type: 'lang', view: copy, setId, localId }, [copy.data.buffer]);
}

// ---------- Bilder <-> Pixel ----------

/** Datei (Galerie) laden, EXIF-Drehung beachten, auf maxSide verkleinern. */
export async function fileToRGBA(file: Blob, maxSide = 2000): Promise<RGBA> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    return bitmapToRGBA(bmp, maxSide);
  } finally {
    bmp.close();
  }
}

export function bitmapToRGBA(src: CanvasImageSource & { width: number; height: number }, maxSide = 2000, sw?: number, sh?: number): RGBA {
  const w0 = sw ?? src.width;
  const h0 = sh ?? src.height;
  const s = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s));
  const h = Math.max(1, Math.round(h0 * s));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  return { data: d.data, width: w, height: h };
}

export function rgbaToCanvas(img: RGBA): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

export function rgbaToBlob(img: RGBA, quality = 0.82): Promise<Blob> {
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c.convertToBlob({ type: 'image/jpeg', quality });
}
