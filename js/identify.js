// Ordnet OCR-Ergebnisse Karten aus dem Offline-Index zu und bietet unscharfe Namenssuche.

import { loadSets, loadCardIndex } from './api.js';
import { norm, partialRatio, ratio, levenshtein } from './util.js';
import { LANG } from './lang.js';
import { parseQuery } from './parse.js';

const PROMO_SETS = {
  SWSH: ['swshp', 'SWSH'],
  SM: ['smp', 'SM'],
  XY: ['xyp', 'XY'],
  BW: ['bwp', 'BW'],
  DP: ['dpp', 'DP'],
  HGSS: ['hgssp', 'HGSS'],
  SVP: ['svp', ''],
  MEP: ['mep', ''],
};

/** "025" -> "25", "TG05" -> "TG5", "SWSH001" -> "SWSH1" */
export function localKey(localId) {
  const s = String(localId).toUpperCase();
  const m = s.match(/^([A-Z]*)0*(\d+)([A-Z]*)$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : s;
}

const indexLangFor = (group) => (group === 'ja' ? 'ja' : 'en');

// ---------- Namensverzeichnis pro Sprache ----------

class NameDirectory {
  constructor(lang, bySet, setsById) {
    this.lang = lang;
    this.byKey = new Map(); // `${setId}|${localKey}` -> row
    this.names = new Map(); // normName -> {name, entries:[]}
    for (const [setId, rows] of Object.entries(bySet)) {
      const set = setsById.get(setId);
      for (const [localId, name, img] of rows) {
        const entry = { setId, localId, name, hasImage: img !== 0, set };
        this.byKey.set(`${setId}|${localKey(localId)}`, entry);
        const n = norm(name);
        if (!n) continue;
        let bucket = this.names.get(n);
        if (!bucket) this.names.set(n, (bucket = { name, norm: n, entries: [], grams: null }));
        bucket.entries.push(entry);
      }
    }
    this.list = [...this.names.values()];
  }

  get(setId, localId) {
    return this.byKey.get(`${setId}|${localKey(localId)}`);
  }

  /** Unscharfe Suche über alle Namen. Liefert [{bucket, score}] */
  search(queries, { limit = 30, min = 0.55 } = {}) {
    const qs = queries.map(norm).filter((q) => q.length >= 2);
    if (!qs.length) return [];
    const qGrams = qs.map(grams);
    const pre = [];
    for (const b of this.list) {
      if (b.norm.length <= 2 && !qs.includes(b.norm)) continue;
      b.grams ||= grams(b.norm);
      let dice = 0;
      for (let i = 0; i < qs.length; i++) {
        const q = qs[i];
        if (b.norm === q) {
          dice = 2;
          break;
        }
        if (b.norm.startsWith(q) || q.includes(b.norm) || b.norm.includes(q)) dice = Math.max(dice, 1.2);
        else dice = Math.max(dice, overlap(qGrams[i], b.grams));
      }
      if (dice > 0.2) pre.push([b, dice]);
    }
    pre.sort((a, b) => b[1] - a[1]);
    const scored = pre.slice(0, 250).map(([b, dice]) => {
      let s = 0;
      for (const q of qs) {
        if (b.norm === q) s = Math.max(s, 1.05);
        else if (b.norm.startsWith(q)) s = Math.max(s, 0.97 - Math.min(0.15, (b.norm.length - q.length) * 0.008));
        else if (b.norm.includes(q) && q.length >= 3) s = Math.max(s, 0.9 - Math.min(0.2, (b.norm.length - q.length) * 0.01));
        else s = Math.max(s, partialRatio(b.norm, q) * (b.norm.length >= 4 ? 1 : 0.85), ratio(b.norm, q));
      }
      return { bucket: b, score: s + dice * 0.001 };
    });
    return scored
      .filter((r) => r.score >= min)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

function grams(s) {
  const t = ` ${s} `;
  const out = new Set();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

function overlap(a, b) {
  let n = 0;
  for (const g of a) if (b.has(g)) n++;
  return (2 * n) / (a.size + b.size || 1);
}

const directories = new Map();

export async function nameDirectory(lang) {
  if (!directories.has(lang)) {
    directories.set(
      lang,
      (async () => {
        const [{ sets }, bySet] = await Promise.all([loadSets(), loadCardIndex(lang)]);
        const group = LANG[lang]?.group === 'ja' ? 'ja' : 'intl';
        const setsById = new Map(sets.filter((s) => s.g === group).map((s) => [s.id, s]));
        return new NameDirectory(lang, bySet, setsById);
      })().catch((err) => {
        directories.delete(lang);
        throw err;
      }),
    );
  }
  return directories.get(lang);
}

// ---------- Identifikation ----------

// Namenszusätze, die auf der Karte oft stilisiert sind und von der Texterkennung verschluckt werden
const SUFFIX_RE = /\s+(ex|gx|v|vmax|vstar|v union|break|lv x|prime|legend|star|delta)$/;

function lineSimilarity(n, parsed) {
  let best = 0;
  for (const l of parsed.nameLines) best = Math.max(best, partialRatio(n, l.text));
  if (best < 0.75) for (const l of parsed.allLines) best = Math.max(best, partialRatio(n, l) * 0.85);
  return best;
}

export function nameSimilarity(name, parsed) {
  const n = norm(name);
  if (!n) return 0;
  // Ein-/Zwei-Buchstaben-Namen ("N") nur bei exakt passender Zeile
  if (n.length <= 2) return parsed.nameLines.some((l) => l.text === n) ? 0.9 : 0;
  let best = lineSimilarity(n, parsed);
  const base = n.replace(SUFFIX_RE, '');
  if (base !== n && base.length >= 3) best = Math.max(best, lineSimilarity(base, parsed) * 0.97);
  // sehr kurze Namen (z. B. "Mew") treffen zu leicht zufällig
  if (n.length <= 3) best *= 0.85;
  return best;
}

/** Abstand zweier Zahlen als Zeichenkette (eine falsch gelesene Ziffer = 1). */
function digitDistance(a, b) {
  const x = String(a);
  const y = String(b);
  if (x === y) return 0;
  if (Math.abs(x.length - y.length) > 1) return 9;
  let d = 0;
  if (x.length === y.length) {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++;
    return d;
  }
  return levenshtein(x, y);
}

const isModernDate = (d) => !!d && d >= '2020-01';

/** Copyright-Jahr gegen Erscheinungsjahr des Sets: passt -> Bonus, weit daneben -> Abzug. */
function yearBonus(set, year) {
  if (!year || !set?.d) return 0;
  const diff = parseInt(set.d, 10) - year;
  if (diff >= -1 && diff <= 1) return 12;
  if (Math.abs(diff) >= 3) return -10;
  return 0;
}

/**
 * Punkte für einen Treffer der Bildsuche (Kosinus-Ähnlichkeit nach Whitening).
 * Gemessen an Testfotos: ab ~0,7 mit Abstand zum Zweiten praktisch immer richtig, unter ~0,45 Zufall.
 */
function visualScore(sim) {
  return 110 * Math.max(0, Math.min(1, (sim - 0.35) / 0.45));
}

/**
 * @param parsed  Ergebnis von parseCard()
 * @param opts.lang      erkannte/gewählte Kartensprache (oder null)
 * @param opts.fallback  Standardsprache, wenn nichts erkannt wurde
 * @param opts.jaHint    0..1 – wie sehr der OCR-Text nach japanischer Karte aussieht
 * @param opts.visual    Treffer der Bildsuche [{group, setId, localId, sim}] (absteigend)
 * @returns {Promise<Array<Candidate>>} absteigend nach Score
 */
export async function identify(parsed, { lang = null, fallback = 'de', jaHint = 0, visual = null } = {}) {
  const idx = await loadSets();
  const effLang = lang || fallback;
  const wantJa = lang === 'ja' || parsed.jaCodes.length > 0;
  const seen = (visual || []).filter((v) => v.sim >= visual[0].sim - 0.2);

  // Namensverzeichnisse: Englisch (Set-Struktur), erkannte Sprache, ggf. Japanisch
  const dirLangs = new Set(['en']);
  if (LANG[effLang]?.group === 'intl') dirLangs.add(effLang);
  if (wantJa || parsed.numbers.length || seen.some((v) => v.group === 'ja')) dirLangs.add('ja');
  const dirs = Object.fromEntries(
    await Promise.all([...dirLangs].map(async (l) => [l, await nameDirectory(l).catch(() => null)])),
  );

  const cands = new Map();
  const add = (group, setId, localId, base, reason) => {
    const dir = dirs[indexLangFor(group)];
    const entry = dir?.get(setId, localId);
    if (!entry) return null;
    const key = `${group}:${setId}:${entry.localId}`;
    let c = cands.get(key);
    if (!c) {
      c = { key, group, setId, localId: entry.localId, id: `${setId}-${entry.localId}`, set: entry.set, name: entry.name, hasImage: entry.hasImage, score: 0, reasons: [] };
      cands.set(key, c);
    }
    if (!c.reasons.includes(reason)) {
      c.score += base;
      c.reasons.push(reason);
    }
    return c;
  };

  // 0) Bildsuche: Karten mit ähnlichstem Bild (unabhängig von lesbarem Text)
  for (const v of seen) {
    const c = add(v.group, v.setId, v.localId, visualScore(v.sim), 'bild');
    if (c) c.visual = v.sim;
  }

  const numbers = parsed.numbers.slice(0, 4);
  const maxW = Math.max(1, ...numbers.map((n) => n.weight));

  // 1) Kartennummer + Gesamtzahl (auch mit einer falsch gelesenen Ziffer in der Gesamtzahl)
  for (const n of numbers) {
    const w = n.weight / maxW;
    const local = `${n.prefix}${n.num}`;
    for (const s of idx.sets) {
      if (s.o === n.total || s.t === n.total) add(s.g, s.id, local, (s.o === n.total ? 45 : 35) * w, 'nummer');
      else if (s.o > 0 && digitDistance(s.o, n.total) === 1) add(s.g, s.id, local, 20 * w, 'nummer~');
    }
  }

  // 2) Name + Nummer: findet die Karte auch, wenn die Gesamtzahl unleserlich war
  const queries = parsed.nameLines.map((l) => l.text).slice(0, 5);
  if (numbers.length && queries.length) {
    for (const l of dirLangs) {
      if (l === 'ja' || !dirs[l]) continue;
      for (const { bucket, score } of dirs[l].search(queries, { limit: 8, min: 0.75 })) {
        for (const e of bucket.entries) {
          for (const n of numbers) {
            const want = localKey(`${n.prefix}${n.num}`);
            const have = localKey(e.localId);
            // passt auch die Gesamtzahl ungefähr zum Set? (z. B. 195 statt 198 gelesen)
            const near = e.set?.o && digitDistance(e.set.o, n.total) <= 1 ? 8 : 0;
            if (have === want) add('intl', e.setId, e.localId, 30 * Math.min(1, score) + near, 'name+nummer');
            else if (digitDistance(have, want) === 1) add('intl', e.setId, e.localId, 14 * Math.min(1, score) + near, 'name+nummer~');
          }
        }
      }
    }
  }

  // 3) Set-Kürzel (MEW, PAL …) bzw. japanischer Set-Code (SV2a …)
  const boostSet = (group, setId) => {
    for (const c of cands.values()) {
      if (c.group === group && c.setId === setId && !c.reasons.includes('kürzel')) {
        c.score += 35;
        c.reasons.push('kürzel');
      }
    }
  };
  for (const code of parsed.codes) {
    for (const s of idx.byAbbr.get(code) || []) {
      for (const n of numbers) add(s.g, s.id, `${n.prefix}${n.num}`, 15, 'kürzel-nummer');
      boostSet(s.g, s.id);
    }
  }
  for (const code of parsed.jaCodes) {
    for (const n of numbers) add('ja', code, `${n.prefix}${n.num}`, 15, 'kürzel-nummer');
    boostSet('ja', code);
  }

  // 4) Promos (SWSH123, SVP 045 …)
  for (const p of parsed.promos) {
    const def = PROMO_SETS[p.prefix];
    if (def) add('intl', def[0], `${def[1]}${p.num}`, 50, 'promo');
  }

  // Ära: Seit Schwert & Schild sind Nummern dreistellig mit führender Null ("025/185")
  const lead = numbers.find((n) => n.numRaw?.length === 3);
  const modern = lead ? lead.numRaw.startsWith('0') : null;

  // 5) Name, Sprache und Plausibilität
  for (const c of cands.values()) {
    let sim = 0;
    if (c.group === 'ja') {
      sim = dirs.ja ? nameSimilarity(dirs.ja.get(c.setId, c.localId)?.name || '', parsed) : 0;
    } else {
      for (const l of dirLangs) {
        if (l === 'ja' || !dirs[l]) continue;
        const e = dirs[l].get(c.setId, c.localId);
        if (e) sim = Math.max(sim, nameSimilarity(e.name, parsed));
      }
    }
    c.nameScore = sim;
    c.score += sim * 40 + (sim > 0.8 ? 10 : 0);
    if (lang === 'ja') c.score += c.group === 'ja' ? 25 : 0;
    else if (lang) c.score += c.group === 'intl' ? 20 : 0;
    // keine Sprache erkannt: japanische Kandidaten je nach "Zeichensalat"-Indiz bevorzugen
    // (mit Bildsuche entscheidet bei gleichem Motiv die Standardsprache, nicht ein fester Bonus)
    if (c.group === 'ja' && lang !== 'ja') c.score += (lang || visual?.length ? 0 : 6) + jaHint * 18;
    if (!lang && visual?.length && c.group === (fallback === 'ja' ? 'ja' : 'intl')) c.score += 8;
    if (modern === true) c.score += isModernDate(c.set?.d) ? 12 : -12;
    c.score += yearBonus(c.set, parsed.year);
    // neuere Sets werden häufiger gescannt – minimaler Bonus als Gleichstandsbrecher
    if (c.set?.d) c.score += Math.max(0, (parseInt(c.set.d, 10) - 1999) / 30);
  }

  // Wurde ein Name gut gelesen, verlieren Kandidaten mit ganz anderem Namen an Gewicht
  const bestName = Math.max(0, ...[...cands.values()].map((c) => c.nameScore || 0));
  if (bestName >= 0.8) for (const c of cands.values()) if ((c.nameScore || 0) < 0.5) c.score -= 20;

  let list = [...cands.values()];

  // 6) Kein Treffer über die Nummer -> reine Namenssuche
  if (!list.length || Math.max(...list.map((c) => c.score)) < 30) {
    const searchLangs = [...dirLangs].filter((l) => l !== 'ja' || lang === 'ja');
    for (const l of searchLangs) {
      const dir = dirs[l];
      if (!dir) continue;
      for (const { bucket, score } of dir.search(queries, { limit: 6, min: 0.72 })) {
        const rank = (e) => yearBonus(e.set, parsed.year) * 10 + (e.hasImage ? 1 : 0);
        const entries = [...bucket.entries].sort((a, b) => rank(b) - rank(a) || (b.set?.d || '').localeCompare(a.set?.d || ''));
        for (const e of entries.slice(0, 8)) {
          const group = l === 'ja' ? 'ja' : 'intl';
          const key = `${group}:${e.setId}:${e.localId}`;
          if (cands.has(key)) continue;
          const c = { key, group, setId: e.setId, localId: e.localId, id: `${e.setId}-${e.localId}`, set: e.set, name: e.name, hasImage: e.hasImage, score: score * 45 + yearBonus(e.set, parsed.year), nameScore: score, reasons: ['name'] };
          cands.set(key, c);
        }
      }
    }
    list = [...cands.values()];
  }

  list.sort((a, b) => b.score - a.score);
  const top = list[0];
  for (const c of list) c.confidence = Math.max(0.05, Math.min(1, c.score / 120));
  if (top && list[1] && top.score - list[1].score < 8) top.confidence *= 0.8;
  return list.slice(0, 16);
}

const INTL = ['de', 'en', 'fr', 'es', 'it', 'pt'];

/**
 * Sprache über den gelesenen Kartennamen bestimmen (z. B. "Enigmara" -> Deutsch).
 * @returns {Promise<{best: string, score: number, ties: string[], sims: object}|null>}
 */
export async function nameLanguage(cand, parsed) {
  if (cand.group !== 'intl') return null;
  const sims = {};
  await Promise.all(
    INTL.map(async (l) => {
      const dir = await nameDirectory(l).catch(() => null);
      const e = dir?.get(cand.setId, cand.localId);
      if (e) sims[l] = nameSimilarity(e.name, parsed);
    }),
  );
  const ranked = Object.entries(sims).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [best, score] = ranked[0];
  const ties = ranked.filter(([, s]) => s >= score - 0.06).map(([l]) => l);
  return { best, score, ties, sims };
}

/**
 * Manuelle Suche: Name und/oder Nummer.
 * @returns {Promise<Array<{group, setId, localId, id, name, set, hasImage, score}>>}
 */
export async function searchCards(query, lang) {
  const q = parseQuery(query);
  const idx = await loadSets();
  const group = LANG[lang]?.group === 'ja' ? 'ja' : 'intl';
  const dir = await nameDirectory(lang);
  const out = [];
  const seen = new Set();
  const push = (e, score) => {
    const key = `${e.setId}-${e.localId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ group, setId: e.setId, localId: e.localId, id: key, name: e.name, set: e.set, hasImage: e.hasImage, score });
  };

  if (q.num != null) {
    let sets = idx.sets.filter((s) => s.g === group);
    if (q.total) sets = sets.filter((s) => s.o === q.total || s.t === q.total);
    if (q.code) {
      const code = q.code.toUpperCase();
      sets = sets.filter((s) => s.id.toUpperCase() === code || (s.a || '').split(/[:/]/).includes(code));
    }
    if (q.total || q.code) {
      for (const s of sets) {
        const e = dir.get(s.id, `${q.prefix}${q.num}`);
        if (!e) continue;
        const sim = q.name ? ratio(norm(q.name), norm(e.name)) : 1;
        push(e, 1 + sim);
      }
    }
  }
  if (q.name && q.name.length >= 2) {
    for (const { bucket, score } of dir.search([q.name], { limit: 40, min: 0.6 })) {
      const entries = [...bucket.entries].sort((a, b) => b.hasImage - a.hasImage || (b.set?.d || '').localeCompare(a.set?.d || ''));
      for (const e of entries) {
        if (q.num != null && localKey(e.localId) !== localKey(`${q.prefix}${q.num}`)) continue;
        push(e, score);
      }
      if (out.length > 120) break;
    }
  }
  return out.slice(0, 120);
}
