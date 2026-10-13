// Navigation (nur drei Orte: Scanner, Binder, Karte) plus Blätter für Suche/Einstellungen und Hinweise.

import { create } from 'zustand';
import type { CardRef } from '../domain/cardData';

export type Sheet = 'search' | 'settings' | 'depot' | null;

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'gain' | 'loss';
  action?: { label: string; run: () => void | Promise<void> };
  ms?: number;
}

/** Geöffnete Karte: aus dem Katalog (ref) oder ein Binder-Fach (Posten derselben Karte). */
export interface OpenCard {
  ref: CardRef;
  postIds?: string[];
  photoUrl?: string | null;
}

/** Suche im Auswahl-Modus (Korrektur im Stapel): Treffer wird zurückgegeben statt geöffnet. */
export type SearchPick = (hit: { group: 'intl' | 'ja'; setId: string; localId: string; name: string; setName?: string }) => void;

/** Installations-Angebot des Browsers (Chrome/Android). */
export interface InstallPrompt {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface UiState {
  install: InstallPrompt | null;
  setInstall(p: InstallPrompt | null): void;
  binderOpen: boolean;
  triageOpen: boolean;
  searchPick: SearchPick | null;
  setTriage(open: boolean): void;
  pickCard(fn: SearchPick | null): void;
  card: OpenCard | null;
  sheet: Sheet;
  toasts: Toast[];
  setBinder(open: boolean): void;
  openCard(card: OpenCard): void;
  closeCard(): void;
  openSheet(sheet: Sheet): void;
  toast(t: Omit<Toast, 'id'>): void;
  dismiss(id: number): void;
}

let seq = 0;

export const useUi = create<UiState>((set, get) => ({
  install: null,
  setInstall: (install) => set({ install }),
  binderOpen: false,
  triageOpen: false,
  searchPick: null,
  setTriage: (triageOpen) => set({ triageOpen }),
  pickCard: (searchPick) => set({ searchPick, sheet: searchPick ? 'search' : null }),
  card: null,
  sheet: null,
  toasts: [],
  setBinder: (binderOpen) => set({ binderOpen }),
  openCard: (card) => set({ card }),
  closeCard: () => set({ card: null }),
  openSheet: (sheet) => set(sheet === 'search' ? { sheet } : { sheet, searchPick: null }),
  toast: (t) => {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-2), { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.ms ?? (t.action ? 5000 : 3000));
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

export const toast = (t: Omit<Toast, 'id'>) => useUi.getState().toast(t);
