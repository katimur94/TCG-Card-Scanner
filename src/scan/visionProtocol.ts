// Nachrichten zwischen Hauptthread und Erkennungs-Worker.

import type { Point, Quad, RGBA } from './rgba';
import type { Match, ImageLang } from './embed';

export interface FoundCard {
  quad: Quad;
  cell: [number, number] | null;
  detScore: number;
  matches: Match[];
  view: RGBA; // 245×342, entzerrt
  straight: RGBA | null; // höhere Auflösung für Texterkennung und Foto
  sharp: number;
  glare: number;
}

export interface AnalyzeResult {
  cards: FoundCard[];
  ms: number;
}

export interface DetectResult {
  quads: Quad[];
  sharp: number;
}

export type VisionRequest =
  | { id: number; type: 'init'; base: string }
  | { id: number; type: 'warmup' }
  | { id: number; type: 'ready' }
  | { id: number; type: 'detect'; image: RGBA; side?: number }
  | { id: number; type: 'analyze'; image: RGBA; opts?: { straight?: boolean; single?: boolean } }
  | { id: number; type: 'lang'; view: RGBA; setId: string; localId: string };

export type VisionResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export type { Point, Quad, RGBA, Match, ImageLang };
