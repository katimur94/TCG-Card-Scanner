// Varianten, Preisfelder (Cardmarket-Preisguide via TCGdex) und Cardmarket-Links.

export const CONDITIONS = [
  { id: 1, short: 'MT', label: 'Mint' },
  { id: 2, short: 'NM', label: 'Near Mint' },
  { id: 3, short: 'EX', label: 'Excellent' },
  { id: 4, short: 'GD', label: 'Good' },
  { id: 5, short: 'LP', label: 'Light Played' },
  { id: 6, short: 'PL', label: 'Played' },
  { id: 7, short: 'PO', label: 'Poor' },
];
export const conditionInfo = (id) => CONDITIONS.find((c) => c.id === Number(id)) || CONDITIONS[1];

const FOILS = { pokeball: 'Pokéball', masterball: 'Meisterball', energy: 'Energie-Symbol', cosmos: 'Cosmos', cracked_ice: 'Cracked Ice' };
const SUBTYPES = { shadowless: 'Shadowless', unlimited: 'Unlimited', '1999-2000-copyright': '© 1999–2000' };

const pos = (v) => (typeof v === 'number' && v > 0 ? v : null);

function labelFor(v) {
  const type = String(v.type || '').toLowerCase();
  const parts = [];
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

function cap(s) {
  return String(s || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const VALUE_KINDS = [
  ['trend', 'Preistrend'],
  ['avg7', 'Ø 7 Tage'],
  ['avg30', 'Ø 30 Tage'],
  ['avg', 'Ø Verkaufspreis'],
  ['low', 'Ab-Preis'],
];

function pick(cm, reverse) {
  if (!cm) return null;
  // Reverse-Varianten nutzen die Reverse-Holo-Felder des Preisguides ("-holo")
  const useRev = reverse && (pos(cm['trend-holo']) || pos(cm['avg-holo']) || pos(cm['low-holo']));
  const g = (k) => pos(cm[useRev ? `${k}-holo` : k]);
  const out = {
    trend: g('trend'),
    low: g('low'),
    avg: g('avg'),
    avg1: g('avg1'),
    avg7: g('avg7'),
    avg30: g('avg30'),
    updated: cm.updated,
    idProduct: cm.idProduct,
    unit: cm.unit || 'EUR',
  };
  // Hauptwert: Preistrend, sonst der beste verfügbare Durchschnitt
  const kind = VALUE_KINDS.find(([k]) => out[k]);
  out.value = kind ? out[kind[0]] : null;
  out.valueLabel = kind ? kind[1] : 'Kein Preis';
  return out;
}

function tcgplayerFor(tp, v) {
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
    const p = tp[k];
    const val = pos(p?.marketPrice) || pos(p?.midPrice);
    if (val) return { value: val, unit: tp.unit || 'USD', low: pos(p.lowPrice) };
  }
  return null;
}

/**
 * Normalisierte Varianten mit Preisen.
 * @returns {Array<{key, label, type, reverse, firstEd, cm, tcgplayer}>}
 */
export function variantsOf(card) {
  if (!card) return [];
  const list = Array.isArray(card.variants_detailed) && card.variants_detailed.length ? card.variants_detailed : null;
  const out = [];
  if (list) {
    const seen = new Set();
    for (const v of list) {
      const type = String(v.type || '').toLowerCase();
      const key = [type, v.subtype, v.foil, (v.stamp || []).join('+'), v.size && String(v.size).toLowerCase() !== 'standard' ? v.size : ''].filter(Boolean).join('|');
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
    const add = (type, label) =>
      out.push({ key: type, label, type, reverse: type === 'reverse', firstEd: false, cm: pick(cm, type === 'reverse'), tcgplayer: tcgplayerFor(card.pricing?.tcgplayer, { type }) });
    if (flags.normal) add('normal', 'Normal');
    if (flags.holo) add('holo', 'Holo');
    if (flags.reverse) add('reverse', 'Reverse Holo');
    if (!out.length) add('normal', 'Standard');
  }
  // Varianten mit Preis zuerst, dann Normal/Holo vor Reverse
  const rank = (v) => (v.cm?.value ? 0 : 10) + (v.reverse ? 1 : 0) + (v.firstEd ? 2 : 0);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Kursentwicklung: 7-Tage-Schnitt gegenüber 30-Tage-Schnitt. */
export function momentum(cm) {
  if (!cm?.avg7 || !cm?.avg30) return null;
  return (cm.avg7 - cm.avg30) / cm.avg30;
}

/** Link zur Cardmarket-Produktseite mit Sprach- und Zustandsfilter. */
export function cardmarketUrl({ idProduct, siteLang = 'de', cmLang, minCondition, reverse, firstEd, search }) {
  if (idProduct) {
    const u = new URL(`https://www.cardmarket.com/${siteLang}/Pokemon/Products`);
    u.searchParams.set('idProduct', idProduct);
    if (cmLang) u.searchParams.set('language', cmLang);
    if (minCondition) u.searchParams.set('minCondition', minCondition);
    if (reverse) u.searchParams.set('isReverseHolo', 'Y');
    if (firstEd) u.searchParams.set('isFirstEd', 'Y');
    return u.href;
  }
  const u = new URL(`https://www.cardmarket.com/${siteLang}/Pokemon/Products/Search`);
  u.searchParams.set('searchString', search || '');
  return u.href;
}
