// Ergebnis-Ansicht einer Karte: Bild, Sprache, Varianten, Cardmarket-Preise, Aktionen.

import { getCard, imageUrl, guessImage, loadSets, findCards, loadCardIndex } from '../api.js';
import { cardmarketPrice } from '../cardmarket.js';
import { LANGS, LANG, langInfo } from '../lang.js';
import { variantsOf, momentum, cardmarketUrl, CONDITIONS, conditionInfo, conditionFactor, conditionValue } from '../pricing.js';
import { settings, addItem, updateItem, removeItem, recordPrice, priceHistory, priceKey, emit } from '../store.js';
import { db } from '../db.js';
import { esc, money, percent, date, haptic } from '../util.js';
import { openSheet, closeSheet, sheetBody } from './sheet.js';
import { enableHolo } from './holo.js';
import { guideChart, historyChart } from './charts.js';
import { evaluateBuy, evaluateInvestment, verdictSummary, SELL_FEE, PACKAGING } from '../deal.js';
import { toast, sparkle } from './toast.js';

const ICON = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
};

// ---------- Daten laden ----------

/** Lädt Anzeige- und Preisdaten einer Karte in der gewünschten Sprache. */
export async function loadCardData(cand, lang) {
  const group = cand.group;
  let display;
  let priceCard;
  if (group === 'ja') {
    display = priceCard = await getCard('ja', cand.id);
  } else {
    const dl = LANG[lang]?.group === 'intl' ? lang : 'en';
    const [d, p] = await Promise.all([dl === 'en' ? null : getCard(dl, cand.id).catch(() => null), getCard('en', cand.id)]);
    priceCard = p;
    display = d || p;
    if (p && !hasCardmarket(p)) await addCardmarketFallback(p, cand).catch(() => null);
  }
  if (!priceCard && !display) throw new Error('Karte konnte nicht geladen werden.');
  const variants = variantsOf(priceCard || display);
  const shown = display || priceCard;
  // Japanische Karte ohne Bild: Bild der englischen Ausgabe als Ersatz
  const altImage = group === 'ja' && !shown.image ? await englishImageFor(shown, cand).catch(() => null) : null;
  return { display: shown, priceCard: priceCard || display, variants, altImage };
}

export const hasCardmarket = (card) => !!(card.pricing?.cardmarket?.idProduct || card.variants_detailed?.some((v) => v.pricing?.cardmarket?.idProduct));

/** Kein Cardmarket-Preis bei TCGdex: Preis direkt aus Cardmarkets Preisguide ergänzen (gleiches Format). */
export async function addCardmarketFallback(card, cand) {
  const index = await loadCardIndex('en');
  const sameName = (index[cand.setId] || []).filter((r) => r[1] === card.name).map((r) => r[0]);
  const cm = await cardmarketPrice(card, cand.setId, sameName);
  if (!cm) return;
  card.pricing = { ...(card.pricing || {}), cardmarket: cm };
  for (const v of card.variants_detailed || []) v.pricing = { ...(v.pricing || {}), cardmarket: cm };
}

// Seltenheiten mit Standard-Motiv – nur dort ist das Bild der englischen Ausgabe dasselbe Motiv
const REGULAR_RARITIES = ['common', 'uncommon', 'rare', 'double rare', 'holo rare', 'rare holo', 'none'];

/**
 * Bild der englischen Ausgabe einer japanischen Karte (gleiche Pokédex-Nr., gleiche Kartenart).
 * Bevorzugt das zeitlich nächste Set, das nach der japanischen Ausgabe erschien, und keine Secret Rares.
 */
async function englishImageFor(card, cand) {
  const dex = card?.dexId?.[0];
  if (!dex || !REGULAR_RARITIES.includes(String(card.rarity || '').toLowerCase())) return null;
  const [list, { byId }] = await Promise.all([findCards('en', `dexId=${dex}`), loadSets()]);
  const jn = String(card.name || '');
  const mega = /^メガ/.test(jn);
  const suffix = (jn.match(/(ex|EX|GX|VMAX|VSTAR|V)$/) || [])[1]?.toLowerCase() || '';
  const jaDate = cand.set?.d ? new Date(cand.set.d) : null;
  let best = null;
  for (const c of list || []) {
    if (!c.image) continue;
    const n = c.name.toLowerCase();
    if (mega !== n.startsWith('mega ')) continue;
    if (((n.match(/ (ex|gx|vmax|vstar|v)$/) || [])[1] || '') !== suffix) continue;
    const set = byId.get(`intl:${c.id.slice(0, c.id.length - c.localId.length - 1)}`);
    if (!set?.d) continue;
    const num = parseInt(c.localId, 10);
    const secret = Number.isNaN(num) || (set.o && num > set.o);
    let dist = jaDate ? (new Date(set.d) - jaDate) / 86400000 : 3650;
    // Englische Ausgaben erscheinen meist einige Monate nach den japanischen
    dist = dist >= 0 ? dist * 0.5 : -dist;
    const score = dist + (secret ? 2000 : 0);
    if (!best || score < best.score) best = { score, image: c.image };
  }
  return best?.image || null;
}

/** Bester Preis einer geladenen Karte (für Serienscan & Sammlung). */
export function bestValue(data, variantKey) {
  const v = data.variants.find((x) => x.key === variantKey) || data.variants[0];
  return { variant: v, value: v?.cm?.value ?? null };
}

/** Bild in Kartensprache, sonst englisches Bild als Ersatz. */
/**
 * Bildquellen in Reihenfolge: Kartensprache, Englisch, andere Sprachversionen.
 * @returns {{urls: string[], alt: boolean}}  alt = Ersatzbild der englischen Ausgabe
 */
function cardImages(data, cand, lang, scanImage, quality = 'high') {
  const list = [data.display?.image, data.priceCard?.image].filter(Boolean).map((b) => imageUrl(b, quality));
  if (cand?.group !== 'ja' && cand?.set) {
    for (const l of [lang, 'en', 'de', 'fr', 'es', 'it', 'pt']) if (l && l !== 'ja') list.push(guessImage(l, cand.set, cand.localId, quality));
  }
  // Kein Bild in der Datenbank: zuerst dein Scan, dann das Bild der englischen Ausgabe
  if (scanImage) list.push(scanImage);
  const altUrl = data.altImage ? imageUrl(data.altImage, quality) : null;
  if (altUrl) list.push(altUrl);
  return { urls: [...new Set(list.filter(Boolean))], altUrl };
}

/** Basis-URL eines echten Kartenbilds fürs Speichern (Sammlung/Verlauf) – sonst null. */
export function storedImage(data, { withAlt = true } = {}) {
  return data.display?.image || data.priceCard?.image || (withAlt ? data.altImage : null) || null;
}

/** Bildfelder für Sammlung/Verlauf: echtes Bild oder – falls keins existiert – dein Scan. */
export function imageFields(data, scanImage) {
  const real = storedImage(data, { withAlt: false });
  if (real) return { image: real };
  if (scanImage) return { image: null, scanImage };
  return { image: data.altImage || null };
}

/** Vorschaubild (klein) für Kacheln: TCGdex-Bild oder gespeicherter Scan. */
export function thumbOf(entry) {
  return entry?.image ? `${entry.image}/low.webp` : entry?.scanImage || null;
}

/** <img> mit Ersatzquellen (der Reihe nach probiert); ohne Bild bleibt ein Platzhalter. */
export function imgTag(src, fallback, { alt = '', cls = '', lazy = true, placeholder = '', altUrl = '' } = {}) {
  if (!src) return placeholder;
  const fbs = [].concat(fallback || []).filter((u) => u && u !== src);
  const fb = fbs.length ? ` data-fbs="${esc(fbs.join('|'))}"` : '';
  const ph = placeholder ? `this.insertAdjacentHTML('afterend',${esc(JSON.stringify(placeholder))});` : '';
  // Markiert am Elternelement, ob ein Scan oder das Ersatzbild der EN-Ausgabe angezeigt wird
  const onload = `var k=this.src.indexOf('data:')===0?'scan':(this.dataset.alt&&this.src===this.dataset.alt?'alt':'');this.parentNode&&(this.parentNode.dataset.imgkind=k)`;
  const altAttr = altUrl ? ` data-alt="${esc(altUrl)}"` : '';
  return `<img src="${esc(src)}"${fb}${altAttr} alt="${esc(alt)}"${cls ? ` class="${cls}"` : ''}${lazy ? ' loading="lazy"' : ''} decoding="async" onload="${onload}" onerror="var l=(this.dataset.fbs||'').split('|').filter(Boolean);if(l.length){this.src=l.shift();this.dataset.fbs=l.join('|')}else{${ph}this.remove()}">`;
}

/** Entsprechende Karte in der anderen Sprachgruppe (international <-> japanisch) suchen. */
async function crossGroup(cand, display, targetGroup) {
  const { sets } = await loadSets();
  const src = sets.find((s) => s.g === cand.group && s.id === cand.setId);
  if (!src) return null;
  const options = sets.filter((s) => s.g === targetGroup && s.o === src.o && s.o > 0);
  const dex = display?.dexId?.[0];
  for (const s of options) {
    const lang = targetGroup === 'ja' ? 'ja' : 'en';
    const id = `${s.id}-${cand.localId}`;
    const card = await getCard(lang, id).catch(() => null);
    if (!card) continue;
    if (dex && card.dexId?.length && !card.dexId.includes(dex)) continue;
    if (!dex && card.name !== display?.name && targetGroup !== 'ja') continue;
    return { group: targetGroup, setId: s.id, localId: card.localId, id: card.id, name: card.name, set: s, hasImage: !!card.image };
  }
  return null;
}

// ---------- Darstellung ----------

function skeleton(cand) {
  return `
    <div class="result-hero">
      <div class="holo-card"><div class="card-placeholder"><div class="skel" style="position:absolute;inset:0"></div></div></div>
      <div class="result-meta">
        <h2>${esc(cand?.name || 'Karte wird geladen')}</h2>
        <div class="result-sub">${esc(cand?.set?.n || '')}</div>
        <div class="skel" style="height:24px;width:70%;margin-top:12px"></div>
        <div class="skel" style="height:24px;width:50%;margin-top:8px"></div>
      </div>
    </div>
    <div class="price-hero"><div class="skel" style="height:14px;width:40%"></div><div class="skel" style="height:48px;width:60%;margin-top:10px"></div>
      <div class="stats">${'<div class="stat"><div class="skel" style="height:30px"></div></div>'.repeat(6)}</div></div>`;
}

/** "025/165", "4/102", "TG05/TG30" – Promos ohne Gesamtzahl. */
export function cardNumber(localId, official) {
  const lid = String(localId || '');
  const pre = (lid.match(/^[A-Z]+/) || [''])[0];
  if (!official || (pre && !['TG', 'GG', 'SV', 'RC', 'H'].includes(pre))) return lid;
  const digits = lid.slice(pre.length);
  return `${lid}/${pre}${String(official).padStart(digits.length >= 3 ? 3 : pre ? digits.length : 0, '0')}`;
}

/** Platzhalter, wenn es kein Kartenbild gibt – mit Link zur Cardmarket-Seite (dort gibt es meist ein Foto). */
function noImage(link) {
  return `<div class="card-placeholder"><span>Kein Bild in der Datenbank</span><a class="ph-link" href="${esc(link)}" target="_blank" rel="noopener">Bild auf Cardmarket ansehen</a></div>`;
}

// ---------- Kauf-Check ----------

const VERDICT_ICON = { top: '★', good: '✓', fair: '≈', high: '!', bad: '✕' };
const RATIO_MIN = 0.4;
const RATIO_MAX = 1.4;

/** Eingabe als Euro-Betrag lesen ("12,50", "12.5", "12 €"). */
export function parseEuro(text) {
  const t = String(text ?? '').replace(/[^\d,.]/g, '');
  if (!t) return null;
  // letztes Komma/Punkt ist das Dezimaltrennzeichen
  const i = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
  const num = i >= 0 ? `${t.slice(0, i).replace(/[,.]/g, '')}.${t.slice(i + 1)}` : t;
  const v = parseFloat(num);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}

function dealInputs(state) {
  const v = currentVariant(state);
  const cm = v?.cm;
  const buy = evaluateBuy(state.ask, cm, state.condition);
  const inv = cm?.value
    ? evaluateInvestment({
        cm,
        market: buy?.market ?? conditionValue(cm.value, state.condition),
        rarity: state.data.priceCard?.rarity,
        setDate: state.cand.set?.d,
        reverse: v?.reverse,
        history: state.history,
      })
    : null;
  return { buy, inv };
}

function gauge(ratio) {
  const pos = (r) => ((Math.min(RATIO_MAX, Math.max(RATIO_MIN, r)) - RATIO_MIN) / (RATIO_MAX - RATIO_MIN)) * 100;
  const zones = [
    [RATIO_MIN, 0.6, 'var(--green)'],
    [0.6, 0.85, '#7bd389'],
    [0.85, 1.0, 'var(--gold)'],
    [1.0, 1.15, '#f0954a'],
    [1.15, RATIO_MAX, 'var(--red)'],
  ];
  return `
    <div class="gauge" aria-hidden="true">
      ${zones.map(([a, b, c]) => `<i style="left:${pos(a)}%;width:${pos(b) - pos(a)}%;background:${c}"></i>`).join('')}
      <span class="gauge-mark" style="left:${pos(ratio)}%"></span>
      <span class="gauge-tick" style="left:${pos(1)}%"></span>
    </div>
    <div class="gauge-labels"><span>günstig</span><span>Marktwert</span><span>teuer</span></div>`;
}

function dealResultHtml(state) {
  const { buy, inv } = dealInputs(state);
  const cond = conditionInfo(state.condition);
  let html = '';
  if (!currentVariant(state)?.cm?.value) {
    return '<div class="note">Für diese Variante gibt es keinen Cardmarket-Preis – ein Vergleich ist nicht möglich.</div>';
  }
  if (!buy) {
    html += `<div class="note">Gib ein, wofür du die Karte bekommen könntest – z. B. auf dem Flohmarkt. HoloScan vergleicht mit dem Cardmarket-Wert im Zustand <b>${esc(cond.label)}</b> und sagt dir, ob sich der Kauf lohnt.</div>`;
  } else {
    const t = buy.tier;
    const save = buy.diff >= 0;
    html += `
      <div class="verdict v-${t.key}">
        <div class="verdict-head">
          <span class="verdict-icon">${VERDICT_ICON[t.key]}</span>
          <div><div class="verdict-label">${esc(t.label)}</div><div class="verdict-text">${esc(t.text)}</div></div>
        </div>
        ${gauge(buy.ratio)}
        <div class="verdict-grid">
          <div><small>Marktwert (${esc(cond.short)})</small><b>${money(buy.market)}</b></div>
          <div><small>Dein Preis</small><b>${money(buy.ask)}</b></div>
          <div><small>${save ? 'Ersparnis' : 'Aufpreis'}</small><b class="${save ? 'up' : 'down'}">${money(Math.abs(buy.diff))} (${Math.abs(Math.round(buy.discount * 100))} %)</b></div>
          <div><small>Gewinn bei Verkauf*</small><b class="${buy.profit >= 0 ? 'up' : 'down'}">${buy.profit >= 0 ? '+' : '−'}${money(Math.abs(buy.profit))}</b></div>
        </div>
        ${buy.notes.map((n) => `<p class="verdict-note">${esc(n)}</p>`).join('')}
        ${buy.market >= 1 ? `<p class="verdict-targets">Guter Kauf bis <b>${money(buy.targetGood)}</b> · Top-Deal bis <b>${money(buy.targetTop)}</b></p>` : ''}
        <p class="verdict-summary">${esc(verdictSummary(buy, inv || { key: 'neutral' }))}</p>
        <small class="verdict-foot">* Verkauf zum Marktwert auf Cardmarket abzüglich ${Math.round(SELL_FEE * 100)} % Provision und ${money(PACKAGING)} Verpackung.</small>
      </div>`;
  }
  if (inv) {
    html += `
      <div class="invest inv-${inv.key}">
        <div class="invest-head"><span>Als Investment</span><b>${esc(inv.label)}</b></div>
        <div class="invest-bar"><i style="width:${inv.score}%"></i><span>${inv.score}/100</span></div>
        <ul class="invest-reasons">${inv.reasons.map((r) => `<li class="${r.sign > 0 ? 'plus' : r.sign < 0 ? 'minus' : 'zero'}">${esc(r.text)}</li>`).join('')}</ul>
        <small>Regelbasierte Einschätzung aus Cardmarket-Daten, Set-Alter und Seltenheit – keine Anlageberatung.</small>
      </div>`;
  }
  return html;
}

function dealSection(state, v, cm) {
  if (!cm?.value) return '';
  return `
    <div class="section deal" id="deal">
      <div class="section-title"><span>Kauf-Check</span><span style="text-transform:none;letter-spacing:0;font-weight:600">Lohnt sich der Kauf?</span></div>
      <div class="deal-box">
        <label class="deal-field">
          <span class="deal-label">Angebotspreis</span>
          <input id="deal-ask" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="z. B. 5,00" value="${state.ask ? String(state.ask).replace('.', ',') : ''}">
          <span class="deal-eur">€</span>
        </label>
        <div class="deal-conds" role="group" aria-label="Zustand der Karte">
          ${CONDITIONS.map((c) => `<button class="deal-cond ${c.id === Number(state.condition) ? 'is-active' : ''}" data-cond="${c.id}" style="--c:${c.color}" title="${esc(c.label)}">${esc(c.short)}</button>`).join('')}
        </div>
      </div>
      <div id="deal-result">${dealResultHtml(state)}</div>
    </div>`;
}

/** Zeile der Zustandstabelle: Auswahl + Richtwert + Link zu den echten Angeboten. */
function conditionRow(c, base, selected, link) {
  const f = conditionFactor(c.id);
  const est = conditionValue(base, c.id);
  const pct = Math.round((f - 1) * 100);
  const hint = c.id === 2 ? '= Preistrend' : f === 1 ? 'wie NM' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)} %`;
  return `
    <div class="cond-row ${c.id === selected ? 'is-active' : ''}">
      <button class="cond-main" data-cond="${c.id}" aria-pressed="${c.id === selected}">
        <span class="cond-badge" style="--c:${c.color}">${esc(c.short)}</span>
        <span class="cond-name">${esc(c.label)}<small>${esc(hint)}</small></span>
        <span class="cond-price">${est ? `${c.id === 2 ? '' : '≈ '}${money(est)}` : '–'}</span>
      </button>
      <a class="cond-link" href="${esc(link)}" target="_blank" rel="noopener" aria-label="Angebote ab ${esc(c.label)} auf Cardmarket">Angebote ${ICON.ext}</a>
    </div>`;
}

function statCell(k, v, unit) {
  return `<div class="stat"><div class="stat-k">${k}</div><div class="stat-v">${money(v, unit)}</div></div>`;
}

function render(state) {
  const { cand, data, lang, variantKey, condition, item, alternatives, langSource, history: hist } = state;
  const d = data.display;
  const p = data.priceCard;
  const v = data.variants.find((x) => x.key === variantKey) || data.variants[0];
  const cm = v?.cm;
  const mom = momentum(cm);
  const li = langInfo(lang);
  const set = d.set || p.set || {};
  const number = cardNumber(d.localId || cand.localId, set.cardCount?.official || cand.set?.o);
  const images = cardImages(data, cand, lang, state.scanImage);
  const setSymbol = set.symbol ? `${set.symbol}.webp` : null;
  const legalStd = p.legal?.standard;
  const linkFor = (minCondition) =>
    cardmarketUrl({
      idProduct: cm?.idProduct,
      siteLang: settings.siteLang,
      cmLang: li.cm,
      minCondition,
      reverse: v?.reverse,
      firstEd: v?.firstEd,
      search: p.name || d.name,
    });
  const cmLink = linkFor(condition);
  // Alle Angebote ohne Sprach-/Zustandsfilter – mit Filtern ist die Liste bei seltenen Karten oft leer
  const cmAll = cardmarketUrl({ idProduct: cm?.idProduct, siteLang: settings.siteLang, search: p.name || d.name });
  const isJa = cand.group === 'ja';
  const langNote = isJa
    ? 'Japanische Karten sind bei Cardmarket <b>eigene Produkte</b> – die Preise gelten für die japanische Ausgabe.'
    : `Der Cardmarket-Preisguide fasst alle europäischen Sprachversionen zusammen. Die Angebots-Links zeigen nur Karten auf <b>${esc(li.label)}</b>, günstigstes zuerst.`;

  const conf = state.confidence;
  const confHtml =
    conf != null
      ? `<div class="confidence"><span>Übereinstimmung</span><span class="confidence-bar"><i style="width:${Math.round(conf * 100)}%;background:${conf > 0.66 ? 'var(--green)' : conf > 0.4 ? 'var(--gold)' : 'var(--red)'}"></i></span><span>${Math.round(conf * 100)} %</span></div>`
      : '';

  return `
    <div class="result-hero">
      <div class="holo-card" data-action="zoom">
        ${imgTag(images.urls[0], images.urls.slice(1), { alt: d.name, lazy: false, placeholder: noImage(cmAll), altUrl: images.altUrl }) || noImage(cmAll)}
        <span class="img-badge b-scan" title="Für diese Karte gibt es kein Bild in der Datenbank – gezeigt wird dein Scan">Dein Scan</span>
        <span class="img-badge b-alt" title="Für diese Karte gibt es kein Bild – gezeigt wird die englische Ausgabe">Bild: EN-Ausgabe</span>
      </div>
      <div class="result-meta">
        <h2>${esc(d.name)}</h2>
        <div class="result-sub">
          <div class="set-line">${setSymbol ? `<img class="set-symbol" src="${esc(setSymbol)}" alt="" onerror="this.remove()">` : ''}<span>${esc(set.name || cand.set?.n || '')}</span></div>
          <div>Nr. ${esc(number)}${cand.set?.a ? ` · ${esc(cand.set.a.split(':')[0])}` : ''}${cand.set?.d ? ` · ${esc(cand.set.d.slice(0, 4))}` : ''}</div>
        </div>
        <div class="tags">
          <span class="tag tag-gold">${li.flag} ${esc(li.short)}</span>
          ${d.rarity && p.rarity !== 'None' ? `<span class="tag">${esc(d.rarity)}</span>` : ''}
          ${p.regulationMark ? `<span class="tag">Reg. ${esc(p.regulationMark)}</span>` : ''}
          ${legalStd ? '<span class="tag tag-green">Standard-legal</span>' : ''}
          ${d.hp ? `<span class="tag">${esc(d.hp)} KP</span>` : ''}
        </div>
        ${confHtml}
      </div>
    </div>

    <div class="section">
      <div class="section-title"><span>Kartensprache</span><span style="text-transform:none;letter-spacing:0;font-weight:600">${esc(langSource || '')}</span></div>
      <div class="chip-row">
        ${LANGS.map((l) => `<button class="chip chip-soft ${l.code === lang ? 'is-active' : ''}" data-lang="${l.code}"><span class="flag">${l.flag}</span>${esc(l.short)}</button>`).join('')}
      </div>
    </div>

    ${
      data.variants.length > 1
        ? `<div class="section"><div class="section-title"><span>Variante</span></div>
            <div class="seg seg-auto">${data.variants.map((x) => `<button class="seg-btn ${x.key === v.key ? 'is-active' : ''}" data-variant="${esc(x.key)}">${esc(x.label)}</button>`).join('')}</div></div>`
        : ''
    }

    <div class="price-hero">
      <div class="price-label"><span class="cm-logo"><i></i>Cardmarket · ${esc(cm?.valueLabel || 'Preis')}</span><span>${cm?.updated ? `Stand ${esc(date(cm.updated))}` : ''}</span></div>
      <div class="price-main">
        <span class="price-value" data-count="${cm?.value ?? ''}">${cm?.value ? money(cm.value) : '–'}</span>
        ${mom != null ? `<span class="delta ${mom > 0.03 ? 'up' : mom < -0.03 ? 'down' : 'flat'}" title="Ø 7 Tage gegenüber Ø 30 Tage">${mom > 0.03 ? '▲' : mom < -0.03 ? '▼' : '■'} ${esc(percent(mom))}</span>` : ''}
      </div>
      <div class="price-caption">${cm?.value ? `${esc(v.label)} · ${cm.source === 'cardmarket' ? 'direkt aus dem Cardmarket-Preisguide' : 'Preisguide in Euro'}${cm.ambiguous ? ' · Zuordnung nicht eindeutig' : ''}` : 'Für diese Variante liegt kein Cardmarket-Preis vor.'}</div>
      ${
        cm
          ? `<div class="stats">
              ${statCell('Ab-Preis', cm.low)}
              ${statCell('Ø Verkauf', cm.avg)}
              ${statCell('Trend', cm.trend)}
              ${statCell('Ø 1 Tag', cm.avg1)}
              ${statCell('Ø 7 Tage', cm.avg7)}
              ${statCell('Ø 30 Tage', cm.avg30)}
            </div>
            ${guideChart(cm)}`
          : ''
      }
      ${settings.showUSD && v?.tcgplayer ? `<div class="usd-row"><span>TCGplayer Market (USA)</span><b>${money(v.tcgplayer.value, 'USD')}</b></div>` : ''}
    </div>

    ${dealSection(state, v, cm)}

    ${hist && hist.length >= 2 ? `<div class="section"><div class="section-title"><span>Dein Preisverlauf</span><span style="text-transform:none;letter-spacing:0">${hist.length} Abrufe</span></div>${historyChart(hist)}</div>` : ''}

    <div class="section">
      <div class="section-title"><span>Preis nach Zustand</span><span style="text-transform:none;letter-spacing:0;font-weight:600">${esc(v?.label || '')}</span></div>
      <div class="cond-list">
        ${CONDITIONS.map((c) => conditionRow(c, cm?.value, Number(condition), linkFor(c.id))).join('')}
      </div>
      <div class="note" style="margin-top:10px">
        <b>Richtwerte</b> aus dem Cardmarket-Preistrend mit üblichen Abschlägen je Zustand (anpassbar unter „Mehr“) – Cardmarket veröffentlicht keine Preise je Zustand.
        Die echten Angebote öffnest du mit „Angebote“ in der jeweiligen Zeile. ${langNote}
      </div>
    </div>

    <div class="actions">
      <a class="btn btn-gold btn-span" href="${esc(cmAll)}" target="_blank" rel="noopener">${ICON.ext} ${cm?.idProduct ? 'Alle Angebote auf Cardmarket' : 'Auf Cardmarket suchen'}</a>
      ${cm?.idProduct ? `<a class="btn btn-span" href="${esc(cmLink)}" target="_blank" rel="noopener">${ICON.ext} Nur ${esc(li.label)} · ab ${esc(conditionInfo(condition).short)}</a>` : ''}
      ${
        item
          ? ''
          : `<button class="btn" data-action="add">${ICON.plus} Sammlung</button>
             <button class="btn" data-action="wish">${ICON.heart} Merkliste</button>`
      }
      <button class="btn ${item ? '' : 'btn-span btn-outline'}" data-action="share">${ICON.share} Teilen</button>
      ${item ? `<button class="btn btn-danger" data-action="remove">${ICON.trash} Entfernen</button>` : ''}
    </div>

    ${item ? itemEditor(item) : ''}

    ${
      alternatives?.length
        ? `<div class="section">
            <div class="section-title"><span>Nicht die richtige Karte?</span></div>
            <div class="alt-list">${alternatives
              .map((a, i) => {
                const src = a.hasImage === false ? null : guessImage(a.group === 'ja' ? 'ja' : lang, a.set, a.localId, 'low');
                const fb = a.group === 'ja' ? null : guessImage('en', a.set, a.localId, 'low');
                return `<button class="alt-item" data-alt="${i}">
                  <div class="thumb">${imgTag(src || fb, fb)}</div>
                  <div class="alt-name">${esc(a.name)}</div>
                  <div class="alt-set">${esc(a.set?.n || a.setId)} · ${esc(a.localId)}</div>
                </button>`;
              })
              .join('')}</div>
          </div>`
        : ''
    }

    <p class="footnote">Preisdaten: Cardmarket-Preisguide via TCGdex${cm?.updated ? ` (${esc(date(cm.updated))})` : ''}. Angaben ohne Gewähr.<br>HoloScan ist kein offizielles Produkt von Cardmarket, Nintendo, The Pokémon Company oder TCGdex.</p>`;
}

function itemEditor(item) {
  const isWish = item.list === 'wish';
  return `
    <div class="section">
      <div class="section-title"><span>${isWish ? 'Merkliste' : 'In deiner Sammlung'}</span><span style="text-transform:none;letter-spacing:0">seit ${esc(date(item.addedAt))}</span></div>
      <div class="form-grid">
        <div class="two-col">
          <div class="field">
            <label>Anzahl</label>
            <div class="stepper"><button data-qty="-1" aria-label="weniger">−</button><output id="qty-out">${item.qty || 1}</output><button data-qty="1" aria-label="mehr">+</button></div>
          </div>
          <div class="field">
            <label for="item-cond">Zustand</label>
            <div class="select"><select id="item-cond">${CONDITIONS.map((c) => `<option value="${c.id}" ${Number(item.condition) === c.id ? 'selected' : ''}>${c.short} – ${c.label}</option>`).join('')}</select></div>
          </div>
        </div>
        ${
          isWish
            ? `<div class="field"><label for="item-target">${ICON.bell.replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"')} Preisalarm bei ≤ (€)</label><input id="item-target" type="number" inputmode="decimal" step="0.01" min="0" placeholder="z. B. 15,00" value="${item.target ?? ''}"></div>
               <button class="btn btn-outline btn-block" data-action="move-to-collection">In die Sammlung verschieben</button>`
            : `<div class="field"><label for="item-buy">Einkaufspreis pro Karte (€)</label><input id="item-buy" type="number" inputmode="decimal" step="0.01" min="0" placeholder="optional" value="${item.buyPrice ?? ''}"></div>`
        }
      </div>
    </div>`;
}

function animateCount(el) {
  const target = parseFloat(el?.dataset.count);
  if (!target || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const start = performance.now();
  const dur = 700;
  const step = (t) => {
    const k = Math.min(1, (t - start) / dur);
    const e = 1 - (1 - k) ** 3;
    el.textContent = money(target * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- Öffentliche API ----------

/**
 * Zeigt eine Karte im Bottom-Sheet.
 * @param {object} o
 * @param {object} o.candidate   Kandidat aus identify()/searchCards() oder aus einem Sammlungseintrag
 * @param {string} o.lang        Kartensprache
 * @param {string} [o.langSource] Hinweis, woher die Sprache stammt
 * @param {Array}  [o.alternatives]
 * @param {object} [o.item]      Sammlungseintrag (Bearbeiten-Modus)
 * @param {number} [o.confidence]
 * @param {Function} [o.onLoaded] (data, state) => void
 */
export async function showCard(o) {
  const state = {
    cand: o.candidate,
    lang: o.lang || settings.fallbackLang,
    langSource: o.langSource || '',
    alternatives: (o.alternatives || []).filter((a) => a.key !== o.candidate.key && a.id !== o.candidate.id).slice(0, 10),
    item: o.item || null,
    confidence: o.confidence ?? null,
    condition: o.item?.condition || settings.condition,
    variantKey: o.item?.variantKey || null,
    data: null,
    history: null,
    scanImage: o.scanImage || o.item?.scanImage || null, // eigenes Foto der Karte (falls kein Bild existiert)
    ask: null, // Kauf-Check: Angebotspreis
    toppedOnce: false,
    token: Symbol('card'),
  };
  if (state.cand.group === 'ja') state.lang = 'ja';
  else if (state.lang === 'ja') state.lang = settings.fallbackLang === 'ja' ? 'en' : settings.fallbackLang;

  const root = openSheet(`<div class="result" data-card>${skeleton(state.cand)}</div>`);
  const container = root.querySelector('[data-card]');
  container._state = state;

  await load(container, state, { first: true, onLoaded: o.onLoaded, source: o.source });
  return state;
}

async function load(container, state, { first = false, onLoaded, source } = {}) {
  const token = (state.token = Symbol('load'));
  try {
    const data = await loadCardData(state.cand, state.lang);
    if (token !== state.token || !container.isConnected) return;
    state.data = data;
    if (!state.variantKey || !data.variants.some((v) => v.key === state.variantKey)) state.variantKey = data.variants[0]?.key;
    const v = data.variants.find((x) => x.key === state.variantKey);
    const key = priceKey(state.cand.group, state.cand.id, state.variantKey);
    if (v?.cm?.value) await recordPrice(key, v.cm.value);
    state.history = await priceHistory(key);
    paint(container, state);
    if (first) {
      onLoaded?.(data, state);
      if (state.item && v?.cm?.value) {
        updateItem(state.item.uid, { price: v.cm.value, priceUpdated: v.cm.updated, checkedAt: Date.now(), idProduct: v.cm.idProduct });
      }
      if (source === 'scan' && v?.cm?.value >= 50) {
        const r = container.querySelector('.price-value')?.getBoundingClientRect();
        setTimeout(() => sparkle(r ? r.left + r.width / 2 : undefined, r ? r.top : undefined), 350);
        haptic([20, 40, 20, 40, 60]);
      }
    }
  } catch (err) {
    if (token !== state.token || !container.isConnected) return;
    console.error(err);
    container.innerHTML = `
      <div class="empty">
        <h3>Preis konnte nicht geladen werden</h3>
        <p>${navigator.onLine ? 'Der Kartendienst antwortet gerade nicht.' : 'Du bist offline.'} Bitte versuche es gleich noch einmal.</p>
        <button class="btn btn-gold" data-action="retry">Erneut versuchen</button>
      </div>`;
    container.querySelector('[data-action="retry"]').onclick = () => {
      container.innerHTML = skeleton(state.cand);
      load(container, state, { first, onLoaded, source });
    };
  }
}

function paint(container, state) {
  container.innerHTML = render(state);
  enableHolo(container.querySelector('.holo-card'));
  animateCount(container.querySelector('.price-value'));
  bind(container, state);
}

function currentVariant(state) {
  return state.data.variants.find((x) => x.key === state.variantKey) || state.data.variants[0];
}

function itemPayload(state, list) {
  const d = state.data.display;
  const v = currentVariant(state);
  return {
    list,
    id: state.cand.id,
    group: state.cand.group,
    setId: state.cand.setId,
    localId: state.cand.localId,
    lang: state.lang,
    name: d.name,
    setName: d.set?.name || state.cand.set?.n || '',
    setDate: state.cand.set?.d || null,
    official: d.set?.cardCount?.official || state.cand.set?.o || null,
    ...imageFields(state.data, state.scanImage),
    variantKey: v?.key,
    variantLabel: v?.label,
    condition: Number(state.condition) || 2,
    qty: 1,
    price: v?.cm?.value ?? null,
    priceUpdated: v?.cm?.updated || null,
    idProduct: v?.cm?.idProduct || null,
    // Preis aus dem Kauf-Check als Einkaufspreis übernehmen
    ...(state.ask && list === 'collection' ? { buyPrice: state.ask } : {}),
  };
}

function bind(container, state) {
  container.querySelectorAll('[data-lang]').forEach((b) =>
    b.addEventListener('click', async () => {
      const lang = b.dataset.lang;
      if (lang === state.lang) return;
      haptic(8);
      const targetGroup = LANG[lang].group;
      if (targetGroup !== state.cand.group) {
        container.querySelectorAll('[data-lang]').forEach((x) => x.classList.toggle('is-active', x === b));
        const other = await crossGroup(state.cand, state.data.display, targetGroup).catch(() => null);
        if (!other) {
          toast(targetGroup === 'ja' ? 'Keine passende japanische Ausgabe gefunden.' : 'Keine passende internationale Ausgabe gefunden.', { type: 'error' });
          container.querySelectorAll('[data-lang]').forEach((x) => x.classList.toggle('is-active', x.dataset.lang === state.lang));
          return;
        }
        state.cand = other;
        state.variantKey = null;
      }
      state.lang = lang;
      state.langSource = 'manuell gewählt';
      container.innerHTML = skeleton(state.cand);
      load(container, state);
    }),
  );

  container.querySelectorAll('[data-variant]').forEach((b) =>
    b.addEventListener('click', async () => {
      state.variantKey = b.dataset.variant;
      haptic(8);
      const v = currentVariant(state);
      const key = priceKey(state.cand.group, state.cand.id, state.variantKey);
      if (v?.cm?.value) await recordPrice(key, v.cm.value);
      state.history = await priceHistory(key);
      const scroll = sheetBody().scrollTop;
      paint(container, state);
      sheetBody().scrollTop = scroll;
      if (state.item) updateItem(state.item.uid, { variantKey: v.key, variantLabel: v.label, price: v?.cm?.value ?? null, priceUpdated: v?.cm?.updated || null });
    }),
  );

  const repaint = () => {
    const scroll = sheetBody().scrollTop;
    paint(container, state);
    sheetBody().scrollTop = scroll;
  };

  // Zustand wählen: gilt für "Zur Sammlung", den Hauptlink und – bei gespeicherten Karten – den Eintrag selbst
  container.querySelectorAll('[data-cond]').forEach((b) =>
    b.addEventListener('click', async () => {
      state.condition = Number(b.dataset.cond);
      haptic(6);
      if (state.item && Number(state.item.condition) !== state.condition) {
        state.item.condition = state.condition;
        await updateItem(state.item.uid, { condition: state.condition });
        toast(`Zustand gespeichert: ${conditionInfo(state.condition).label}`, { type: 'success', ms: 1800 });
      }
      repaint();
    }),
  );

  // Kauf-Check: Urteil live beim Tippen aktualisieren (ohne das Sheet neu zu zeichnen)
  const askInput = container.querySelector('#deal-ask');
  if (askInput) {
    let lastTier = null;
    const update = () => {
      state.ask = parseEuro(askInput.value);
      const box = container.querySelector('#deal-result');
      if (box) box.innerHTML = dealResultHtml(state);
      const tier = evaluateBuy(state.ask, currentVariant(state)?.cm, state.condition)?.tier.key || null;
      if (tier && tier !== lastTier) haptic(tier === 'top' || tier === 'good' ? [8, 30, 8] : 8);
      lastTier = tier;
    };
    askInput.addEventListener('input', update);
    askInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') askInput.blur();
    });
    askInput.addEventListener('change', () => {
      const buy = evaluateBuy(state.ask, currentVariant(state)?.cm, state.condition);
      if (buy?.tier.key === 'top' && !state.toppedOnce) {
        state.toppedOnce = true;
        const r = container.querySelector('.verdict')?.getBoundingClientRect();
        sparkle(r ? r.left + r.width / 2 : undefined, r ? r.top + 30 : undefined);
      }
    });
  }

  container.querySelectorAll('[data-alt]').forEach((b) =>
    b.addEventListener('click', () => {
      const alt = state.alternatives[Number(b.dataset.alt)];
      if (!alt) return;
      haptic(10);
      const prev = state.cand;
      state.alternatives = [prev, ...state.alternatives.filter((a) => a !== alt)];
      state.cand = alt;
      state.variantKey = null;
      state.confidence = null;
      if (alt.group === 'ja') state.lang = 'ja';
      else if (state.lang === 'ja') state.lang = settings.fallbackLang === 'ja' ? 'en' : settings.fallbackLang;
      container.innerHTML = skeleton(alt);
      sheetBody().scrollTop = 0;
      load(container, state);
    }),
  );

  container.querySelector('[data-action="zoom"]')?.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    zoom(container.querySelector('.holo-card img')?.src);
  });

  const act = (name, fn) => container.querySelector(`[data-action="${name}"]`)?.addEventListener('click', fn);

  act('add', async () => {
    const { item, merged } = await addItem(itemPayload(state, 'collection'));
    haptic([10, 30, 10]);
    toast(merged ? `Anzahl erhöht (${item.qty}×)` : state.ask ? `Zur Sammlung hinzugefügt · Einkauf ${money(state.ask)}` : 'Zur Sammlung hinzugefügt', {
      type: 'success',
      image: thumbOf(item) || undefined,
      action: { label: 'Rückgängig', fn: () => (merged ? updateItem(item.uid, { qty: item.qty - 1 }) : removeItem(item.uid)) },
    });
  });

  act('wish', async () => {
    const { item, merged } = await addItem(itemPayload(state, 'wish'));
    haptic([10, 30, 10]);
    toast(merged ? 'Schon auf der Merkliste' : 'Auf die Merkliste gesetzt', {
      type: 'success',
      action: merged ? undefined : { label: 'Rückgängig', fn: () => removeItem(item.uid) },
    });
  });

  act('share', async () => {
    const d = state.data.display;
    const v = currentVariant(state);
    const li = langInfo(state.lang);
    const url = cardmarketUrl({ idProduct: v?.cm?.idProduct, siteLang: settings.siteLang, cmLang: li.cm, search: d.name });
    const cond = conditionInfo(state.condition);
    const est = conditionValue(v?.cm?.value, cond.id);
    const text = `${d.name} · ${d.set?.name || ''} ${d.localId} (${li.short}, ${v?.label || ''})\nCardmarket ${v?.cm?.valueLabel || 'Preis'}: ${money(v?.cm?.value)}${cond.id !== 2 && est ? `\nZustand ${cond.short}: ≈ ${money(est)} (geschätzt)` : ''}`;
    try {
      if (navigator.share) await navigator.share({ title: d.name, text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        toast('In die Zwischenablage kopiert', { type: 'success' });
      }
    } catch {
      /* abgebrochen */
    }
  });

  act('remove', async () => {
    if (!state.item) return;
    const snapshot = { ...state.item };
    await removeItem(state.item.uid);
    closeSheet();
    toast(`${snapshot.name} entfernt`, {
      action: {
        label: 'Rückgängig',
        fn: async () => {
          await db.put('items', snapshot);
          emit('items');
        },
      },
    });
  });

  act('move-to-collection', async () => {
    if (!state.item) return;
    await updateItem(state.item.uid, { list: 'collection', addedAt: Date.now(), addedPrice: state.item.price });
    closeSheet();
    toast('In die Sammlung verschoben', { type: 'success' });
  });

  if (state.item) {
    const out = container.querySelector('#qty-out');
    container.querySelectorAll('[data-qty]').forEach((b) =>
      b.addEventListener('click', async () => {
        const qty = Math.max(1, (state.item.qty || 1) + Number(b.dataset.qty));
        state.item.qty = qty;
        out.textContent = qty;
        haptic(6);
        await updateItem(state.item.uid, { qty });
      }),
    );
    container.querySelector('#item-cond')?.addEventListener('change', async (e) => {
      state.item.condition = Number(e.target.value);
      state.condition = state.item.condition;
      await updateItem(state.item.uid, { condition: state.item.condition });
      repaint();
    });
    const num = (v) => (v === '' ? null : Math.max(0, parseFloat(String(v).replace(',', '.'))));
    container.querySelector('#item-buy')?.addEventListener('change', (e) => updateItem(state.item.uid, { buyPrice: num(e.target.value) }));
    container.querySelector('#item-target')?.addEventListener('change', (e) => {
      const target = num(e.target.value);
      updateItem(state.item.uid, { target });
      if (target) toast(`Preisalarm bei ≤ ${money(target)} aktiv`, { type: 'success' });
    });
  }
}

function zoom(src) {
  if (!src) return;
  const el = document.createElement('div');
  el.className = 'zoom';
  el.innerHTML = `<div class="holo-card"><img src="${esc(src)}" alt=""></div>`;
  el.addEventListener('click', () => el.remove());
  document.body.append(el);
  enableHolo(el.querySelector('.holo-card'));
}

/** Kandidat aus einem Sammlungseintrag bauen. */
export function candidateFromItem(item, set) {
  return {
    key: `${item.group}:${item.setId}:${item.localId}`,
    group: item.group,
    setId: item.setId,
    localId: item.localId,
    id: item.id,
    name: item.name,
    set: set || { n: item.setName, o: item.official, d: item.setDate },
    hasImage: !!item.image || !!item.scanImage,
  };
}

