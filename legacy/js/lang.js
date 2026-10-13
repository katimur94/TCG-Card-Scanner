// Kartensprachen: Metadaten, Cardmarket-IDs und Erkennung aus OCR-Text.

import { norm } from './util.js';

/**
 * code   – unser Kürzel (= TCGdex-Sprachcode)
 * cm     – Cardmarket-Sprach-ID für den Angebotsfilter (?language=)
 * group  – 'intl' teilt sich die Set-IDs mit Englisch, 'ja' hat eigene Sets/Produkte
 */
export const LANGS = [
  { code: 'de', label: 'Deutsch', short: 'DE', flag: '🇩🇪', cm: 3, group: 'intl' },
  { code: 'en', label: 'Englisch', short: 'EN', flag: '🇬🇧', cm: 1, group: 'intl' },
  { code: 'fr', label: 'Französisch', short: 'FR', flag: '🇫🇷', cm: 2, group: 'intl' },
  { code: 'es', label: 'Spanisch', short: 'ES', flag: '🇪🇸', cm: 4, group: 'intl' },
  { code: 'it', label: 'Italienisch', short: 'IT', flag: '🇮🇹', cm: 5, group: 'intl' },
  { code: 'pt', label: 'Portugiesisch', short: 'PT', flag: '🇵🇹', cm: 8, group: 'intl' },
  { code: 'ja', label: 'Japanisch', short: 'JP', flag: '🇯🇵', cm: 7, group: 'ja' },
];

export const LANG = Object.fromEntries(LANGS.map((l) => [l.code, l]));
export const langInfo = (code) => LANG[code] || LANG.en;

// Wörter, die auf Karten in der jeweiligen Sprache typisch sind (ohne Akzente, klein).
// Gewicht 3 = Kartenrahmen-Begriffe (Schwäche/Resistenz/Rückzug …), 1 = häufige Fließtextwörter.
const KEYWORDS = {
  en: {
    3: ['weakness', 'resistance', 'retreat', 'evolves from', 'stage 1', 'stage 2', 'basic pokemon', 'supporter', 'pokemon tool', 'stadium'],
    1: ['trainer', 'damage', 'flip a coin', 'heads', 'tails', 'your opponent', 'opponents', 'this pokemon', 'attach', 'energy card', 'discard', 'your turn', 'cards', 'draw', 'search your deck', 'shuffle', 'benched', 'active pokemon', 'ability', 'once during your turn', 'you may'],
  },
  de: {
    3: ['schwache', 'resistenz', 'ruckzug', 'entwickelt sich aus', 'phase 1', 'phase 2', 'basis pokemon', 'unterstutzer', 'stadion', 'ausrustung', 'fahigkeit'],
    1: ['trainer', 'schaden', 'wirf eine munze', 'munze', 'kopf', 'zahl', 'deines gegners', 'dein gegner', 'dieses pokemon', 'deinem', 'deiner', 'deinen', 'ablagestapel', 'ziehe', 'karten', 'durchsuche dein deck', 'mische', 'bank', 'aktives pokemon', 'einmal wahrend deines zuges', 'lege', 'energiekarte'],
  },
  fr: {
    3: ['faiblesse', 'resistance', 'retraite', 'evolue de', 'niveau 1', 'niveau 2', 'de base', 'dresseur', 'supporter', 'objet', 'stade', 'talent', 'outil pokemon'],
    1: ['degats', 'lancez une piece', 'piece', 'face', 'pile', 'votre adversaire', 'ce pokemon', 'votre', 'vos', 'defaussez', 'piochez', 'cartes', 'cherchez dans votre deck', 'melangez', 'banc', 'pokemon actif', 'une fois pendant votre tour', 'attachez', 'carte energie'],
  },
  es: {
    3: ['debilidad', 'resistencia', 'retirada', 'evoluciona de', 'fase 1', 'fase 2', 'pokemon basico', 'entrenador', 'partidario', 'objeto', 'estadio', 'habilidad', 'herramienta pokemon'],
    1: ['dano', 'lanza una moneda', 'moneda', 'cara', 'cruz', 'tu rival', 'este pokemon', 'tu', 'tus', 'descarta', 'roba', 'cartas', 'busca en tu baraja', 'baraja', 'banca', 'pokemon activo', 'una vez durante tu turno', 'une', 'carta de energia'],
  },
  it: {
    3: ['debolezza', 'resistenza', 'ritirata', 'si evolve da', 'fase 1', 'fase 2', 'pokemon base', 'allenatore', 'aiuto', 'strumento', 'stadio', 'abilita'],
    1: ['danni', 'lancia una moneta', 'moneta', 'testa', 'croce', 'il tuo avversario', 'questo pokemon', 'tuo', 'tua', 'tuoi', 'scarta', 'pesca', 'carte', 'cerca nel tuo mazzo', 'rimischia', 'panchina', 'pokemon attivo', 'una sola volta durante il tuo turno', 'assegna', 'carta energia'],
  },
  pt: {
    3: ['fraqueza', 'resistencia', 'recuo', 'evolui de', 'estagio 1', 'estagio 2', 'pokemon basico', 'treinador', 'apoiador', 'estadio', 'habilidade', 'ferramenta pokemon'],
    1: ['dano', 'jogue uma moeda', 'moeda', 'cara', 'coroa', 'seu oponente', 'este pokemon', 'seu', 'sua', 'seus', 'descarte', 'compre', 'cartas', 'procure no seu baralho', 'embaralhe', 'banco', 'pokemon ativo', 'uma vez durante o seu turno', 'ligue', 'carta de energia'],
  },
};

// Kürzel für Kraftpunkte – stehen oben rechts auf jeder Pokémon-Karte.
// "HP" steht auch auf japanischen Karten und ist daher nur ein schwaches Indiz.
const HP_LABELS = { HP: [['en', 1]], KP: [['de', 4]], PV: [['fr', 4]], PS: [['es', 2], ['it', 2], ['pt', 2]] };

/**
 * Bestimmt die Kartensprache aus dem OCR-Text.
 * @returns {{lang: string|null, confidence: number, scores: object, evidence: string[]}}
 */
export function detectLanguage(rawText, { printedLang, lines } = {}) {
  const scores = Object.fromEntries(Object.keys(KEYWORDS).map((k) => [k, 0]));
  const evidence = [];
  const text = ` ${norm(rawText)} `;

  for (const [lang, groups] of Object.entries(KEYWORDS)) {
    for (const [weight, words] of Object.entries(groups)) {
      for (const w of words) {
        if (text.includes(` ${w} `)) {
          scores[lang] += Number(weight);
          if (Number(weight) >= 3) evidence.push(w);
        }
      }
    }
  }

  // KP / PV / PS / HP (in Großbuchstaben im Originaltext)
  const hp = String(rawText).match(/\b(HP|KP|PV|PS)\s*\d{2,3}\b|\b\d{2,3}\s*(HP|KP|PV|PS)\b/);
  if (hp) {
    const label = hp[1] || hp[2];
    for (const [l, w] of HP_LABELS[label]) scores[l] += w;
    evidence.push(label);
  }

  // Ab Karmesin & Purpur steht der Sprachcode direkt neben dem Set-Kürzel: „PAL DE 123/193“
  if (printedLang && scores[printedLang] != null) {
    scores[printedLang] += 12;
    evidence.push(`${printedLang.toUpperCase()} (aufgedruckt)`);
  }

  // Japanische Schriftzeichen (falls ein Modell sie liefert)
  const jaChars = (String(rawText).match(/[぀-ヿ一-鿿]/g) || []).length;
  if (jaChars > 6) scores.ja = jaChars / 2;

  // Kaum gut lesbarer lateinischer Fließtext -> vermutlich japanische Karte
  // (das Texterkennungsmodell liest nur lateinische Schrift; Japanisch wird zu Zeichensalat)
  let jaHint = 0;
  if (lines?.length) {
    const fluent = lines.filter((l) => l.conf >= 0.8 && (l.text.match(/[A-Za-zÀ-ÿ]/g) || []).length >= 10).length;
    const noisy = lines.filter((l) => l.conf < 0.5).length;
    if (fluent <= 1) jaHint = Math.min(1, 0.5 + noisy / Math.max(8, lines.length));
    else if (fluent <= 3) jaHint = 0.25;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!best || best[1] < 2) return { lang: null, confidence: 0, scores, evidence, jaHint };
  const confidence = Math.min(1, (best[1] - (second?.[1] || 0) * 0.6) / 10);
  return { lang: best[0], confidence: Math.max(0.15, confidence), scores, evidence, jaHint: best[0] === 'ja' ? 1 : jaHint * 0.3 };
}

/** Sprache aus dem aufgedruckten Kürzel (z. B. „DE“ in „PAL DE 123/193“). */
export function langFromPrintedCode(code) {
  const map = { EN: 'en', DE: 'de', FR: 'fr', ES: 'es', IT: 'it', PT: 'pt' };
  return map[String(code || '').toUpperCase()] || null;
}
