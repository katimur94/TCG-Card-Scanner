// Gemeinsame Typen für Offline-Index, TCGdex-Daten und Erkennung.

import type { Region } from '../db/schema';

/** Ein Set aus data/sets.json (Kurzschlüssel, damit die Datei klein bleibt). */
export interface SetInfo {
  id: string;
  g: Region; // Gruppe: international oder japanisch
  n: string; // Name (englisch bzw. japanisch)
  o: number; // offizielle Kartenanzahl (auf der Karte aufgedruckt)
  t: number; // Gesamtzahl inkl. Secret Rares
  a?: string; // Kürzel, z. B. "MEW" (mehrere mit ":" oder "/")
  d?: string; // Erscheinungsdatum YYYY-MM-DD
  s?: string; // Serie (für Bild-URLs)
  sn?: string; // Serienname
  sy?: number; // hat Symbol
  lo?: number; // hat Logo
  nl?: Record<string, string>; // Set-Name je Sprache
}

export interface SetIndex {
  sets: SetInfo[];
  byId: Map<string, SetInfo>; // `${g}:${id}`
  byAbbr: Map<string, SetInfo[]>;
  generated?: string;
}

/** Zeile in data/cards-{lang}.json: [localId, Name, hatBild (0 = nein)] */
export type CardRow = [string, string, number?];
export type CardsBySet = Record<string, CardRow[]>;

export interface OcrLine {
  text: string;
  conf: number;
  y: number;
  h?: number;
  x0?: number;
  x1?: number;
  pass?: string;
}

export interface OcrResult {
  lines: OcrLine[];
  text: string;
}

/** Preisfelder eines Cardmarket-Preis-Guide-Eintrags (TCGdex `pricing.cardmarket`). */
export interface CardmarketPricing {
  updated?: string;
  unit?: string;
  idProduct?: number;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  avg1?: number | null;
  avg7?: number | null;
  avg30?: number | null;
  'avg-holo'?: number | null;
  'low-holo'?: number | null;
  'trend-holo'?: number | null;
  'avg1-holo'?: number | null;
  'avg7-holo'?: number | null;
  'avg30-holo'?: number | null;
  source?: string;
  ambiguous?: boolean;
}

export interface TcgplayerPrice {
  productId?: number;
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
  marketPrice?: number | null;
}

export type TcgplayerPricing = { unit?: string; updated?: string } & Record<
  string,
  TcgplayerPrice | string | undefined
>;

export interface TcgdexVariant {
  type?: string;
  subtype?: string;
  foil?: string;
  size?: string;
  stamp?: string[];
  thirdParty?: { cardmarket?: number; tcgplayer?: number };
  pricing?: { cardmarket?: CardmarketPricing; tcgplayer?: TcgplayerPricing };
}

export interface TcgdexCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category?: string;
  illustrator?: string;
  rarity?: string;
  hp?: number;
  types?: string[];
  stage?: string;
  set: { id: string; name: string; logo?: string; symbol?: string; cardCount?: { official?: number; total?: number } };
  variants?: { normal?: boolean; holo?: boolean; reverse?: boolean; firstEdition?: boolean; wPromo?: boolean };
  variants_detailed?: TcgdexVariant[];
  attacks?: Array<{ name: string; cost?: string[]; damage?: string | number; effect?: string }>;
  abilities?: Array<{ name: string; type?: string; effect?: string }>;
  pricing?: { cardmarket?: CardmarketPricing; tcgplayer?: TcgplayerPricing };
  updated?: string;
}
