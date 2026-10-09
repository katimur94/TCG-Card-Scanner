// KI-Leser: liest Name, Nummer, Set-Kürzel und Sprache einer Karte mit einem Bild-Sprachmodell
// (Standard: Gemma über OpenRouter, kostenlos mit eigenem API-Schlüssel). Optional, nur bei Bedarf.

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_AI_MODEL = 'google/gemma-4-31b-it:free';
const LANGS = ['de', 'en', 'fr', 'es', 'it', 'pt', 'ja'];

const PROMPT = `You are reading a photo of a single Pokémon trading card. Read the printed text exactly.
Answer ONLY with JSON, no explanation:
{"name": "card name as printed (keep suffixes like ex, V, VMAX, GX, LV.X)",
 "number": "collector number as printed bottom left/right, e.g. 025/165, SV64/SV94, SWSH213, DP12, TG05/TG30",
 "setCode": "set abbreviation printed next to the number (e.g. PAL, MEW, SV2a, s9) or empty",
 "language": "language of the card text: de, en, fr, es, it, pt or ja",
 "hp": "HP/KP/PV/PS value as number or empty"}
If something is unreadable, use an empty string. Do not guess numbers.`;

/** Karte als JPEG-Data-URL (gerade gerückt, ca. 640 px breit). */
function toDataUrl(view, width = 640) {
  const c = document.createElement('canvas');
  const s = Math.min(1, width / view.width);
  c.width = Math.round(view.width * s);
  c.height = Math.round(view.height * s);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(view, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

function parseAnswer(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let d;
  try {
    d = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const str = (v) => (v == null ? '' : String(v).trim());
  const lang = str(d.language).toLowerCase().slice(0, 2);
  return {
    name: str(d.name),
    number: str(d.number).replace(/\s+/g, ''),
    setCode: str(d.setCode),
    language: LANGS.includes(lang) ? lang : null,
    hp: parseInt(str(d.hp), 10) || null,
  };
}

export class AiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Karte von der KI lesen lassen.
 * @returns {Promise<{name, number, setCode, language, hp, model, ms}>}
 */
export async function readCardAI(view, { key, model = DEFAULT_AI_MODEL, timeout = 30000 } = {}) {
  if (!key) throw new AiError('Kein API-Schlüssel', 401);
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': location.origin + location.pathname,
        'X-Title': 'HoloScan',
      },
      body: JSON.stringify({
        model: model || DEFAULT_AI_MODEL,
        temperature: 0,
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: toDataUrl(view) } },
            ],
          },
        ],
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.error) {
      const status = data?.error?.code || res.status;
      const msg =
        status === 401
          ? 'API-Schlüssel ungültig'
          : status === 429
            ? 'Kostenloses KI-Limit erreicht – später erneut versuchen'
            : status === 402
              ? 'Für dieses Modell fehlt Guthaben'
              : data?.error?.message || `KI-Fehler (HTTP ${res.status})`;
      throw new AiError(msg, status);
    }
    const out = parseAnswer(data?.choices?.[0]?.message?.content);
    if (!out) throw new AiError('KI-Antwort nicht lesbar', 0);
    return { ...out, model: data.model || model, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    if (err.name === 'AbortError') throw new AiError('KI antwortet nicht (Zeitüberschreitung)', 408);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * KI-Ergebnis als zusätzliche "OCR-Zeilen" (Name oben, Nummer unten), damit die normale
 * Auswertung (parseCard/identify) es wie gut gelesenen Text nutzt.
 */
export function aiLines(ai) {
  const lines = [];
  if (ai.name) lines.push({ text: ai.name, conf: 0.99, y: 0.05, h: 0.06, x0: 0.1, x1: 0.7, pass: 'ai' });
  if (ai.number) lines.push({ text: `${ai.setCode ? `${ai.setCode} ` : ''}${ai.number}`, conf: 0.99, y: 0.95, h: 0.02, x0: 0.05, x1: 0.4, pass: 'ai' });
  return lines;
}
