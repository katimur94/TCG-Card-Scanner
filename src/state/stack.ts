// Der Stapel: erkannte Karten warten hier auf die Sortierung (Sammlung / verwerfen / korrigieren).
// Galerie-Bilder werden in einer Warteschlange abgearbeitet. Alles liegt in der Datenbank (scan_queue),
// damit Stapel und Warteschlange einen Neustart der App überstehen.

import { create } from 'zustand';
import { db, type Region } from '../db/schema';
import { uid } from '../lib/util';
import { getSettings } from './settings';

export interface StackOption {
  group: Region;
  setId: string;
  localId: string;
  name: string;
  setName?: string;
}

export interface StackEntry {
  id: string;
  createdAt: number;
  status: 'sure' | 'ask' | 'none';
  /** Ausschnitt der Karte aus dem Foto (JPEG) */
  photo: Blob | null;
  best: StackOption | null;
  options: StackOption[];
  lang: string;
  langSource: string;
  langOptions: string[];
  reason: string;
  /** Bildähnlichkeit des besten Treffers (für Anzeige/Debug) */
  sim: number;
  /** Fingerabdruck des Ausschnitts für den Doppel-Schutz */
  fp?: number[];
}

export interface QueuedImage {
  id: string;
  createdAt: number;
  blob: Blob;
  name: string;
}

interface StackState {
  entries: StackEntry[];
  queue: QueuedImage[];
  working: { label: string; done: number; total: number } | null;
  loaded: boolean;
  load(): Promise<void>;
  enqueue(files: Blob[]): Promise<void>;
  push(entry: Omit<StackEntry, 'id' | 'createdAt'>): Promise<StackEntry>;
  update(id: string, patch: Partial<StackEntry>): Promise<void>;
  remove(id: string): Promise<StackEntry | undefined>;
  restore(entry: StackEntry): Promise<void>;
  setWorking(w: StackState['working']): void;
  dropQueued(id: string): Promise<void>;
}

const toRow = (e: StackEntry) => ({ id: e.id, imageBlob: e.photo || new Blob(), status: 'done' as const, candidates: { ...e, photo: undefined }, createdAt: e.createdAt });

export const useStack = create<StackState>((set, get) => ({
  entries: [],
  queue: [],
  working: null,
  loaded: false,
  async load() {
    const rows = await db.scan_queue.orderBy('createdAt').toArray();
    const entries: StackEntry[] = [];
    const queue: QueuedImage[] = [];
    for (const r of rows) {
      if (r.status === 'pending') queue.push({ id: r.id, createdAt: r.createdAt, blob: r.imageBlob, name: String((r.candidates as { name?: string })?.name || '') });
      else if (r.status === 'done' && r.candidates) entries.push({ ...(r.candidates as StackEntry), photo: r.imageBlob.size ? r.imageBlob : null });
    }
    set({ entries, queue, loaded: true });
  },
  async enqueue(files) {
    const items = files.map((blob, i) => ({ id: uid(), createdAt: Date.now() + i, blob, name: (blob as File).name || '' }));
    await db.scan_queue.bulkAdd(items.map((q) => ({ id: q.id, imageBlob: q.blob, status: 'pending' as const, candidates: { name: q.name }, createdAt: q.createdAt })));
    set({ queue: [...get().queue, ...items] });
  },
  async push(e) {
    const entry: StackEntry = { ...e, id: uid(), createdAt: Date.now() };
    await db.scan_queue.put(toRow(entry));
    set({ entries: [...get().entries, entry] });
    return entry;
  },
  async update(id, patch) {
    const entries = get().entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
    const e = entries.find((x) => x.id === id);
    if (e) await db.scan_queue.put(toRow(e));
    set({ entries });
  },
  async remove(id) {
    const e = get().entries.find((x) => x.id === id);
    await db.scan_queue.delete(id);
    set({ entries: get().entries.filter((x) => x.id !== id) });
    return e;
  },
  async restore(entry) {
    await db.scan_queue.put(toRow(entry));
    set({ entries: [...get().entries, entry].sort((a, b) => a.createdAt - b.createdAt) });
  },
  setWorking: (working) => set({ working }),
  async dropQueued(id) {
    await db.scan_queue.delete(id);
    set({ queue: get().queue.filter((q) => q.id !== id) });
  },
}));

export const stackSettings = () => {
  const s = getSettings();
  return { scanLang: s.scanLang, fallback: s.fallbackLang };
};
