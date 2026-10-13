// Kartendetails laden: Anzeige in Kartensprache, Preise (international über die englische Ausgabe),
// Ersatzpreise aus Cardmarkets Preis-Guide und Ersatzbilder.

import { getCard, imageUrl, guessImageBase, loadSets, findCards, loadCardIndex } from '../lib/api';
import { nameDirectory } from '../lib/identify';
import { cardmarketPrice } from '../lib/cardmarket';
import { LANG } from '../lib/lang';
import { variantsOf, type Variant } from '../lib/pricing';
import { finishFor, type Finish } from '../ui/card/finish';
import type { Region } from '../db/schema';
import type { SetInfo, TcgdexCard } from '../lib/types';

/** Verweis auf eine Karte im Katalog (unabhängig von der Sammlung). */
export interface CardRef {
  region: Region;
  setId: string;
  localId: string;
  id: string; // TCGdex-ID
  lang: string;
  name?: string;
  set?: SetInfo;
}

export interface CardData {
  ref: CardRef;
  display: TcgdexCard; // in Kartensprache (sonst Englisch)
  priceCard: TcgdexCard; // Preise (englische Ausgabe bzw. japanische Karte)
  variants: Variant[];
  images: string[]; // Bildquellen der Reihe nach (hohe Qualität)
  thumbs: string[];
  imageBase: string | null; // echtes Bild zum Speichern
  altImage: boolean; // Bild stammt von einer anderen Ausgabe
  finish: Finish;
  setName: string;
  setDate: string | null;
  official: number | null;
  rarity: string | null;
}

const hasCardmarket = (card: TcgdexCard) =>
  !!(card.pricing?.cardmarket?.idProduct || card.variants_detailed?.some((v) => v.pricing?.cardmarket?.idProduct));

/** Kein Cardmarket-Preis bei TCGdex: Preis aus Cardmarkets Preis-Guide ergänzen (gleiches Format). */
async function addCardmarketFallback(card: TcgdexCard, setId: string) {
  const index = await loadCardIndex('en');
  const sameName = (index[setId] || []).filter((r) => r[1] === card.name).map((r) => r[0]);
  const cm = await cardmarketPrice(card, setId, sameName);
  if (!cm) return;
  card.pricing = { ...(card.pricing || {}), cardmarket: cm };
  for (const v of card.variants_detailed || []) v.pricing = { ...(v.pricing || {}), cardmarket: cm };
}

// Seltenheiten mit Standard-Motiv – nur dort zeigt die englische Ausgabe dasselbe Motiv
const REGULAR_RARITIES = ['common', 'uncommon', 'rare', 'double rare', 'holo rare', 'rare holo', 'none'];

/** Bild der englischen Ausgabe einer japanischen Karte (gleiche Pokédex-Nr., gleiche Kartenart). */
async function englishImageFor(card: TcgdexCard & { dexId?: number[] }, set: SetInfo | undefined) {
  const dex = card?.dexId?.[0];
  if (!dex || !REGULAR_RARITIES.includes(String(card.rarity || '').toLowerCase())) return null;
  const [list, { byId }] = await Promise.all([findCards('en', `dexId=${dex}`), loadSets()]);
  const jn = String(card.name || '');
  const mega = /^メガ/.test(jn);
  const suffix = (jn.match(/(ex|EX|GX|VMAX|VSTAR|V)$/) || [])[1]?.toLowerCase() || '';
  const jaDate = set?.d ? new Date(set.d).getTime() : null;
  let best: { score: number; image: string } | null = null;
  for (const c of list || []) {
    if (!c.image) continue;
    const n = c.name.toLowerCase();
    if (mega !== n.startsWith('mega ')) continue;
    if (((n.match(/ (ex|gx|vmax|vstar|v)$/) || [])[1] || '') !== suffix) continue;
    const s = byId.get(`intl:${c.id.slice(0, c.id.length - c.localId.length - 1)}`);
    if (!s?.d) continue;
    const num = parseInt(c.localId, 10);
    const secret = Number.isNaN(num) || (s.o && num > s.o);
    let dist = jaDate ? (new Date(s.d).getTime() - jaDate) / 86400000 : 3650;
    // Englische Ausgaben erscheinen meist einige Monate nach den japanischen
    dist = dist >= 0 ? dist * 0.5 : -dist;
    const score = dist + (secret ? 2000 : 0);
    if (!best || score < best.score) best = { score, image: c.image };
  }
  return best?.image || null;
}

export async function loadCardData(ref: CardRef): Promise<CardData> {
  const set = ref.set ?? (await loadSets()).byId.get(`${ref.region}:${ref.setId}`);
  let display: TcgdexCard | null;
  let priceCard: TcgdexCard | null;
  if (ref.region === 'ja') {
    display = priceCard = await getCard('ja', ref.id);
  } else {
    const dl = LANG[ref.lang]?.group === 'intl' ? ref.lang : 'en';
    const [d, p] = await Promise.all([
      dl === 'en' ? null : getCard(dl, ref.id).catch(() => null),
      getCard('en', ref.id),
    ]);
    priceCard = p;
    display = d || p;
    if (p && !hasCardmarket(p)) await addCardmarketFallback(p, ref.setId).catch(() => null);
  }
  if (!priceCard && !display) throw new Error('Karte konnte nicht geladen werden.');
  const shown = (display || priceCard)!;
  const pc = (priceCard || display)!;
  const variants = variantsOf(pc);

  const bases: string[] = [shown.image, pc.image].filter((b): b is string => !!b);
  if (ref.region !== 'ja' && set) {
    for (const l of [ref.lang, 'en', 'de', 'fr', 'es', 'it', 'pt']) {
      const g = l && l !== 'ja' ? guessImageBase(l, set, ref.localId) : null;
      if (g) bases.push(g);
    }
  }
  const alt = ref.region === 'ja' && !shown.image ? await englishImageFor(shown, set).catch(() => null) : null;
  if (alt) bases.push(alt);
  const unique = [...new Set(bases)];

  return {
    ref: { ...ref, set },
    display: shown,
    priceCard: pc,
    variants,
    images: unique.map((b) => imageUrl(b, 'high')!),
    thumbs: unique.map((b) => imageUrl(b, 'low')!),
    imageBase: shown.image || pc.image || null,
    altImage: !shown.image && !pc.image && !!alt,
    finish: finishFor(pc.rarity, variants[0]?.type),
    setName: shown.set?.name || set?.nl?.[ref.lang] || set?.n || '',
    setDate: set?.d || null,
    official: shown.set?.cardCount?.official ?? set?.o ?? null,
    rarity: pc.rarity || null,
  };
}

/**
 * Ohne Netz: Kartendaten nur aus dem Offline-Index (Name, Set, Bild-Adresse), ohne Preis.
 * Reicht, um eine erkannte Karte in die Sammlung zu legen – der Preis wird später nachgeladen.
 */
export async function offlineCardData(ref: CardRef): Promise<CardData> {
  const set = ref.set ?? (await loadSets()).byId.get(`${ref.region}:${ref.setId}`);
  const dirLang = ref.region === 'ja' ? 'ja' : ref.lang;
  const entry =
    (await nameDirectory(dirLang).catch(() => null))?.get(ref.setId, ref.localId) ||
    (await nameDirectory('en').catch(() => null))?.get(ref.setId, ref.localId);
  const name = entry?.name || ref.name || ref.id;
  const imgLang = ref.region === 'ja' ? 'ja' : entry?.hasImage ? dirLang : 'en';
  const base = set ? guessImageBase(imgLang, set, ref.localId) : null;
  const card: TcgdexCard = { id: ref.id, localId: ref.localId, name, set: { id: ref.setId, name: set?.nl?.[ref.lang] || set?.n || ref.setId } };
  return {
    ref: { ...ref, set },
    display: card,
    priceCard: card,
    variants: [],
    images: base ? [imageUrl(base, 'high')!] : [],
    thumbs: base ? [imageUrl(base, 'low')!] : [],
    imageBase: base,
    altImage: false,
    finish: 'matte',
    setName: card.set.name,
    setDate: set?.d || null,
    official: set?.o ?? null,
    rarity: null,
  };
}

/** Online laden, sonst (offline/Fehler) aus dem Offline-Index. */
export async function cardDataOrOffline(ref: CardRef): Promise<CardData & { offline?: boolean }> {
  try {
    return await loadCardData(ref);
  } catch {
    return { ...(await offlineCardData(ref)), offline: true };
  }
}
