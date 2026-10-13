// KI-Leser (nur Notfall-Fallback, mit dem Gemini-Schlüssel des Nutzers, direkt aus dem Browser):
// Modell-Kette (z. B. Flash Lite -> Flash), geprüft gegen die Modell-Liste der API,
// eigener Tageszähler je Modell (Reset Mitternacht pazifischer Zeit), bei 429 nächstes Modell.
// Das Ergebnis wird immer gegen den Katalog geprüft (siehe recognize.ts) – der Name allein reicht nie.

import { db } from '../db/schema';

export interface AiCardRead {
  region: 'intl' | 'ja' | null;
  language: string | null;
  name: string;
  setCode: string;
  number: string;
  variant: string;
  confidence: number;
  model: string;
}

export class AiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

const LANGS = ['de', 'en', 'fr', 'es', 'it', 'pt', 'ja'];
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export const PROMPT = `You are reading a photo of a single collectible trading card. Read the printed text exactly.
Return JSON with: region ("intl" or "ja" – Japanese print), language (de, en, fr, es, it, pt or ja),
name (card name as printed, keep suffixes like ex, V, VMAX, GX), set_code (set abbreviation printed next to the number, or ""),
number (collector number as printed, e.g. 025/165, SV64/SV94, SWSH213, TG05/TG30 – never guess, "" if unreadable),
variant (normal, holo, reverse, first-edition or ""), confidence (0..1, how sure you are about number and name).`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    region: { type: 'STRING', enum: ['intl', 'ja'] },
    language: { type: 'STRING', enum: LANGS },
    name: { type: 'STRING' },
    set_code: { type: 'STRING' },
    number: { type: 'STRING' },
    variant: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
  },
  required: ['region', 'language', 'name', 'number', 'confidence'],
};

// ---------- Tageszähler (Google liefert die Restmenge nicht per API) ----------

/** Kalendertag in Los Angeles – dort setzt Google die Tageslimits zurück (9 Uhr deutscher Zeit). */
export function dayPacific(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export async function usageToday(model: string) {
  const r = await db.ai_usage.get(`${dayPacific()}|${model}`);
  return { count: r?.count ?? 0, exhausted: !!r?.exhaustedUntil && r.exhaustedUntil > Date.now() };
}

async function bump(model: string, exhausted = false) {
  const day = dayPacific();
  const id = `${day}|${model}`;
  const r = (await db.ai_usage.get(id)) || { id, dayPacific: day, model, count: 0, exhaustedUntil: null };
  if (exhausted) r.exhaustedUntil = Date.now() + 24 * 3600 * 1000;
  else r.count++;
  await db.ai_usage.put(r);
}

/** Vorbelegte Tageslimits (änderbar in den Einstellungen). */
export function defaultLimit(model: string) {
  if (/lite/i.test(model)) return 1000;
  if (/flash/i.test(model)) return 250;
  return 100;
}

// ---------- Gemini ----------

export interface GeminiModel {
  id: string; // ohne "models/"
  label: string;
}

/** Modelle, die mit diesem Schlüssel wirklich verfügbar sind (Bild-Eingabe + generateContent). */
export async function listGeminiModels(key: string): Promise<GeminiModel[]> {
  const res = await fetch(`${GEMINI}/models?pageSize=200&key=${encodeURIComponent(key)}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new AiError(res.status === 400 || res.status === 403 ? 'Schlüssel ungültig' : data?.error?.message || `HTTP ${res.status}`, res.status);
  return ((data?.models || []) as Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>)
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/i.test(m.name) && !/(embedding|tts|image-generation|audio|live)/i.test(m.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }));
}

/** Versionsnummer aus dem Modellnamen ("gemini-3.5-flash-lite" -> 3.5). */
const version = (id: string) => Number((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);

/** Sinnvolle Kette aus der Modell-Liste: neueste Flash-Lite-Modelle, dann ein Flash für schwierige Fälle. */
export function suggestChain(models: GeminiModel[]): string[] {
  const stable = models.filter((m) => !/(preview|exp|thinking)/i.test(m.id));
  const pool = stable.length ? stable : models;
  const lite = pool.filter((m) => /flash-lite/i.test(m.id)).sort((a, b) => version(b.id) - version(a.id));
  const flash = pool.filter((m) => /flash/i.test(m.id) && !/lite/i.test(m.id)).sort((a, b) => version(b.id) - version(a.id));
  return [...lite.slice(0, 2), ...flash.slice(0, 1)].map((m) => m.id);
}

async function geminiOnce(key: string, model: string, jpegB64: string, timeout = 30000): Promise<AiCardRead> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: jpegB64 } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 300 },
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new AiError(data?.error?.message || `HTTP ${res.status}`, res.status);
    const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
    const out = parse(text);
    if (!out) throw new AiError('KI-Antwort nicht lesbar', 0);
    return { ...out, model };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new AiError('KI antwortet nicht (Zeitüberschreitung)', 408);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parse(text: unknown): Omit<AiCardRead, 'model'> | null {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const str = (v: unknown) => (v == null ? '' : String(v).trim());
  const lang = str(d.language).toLowerCase().slice(0, 2);
  const conf = Number(d.confidence);
  return {
    region: d.region === 'ja' || d.region === 'intl' ? d.region : lang === 'ja' ? 'ja' : null,
    language: LANGS.includes(lang) ? lang : null,
    name: str(d.name).slice(0, 80),
    setCode: str(d.set_code ?? d.setCode).slice(0, 12),
    number: str(d.number).replace(/\s+/g, '').slice(0, 20),
    variant: str(d.variant).slice(0, 20),
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
  };
}

// ---------- Kette ----------

export interface AiConfig {
  geminiKey: string;
  geminiModels: string[];
  geminiLimits: Record<string, number>;
}

export const aiAvailable = (c: AiConfig) => !!c.geminiKey && c.geminiModels.length > 0;

/** Karte lesen lassen; springt bei Limit (429) oder vollem Tageszähler zum nächsten Modell der Kette. */
export async function readCardAI(jpegB64: string, c: AiConfig): Promise<AiCardRead> {
  if (!c.geminiKey) throw new AiError('Kein Schlüssel', 401);
  let last: unknown = new AiError('Alle Modelle haben ihr Tageslimit erreicht', 429);
  for (const model of c.geminiModels) {
    const u = await usageToday(model);
    const limit = c.geminiLimits[model] ?? defaultLimit(model);
    if (u.exhausted || u.count >= limit) continue;
    try {
      const out = await geminiOnce(c.geminiKey, model, jpegB64);
      await bump(model);
      return out;
    } catch (err) {
      last = err;
      const status = (err as AiError).status;
      if (status === 429) {
        await bump(model, true);
        continue;
      }
      if (status === 404) continue; // Modell gibt es (nicht mehr)
      throw err;
    }
  }
  throw last;
}

/** Testaufruf beim Einrichten: Modell-Liste abrufen (prüft den Schlüssel, kostet kein Kontingent). */
export async function testGeminiKey(key: string) {
  const models = await listGeminiModels(key);
  return { models, chain: suggestChain(models) };
}
