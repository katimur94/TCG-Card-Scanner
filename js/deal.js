// Kauf-Check: Lohnt sich ein Angebot (z. B. vom Flohmarkt) gemessen an Cardmarket?
// Plus eine regelbasierte Einschätzung, ob die Karte ein gutes Investment ist.
// Alles sind Richtwerte aus dem Cardmarket-Preisguide – keine Anlageberatung.

import { conditionValue, conditionInfo } from './pricing.js';

/** Cardmarket-Provision für Verkäufer (5 % vom Verkaufspreis) und Verpackung pro Verkauf. */
export const SELL_FEE = 0.05;
export const PACKAGING = 0.5;

const round2 = (v) => Math.round(v * 100) / 100;
// Verhandlungsbeträge: unter 10 € auf 10 Cent, darüber auf 50 Cent abrunden
const roundDown = (v) => (v < 10 ? Math.floor(v * 10) / 10 : Math.floor(v * 2) / 2);

/** Erlös nach Cardmarket-Gebühr und Verpackung, wenn man zum Marktwert verkauft. */
export function resaleNet(marketValue) {
  if (!marketValue) return 0;
  return Math.max(0, round2(marketValue * (1 - SELL_FEE) - PACKAGING));
}

const BUY_TIERS = [
  { max: 0.6, key: 'top', label: 'Top-Deal', text: 'Deutlich unter Marktwert – zugreifen!' },
  { max: 0.85, key: 'good', label: 'Guter Kauf', text: 'Spürbar günstiger als auf Cardmarket.' },
  { max: 1.0, key: 'fair', label: 'Fairer Preis', text: 'Etwa Marktwert – gut zum Sammeln, kaum Gewinn beim Weiterverkauf.' },
  { max: 1.15, key: 'high', label: 'Etwas zu teuer', text: 'Auf Cardmarket meist günstiger zu bekommen.' },
  { max: Infinity, key: 'bad', label: 'Zu teuer', text: 'Deutlich über Marktwert – lieber nicht.' },
];

/**
 * Bewertet einen Angebotspreis.
 * @param {number} ask         Preis, zu dem man die Karte kaufen könnte
 * @param {object} cm          Preisfelder der Variante (trend, low, avg7 …, value)
 * @param {number} condition   Cardmarket-Zustand (1–7)
 */
export function evaluateBuy(ask, cm, condition) {
  const market = conditionValue(cm?.value, condition);
  if (!(ask > 0) || !market) return null;
  const ratio = ask / market;
  const tier = BUY_TIERS.find((t) => ratio <= t.max);
  const net = resaleNet(market);
  const profit = round2(net - ask);
  const notes = [];
  if (market < 1) notes.push('Kartenwert unter 1 € – beim Weiterverkauf fressen Gebühren und Aufwand den Gewinn.');
  else if (market < 3 && profit > 0) notes.push('Kleiner Betrag: Weiterverkauf lohnt sich meist nur im Paket mit anderen Karten.');
  if (cm.low && ask > cm.low && ratio > 0.85) notes.push(`Auf Cardmarket gibt es diese Karte schon ab ${fmt(cm.low)} (beliebiger Zustand/Sprache).`);
  return {
    ask,
    market,
    ratio,
    diff: round2(market - ask),
    discount: 1 - ratio,
    net,
    profit,
    tier,
    // Verhandlungsziele: ab diesem Preis wird es ein guter Kauf bzw. ein Top-Deal
    targetGood: roundDown(market * 0.85),
    targetTop: roundDown(market * 0.6),
    condition: conditionInfo(condition),
    notes,
  };
}

const fmt = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v);

// Seltenheiten (englische TCGdex-Namen), grob nach Sammlerinteresse gruppiert
const RARITY_HIGH = ['special illustration rare', 'hyper rare', 'mega hyper rare', 'illustration rare', 'secret rare', 'shiny ultra rare', 'gold', 'rare holo lv.x', 'rare prime', 'legend', 'amazing rare', 'radiant rare', 'black white rare', 'shiny rare', 'shiny rare v', 'shiny rare vmax', 'crown', 'full art trainer'];
const RARITY_MID = ['ultra rare', 'double rare', 'holo rare v', 'holo rare vmax', 'holo rare vstar', 'ace spec rare', 'holo rare', 'rare holo', 'promo', 'classic collection'];
const RARITY_LOW = ['common', 'uncommon'];

/**
 * Regelbasierte Investment-Einschätzung.
 * @param {object} p
 * @param {object} p.cm        Preisfelder der Variante
 * @param {number} p.market    Marktwert im gewählten Zustand
 * @param {string} p.rarity    englischer Seltenheitsname (TCGdex)
 * @param {string} p.setDate   Erscheinungsdatum "YYYY-MM-DD"
 * @param {boolean} p.reverse  Reverse-Holo-Variante
 * @param {Array<{d,v}>} p.history  eigene Preisabrufe
 * @param {Date} [p.now]
 * @returns {{score:number, key:string, label:string, reasons:Array<{sign:number, text:string}>}}
 */
export function evaluateInvestment({ cm, market, rarity, setDate, reverse, history, now = new Date() }) {
  let score = 50;
  const reasons = [];
  const add = (delta, text) => {
    score += delta;
    reasons.push({ sign: Math.sign(delta), text });
  };

  // 1) Kursentwicklung laut Preisguide
  const base = cm?.avg30;
  const signals = [];
  if (base && cm.avg7) signals.push((cm.avg7 - base) / base);
  if (base && cm.trend) signals.push((cm.trend - base) / base);
  if (signals.length && (cm.trend || cm.avg30) < 1) {
    add(0, 'Bei Centbeträgen sagt die Kursentwicklung wenig aus.');
  } else if (signals.length) {
    const m = signals.reduce((a, b) => a + b, 0) / signals.length;
    const pct = `${m >= 0 ? '+' : '−'}${Math.abs(Math.round(m * 100))} %`;
    if (m > 0.1) add(14, `Preis steigt deutlich (${pct} gegenüber dem 30-Tage-Schnitt).`);
    else if (m > 0.03) add(7, `Preis steigt leicht (${pct} gegenüber dem 30-Tage-Schnitt).`);
    else if (m < -0.1) add(-14, `Preis fällt deutlich (${pct} gegenüber dem 30-Tage-Schnitt).`);
    else if (m < -0.03) add(-7, `Preis fällt leicht (${pct} gegenüber dem 30-Tage-Schnitt).`);
    else add(0, 'Preis zuletzt stabil.');
  } else {
    add(-5, 'Kaum Verkaufsdaten – Kursentwicklung nicht einschätzbar.');
  }

  // 2) Alter des Sets
  if (setDate) {
    const days = (now - new Date(setDate)) / 86400000;
    const years = days / 365;
    if (days >= 0 && days < 180) add(-10, `Set erst seit ${Math.max(1, Math.round(days / 30))} Monat(en) erhältlich – Preise neuer Sets geben oft noch nach, solange Booster im Handel sind.`);
    else if (years >= 15) add(12, `Vintage-Karte (${Math.floor(years)} Jahre alt) – das Angebot wächst nicht mehr.`);
    else if (years >= 2) add(7, `Set ist ${Math.floor(years)} Jahre alt – meist nicht mehr im Handel, das Angebot schrumpft.`);
  }

  // 3) Seltenheit
  const r = String(rarity || '').toLowerCase();
  if (RARITY_HIGH.some((x) => r === x || r.includes(x))) add(12, `Hohe Seltenheit (${rarity}) – bei Sammlern besonders gefragt.`);
  else if (RARITY_MID.includes(r)) add(4, `Seltenheit „${rarity}“ – solide Nachfrage.`);
  else if (RARITY_LOW.includes(r)) add(-10, `Häufige Karte (${rarity}) – große Stückzahlen im Umlauf.`);
  if (reverse && RARITY_LOW.includes(r)) add(-3, 'Reverse-Holo einer häufigen Karte – meist nur kleiner Aufpreis.');

  // 4) Wertniveau
  if (market != null) {
    if (market < 1) add(-15, 'Wert unter 1 € – als Wertanlage ungeeignet.');
    else if (market < 5) add(-6, 'Wert unter 5 € – Wertsteigerung bringt absolut wenig.');
    else if (market >= 50) add(5, 'Hochwertige Karte mit aktivem Markt.');
  }

  // 5) Schwankung und Handelsvolumen
  const pts = [cm?.avg1, cm?.avg7, cm?.avg30, cm?.trend].filter((v) => v > 0);
  if (pts.length >= 3) {
    const spread = (Math.max(...pts) - Math.min(...pts)) / (cm.trend || pts[0]);
    if (spread > 0.5) add(-6, 'Preis schwankt stark – höheres Risiko.');
  }
  if (cm && !cm.avg1 && !cm.avg7) add(-4, 'In den letzten Tagen kaum verkauft – Weiterverkauf kann dauern.');

  // 6) Eigener Preisverlauf (mindestens zwei Wochen Abrufe)
  if (history?.length >= 3) {
    const first = history[0];
    const last = history[history.length - 1];
    const spanDays = (new Date(last.d) - new Date(first.d)) / 86400000;
    if (spanDays >= 14 && first.v > 0) {
      const ch = (last.v - first.v) / first.v;
      if (ch > 0.1) add(5, `Seit deinem ersten Abruf +${Math.round(ch * 100)} %.`);
      else if (ch < -0.1) add(-5, `Seit deinem ersten Abruf −${Math.abs(Math.round(ch * 100))} %.`);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const key = score >= 65 ? 'good' : score >= 45 ? 'neutral' : 'weak';
  const label = key === 'good' ? 'Gutes Investment-Potenzial' : key === 'neutral' ? 'Neutral' : 'Eher kein Investment';
  return { score, key, label, reasons: reasons.filter((x) => x.text) };
}

/** Kurzes Gesamtfazit aus Kauf- und Investment-Bewertung. */
export function verdictSummary(buy, inv) {
  if (!buy) return '';
  if (buy.market < 1) return `Massenkarte: Marktwert nur ${fmt(buy.market)} – lohnt sich nur zum Sammeln oder Spielen.`;
  const cheap = ['top', 'good'].includes(buy.tier.key);
  const fair = buy.tier.key === 'fair';
  if (cheap && inv.key === 'good') return 'Kaufen: günstig und mit Wertsteigerungspotenzial.';
  if (cheap && inv.key === 'neutral') return 'Kaufen: günstiger Preis – zum Sammeln oder Weiterverkaufen.';
  if (cheap) return buy.profit > 0 ? 'Kaufen zum Weiterverkaufen – als Wertanlage eher schwach.' : 'Günstig, aber der Gewinn wird von Gebühren aufgezehrt – nur zum Sammeln.';
  if (fair && inv.key === 'good') return 'Fairer Preis für eine Karte mit Potenzial – zum Behalten okay.';
  if (fair) return `Nur kaufen, wenn du sie für die Sammlung willst – versuch ${fmt(buy.targetGood)} zu bieten.`;
  return inv.key === 'good'
    ? `Gute Karte, aber zu teuer – verhandle auf höchstens ${fmt(buy.targetGood)}.`
    : `Zu teuer – höchstens ${fmt(buy.targetGood)} wären ein guter Kauf.`;
}
