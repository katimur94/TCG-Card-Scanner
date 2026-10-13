// Arbeitet die Warteschlange ab (Galerie-Bilder, Kamera-Aufnahmen): Karten finden, erkennen, auf den Stapel legen.

import { useStack, stackSettings, type StackEntry, type StackOption } from '../state/stack';
import { toast } from '../state/ui';
import { fileToRGBA, rgbaToBlob } from './vision';
import { recognizeImage, type Recognized } from './recognize';
import { resize, gray, type RGBA } from './rgba';
import { haptic } from '../lib/util';

let running = false;

/** 64-bit-Differenz-Hash (dHash) eines Kartenbildes – für den Doppel-Schutz. */
export function dhash(view: RGBA): number[] {
  const g = gray(resize(view, 9, 8));
  const bits: number[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(g[y * 9 + x] > g[y * 9 + x + 1] ? 1 : 0);
  return bits;
}

export const hamming = (a: number[], b: number[]) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);

const option = (c: Recognized['options'][number]): StackOption => ({ group: c.group, setId: c.setId, localId: c.localId, name: c.name, setName: c.set?.nl?.de || c.set?.n });

/** Erkanntes Ergebnis -> Stapel-Eintrag (mit Ausschnitt als Foto). */
export async function toEntry(r: Recognized): Promise<Omit<StackEntry, 'id' | 'createdAt'>> {
  const src = r.card.straight || r.card.view;
  const small = src.width > 420 ? resize(src, 420, Math.round((420 * src.height) / src.width)) : src;
  return {
    status: r.best ? r.status : 'none',
    photo: await rgbaToBlob(small, 0.8),
    best: r.best ? option(r.best) : null,
    options: r.options.map(option),
    lang: r.lang,
    langSource: r.langSource,
    langOptions: r.langOptions,
    reason: r.reason,
    sim: r.card.matches[0]?.sim ?? 0,
    fp: dhash(r.card.view),
  };
}

/** Warteschlange abarbeiten (läuft im Hintergrund, Mehrfachaufruf harmlos). */
export async function processQueue() {
  if (running) return;
  running = true;
  const st = useStack.getState;
  try {
    let done = 0;
    while (st().queue.length) {
      const item = st().queue[0];
      const total = done + st().queue.length;
      st().setWorking({ label: total > 1 ? `Bild ${done + 1} von ${total}` : 'Bild wird erkannt', done, total });
      try {
        const img = await fileToRGBA(item.blob, 2000);
        const results = await recognizeImage(img, {
          ...stackSettings(),
          onStatus: (s) => s && st().setWorking({ label: s, done, total }),
          onCard: async (r) => {
            await st().push(await toEntry(r));
            haptic(10);
          },
        });
        if (!results.length) toast({ text: `${item.name || 'Bild'}: keine Karte gefunden`, tone: 'loss' });
      } catch (err) {
        console.error('[HoloScan] Erkennung fehlgeschlagen', err);
        toast({ text: `Erkennung fehlgeschlagen: ${(err as Error).message}`, tone: 'loss' });
      }
      await st().dropQueued(item.id);
      done++;
    }
  } finally {
    st().setWorking(null);
    running = false;
  }
}

/** Galerie: beliebig viele Bilder in die Warteschlange. */
export async function addImages(files: FileList | File[]) {
  const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
  if (!list.length) return;
  await useStack.getState().enqueue(list);
  void processQueue();
}
