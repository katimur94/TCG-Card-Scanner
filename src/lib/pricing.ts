// Varianten, Preisfelder (Cardmarket-Preisguide via TCGdex) und Cardmarket-Links.

import { getSettings } from '../state/settings';
import type { CardmarketPricing, TcgdexCard, TcgdexVariant, TcgplayerPricing, TcgplayerPrice } from './types';

export interface PriceFields {
  trend: number | null;
  low: number | null;
  avg: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
  updated?: string;
  idProduct?: number;
  unit: string;
  source?: string;
  ambiguous: boolean;
  value: number | null;
  valueLabel: string;
}

export interface Variant {
  key: string;
  label: string;
  type: string;
  reverse: boolean;
  firstEd: boolean;
  cm: PriceFields | null;
  tcgplayer: { value: number; unit: string; low: number | null } | null;
}

export interface Condition {
  id: number;
  short: string;
  label: string;
  color: string;
  hint: string;
}

// Cardmarket-Zustände (IDs = Filter "minCondition"), Farben angelehnt an Cardmarket
export const CONDITIONS: Condition[] = [
  { id: 1, short: 'MT', label: 'Mint', color: '#1f9fb4', hint: 'Fabrikneu, keinerlei Spuren.' },
  { id: 2, short: 'NM', label: 'Near Mint', color: '#2e9e4f', hint: 'Wie neu, höchstens winzige Spuren.' },
  { id: 3, short: 'EX', label: 'Excellent', color: '#8c9a1d', hint: 'Leichte Kantenabnutzung, kleine Kratzer.' },
  { id: 4, short: 'GD', label: 'Good', color: '#c39a1b', hint: 'Deutliche Gebrauchsspuren, kein Knick.' },
  { id: 5, short: 'LP', label: 'Light Played', color: '#d9772b', hint: 'Sichtbar bespielt, kleine Knicke möglich.' },
  { id: 6, short: 'PL', label: 'Played', color: '#d24b3e', hint: 'Stark bespielt, Knicke, Abrieb.' },
  { id: 7, short: 'PO', label: 'Poor', color: '#a3263a', hint: 'Schwer beschädigt.' },
];
export const conditionInfo = (id: number | string | null | undefined): Condition =>
  CONDITIONS.find((c) => c.id === Number(id)) || CONDITIONS[1];

/**
 * Richtwerte je Zustand relativ zum Cardmarket-Preistrend (= Near Mint).
 * Cardmarket veröffentlicht keine Preise je Zustand – das sind übliche Abschläge, in "Mehr" anpassbar.
 */
export const DEFAULT_CONDITION_FACTORS: Record<number, number> = {
  1: 1,
  2: 1,
  3: 0.85,
  4: 0.7,
  5: 0.6,
  6: 0.45,
  7: 0.25,
};

export function conditionFactor(id: number | string) {
  const custom = getSettings().conditionFactors?.[Number(id)];
  if (typeof custom === 'number' && custom > 0) return custom;
  return DEFAULT_CONDITION_FACTORS[Number(id)] ?? 1;
}

/** Geschätzter Preis einer Karte im angegebenen Zustand (Basis: Preistrend der Variante). */
export function conditionValue(base: number | null | undefined, id: number | string | null | undefined) {
  if (base == null || !(base > 0)) return null;
  return Math.round(base * conditionFactor(id || 2) * 100) / 100;
}

const FOILS: Record<string, string> = {
  pokeball: 'Pokéball',
  masterball: 'Meisterball',
  energy: 'Energie-Symbol',
  cosmos: 'Cosmos',
  cracked_ice: 'Cracked Ice',
};
const SUBTYPES: Record<string, string> = {
  shadowless: 'Shadowless',
  unlimited: 'Unlimited',
  '1999-2000-copyright': '© 1999–2000',
};

const pos = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);

function labelFor(v: TcgdexVariant) {
  const type = String(v.type || '').toLowerCase();
  const parts: string[] = [];
  if (type === 'reverse') parts.push(v.foil ? `Reverse ${FOILS[v.foil] || cap(v.foil)}` : 'Reverse Holo');
  else if (type === 'holo') parts.push('Holo');
  else if (type === 'normal') parts.push('Normal');
  else parts.push(cap(type || 'Standard'));
  if (v.subtype) parts.push(SUBTYPES[v.subtype] || cap(v.subtype));
  if (v.stamp?.includes('1st-edition')) parts.unshift('1. Edition');
  else if (v.stamp?.length) parts.push(v.stamp.map(cap).join(', '));
  if (v.size && String(v.size).toLowerCase() !== 'standard') parts.push(cap(v.size));
  return parts.join(' · ');
}

function cap(s: unknown) {
  return String(s || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const VALUE_KINDS: Array<[keyof PriceFields, string]> = [
  ['trend', 'Preistrend'],
  ['avg7', 'Ø 7 Tage'],
  ['avg30', 'Ø 30 Tage'],
  ['avg', 'Ø Verkaufspreis'],
  ['low', 'Ab-Preis'],
];

function pick(cm: CardmarketPricing | null | undefined, reverse: boolean): PriceFields | null {
  if (!cm) return null;
  // Reverse-Varianten nutzen die Reverse-Holo-Felder des Preisguides ("-holo")
  const useRev = reverse && (pos(cm['trend-holo']) || pos(cm['avg-holo']) || pos(cm['low-holo']));
  const g = (k: string) => pos((cm as Record<string, unknown>)[useRev ? `${k}-holo` : k]);
  const out: PriceFields = {
    trend: g('trend'),
    low: g('low'),
    avg: g('avg'),
    avg1: g('avg1'),
    avg7: g('avg7'),
    avg30: g('avg30'),
    updated: cm.updated,
    idProduct: cm.idProduct,
    unit: cm.unit || 'EUR',
    source: cm.source, // 'cardmarket' = Ersatz direkt aus Cardmarkets Preisguide (TCGdex ohne Preis)
    ambiguous: !!cm.ambiguous,
    value: null,
    valueLabel: 'Kein Preis',
  };
  // Hauptwert: Preistrend, sonst der beste verfügbare Durchschnitt
  const kind = VALUE_KINDS.find(([k]) => out[k]);
  out.value = kind ? (out[kind[0]] as number) : null;
  out.valueLabel = kind ? kind[1] : 'Kein Preis';
  return out;
}

function tcgplayerFor(tp: TcgplayerPricing | undefined, v: TcgdexVariant) {
  if (!tp) return null;
  const type = String(v.type || '').toLowerCase();
  const first = v.stamp?.includes('1st-edition');
  const keys =
    type === 'reverse'
      ? ['reverse-holofoil']
      : type === 'holo'
        ? first
          ? ['1st-edition-holofoil', 'holofoil']
          : ['holofoil', 'unlimited-holofoil']
        : first
          ? ['1st-edition-normal', 'normal']
          : ['normal', 'unlimited-normal', 'holofoil'];
  for (const k of keys) {
    const p = tp[k] as TcgplayerPrice | undefined;
    const val = pos(p?.marketPrice) || pos(p?.midPrice);
    if (val) return { value: val, unit: tp.unit || 'USD', low: pos(p?.lowPrice) };
  }
  return null;
}

/**
 * Normalisierte Varianten mit Preisen.
 * @returns {Array<{key, label, type, reverse, firstEd, cm, tcgplayer}>}
 */
export function variantsOf(card: TcgdexCard | null | undefined): Variant[] {
  if (!card) return [];
  const list = Array.isArray(card.variants_detailed) && card.variants_detailed.length ? card.variants_detailed : null;
  const out: Variant[] = [];
  if (list) {
    const seen = new Set<string>();
    for (const v of list) {
      const type = String(v.type || '').toLowerCase();
      const key = [
        type,
        v.subtype,
        v.foil,
        (v.stamp || []).join('+'),
        v.size && String(v.size).toLowerCase() !== 'standard' ? v.size : '',
      ]
        .filter(Boolean)
        .join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const reverse = type === 'reverse';
      out.push({
        key,
        label: labelFor(v),
        type,
        reverse,
        firstEd: !!v.stamp?.includes('1st-edition'),
        cm: pick(v.pricing?.cardmarket || null, reverse),
        tcgplayer: tcgplayerFor(v.pricing?.tcgplayer, v),
      });
    }
  } else {
    const cm = card.pricing?.cardmarket;
    const flags = card.variants || {};
    const add = (type: string, label: string) =>
      out.push({
        key: type,
        label,
        type,
        reverse: type === 'reverse',
        firstEd: false,
        cm: pick(cm, type === 'reverse'),
        tcgplayer: tcgplayerFor(card.pricing?.tcgplayer, { type }),
      });
    if (flags.normal) add('normal', 'Normal');
    if (flags.holo) add('holo', 'Holo');
    if (flags.reverse) add('reverse', 'Reverse Holo');
    if (!out.length) add('normal', 'Standard');
  }
  // Varianten mit Preis zuerst, dann Normal/Holo vor Reverse
  const rank = (v: Variant) => (v.cm?.value ? 0 : 10) + (v.reverse ? 1 : 0) + (v.firstEd ? 2 : 0);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Kursentwicklung: 7-Tage-Schnitt gegenüber 30-Tage-Schnitt. */
export function momentum(cm: PriceFields | null | undefined) {
  if (!cm?.avg7 || !cm?.avg30) return null;
  return (cm.avg7 - cm.avg30) / cm.avg30;
}

/** Link zur Cardmarket-Produktseite mit Sprach- und Zustandsfilter. */
export function cardmarketUrl({
  idProduct,
  siteLang = 'de',
  cmLang,
  minCondition,
  reverse,
  firstEd,
  search,
}: {
  idProduct?: number | null;
  siteLang?: string;
  cmLang?: number;
  minCondition?: number;
  reverse?: boolean;
  firstEd?: boolean;
  search?: string;
}) {
  if (idProduct) {
    const u = new URL(`https://www.cardmarket.com/${siteLang}/Pokemon/Products`);
    u.searchParams.set('idProduct', String(idProduct));
    if (cmLang) u.searchParams.set('language', String(cmLang));
    if (minCondition) u.searchParams.set('minCondition', String(minCondition));
    if (reverse) u.searchParams.set('isReverseHolo', 'Y');
    if (firstEd) u.searchParams.set('isFirstEd', 'Y');
    return u.href;
  }
  const u = new URL(`https://www.cardmarket.com/${siteLang}/Pokemon/Products/Search`);
  u.searchParams.set('searchString', search || '');
  return u.href;
}
