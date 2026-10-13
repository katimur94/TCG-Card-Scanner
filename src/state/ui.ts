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

interface UiState {
  binderOpen: boolean;
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
  binderOpen: false,
  card: null,
  sheet: null,
  toasts: [],
  setBinder: (binderOpen) => set({ binderOpen }),
  openCard: (card) => set({ card }),
  closeCard: () => set({ card: null }),
  openSheet: (sheet) => set({ sheet }),
  toast: (t) => {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-2), { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.ms ?? (t.action ? 5000 : 3000));
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

export const toast = (t: Omit<Toast, 'id'>) => useUi.getState().toast(t);
