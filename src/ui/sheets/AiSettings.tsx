// KI-Leser einrichten: Gemini-Schlüssel (nur auf dem Gerät), Test über die Modell-Liste, Modell-Kette,
// Tageszähler je Modell mit änderbaren Limits.

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSettings } from '../../state/settings';
import { db } from '../../db/schema';
import { dayPacific, defaultLimit, testGeminiKey, type GeminiModel } from '../../ai/client';
import { toast } from '../../state/ui';
import { Icon } from '../Icon';

export function AiSettings() {
  const { settings, update } = useSettings();
  const [key, setKey] = useState(settings.geminiKey);
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<GeminiModel[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => setKey(settings.geminiKey), [settings.geminiKey]);

  const usage = useLiveQuery(() => db.ai_usage.where('dayPacific').equals(dayPacific()).toArray(), [], []) ?? [];
  const count = (m: string) => usage.find((u) => u.model === m)?.count ?? 0;
  const full = (m: string) => {
    const u = usage.find((x) => x.model === m);
    return !!u?.exhaustedUntil && u.exhaustedUntil > Date.now();
  };

  const test = async () => {
    const k = key.trim();
    if (!k) return;
    setTesting(true);
    setStatus(null);
    try {
      const { models: list, chain } = await testGeminiKey(k);
      setModels(list);
      const keep = settings.geminiModels.filter((m) => list.some((x) => x.id === m));
      await update({ geminiKey: k, geminiModels: keep.length ? keep : chain });
      setStatus(`Key funktioniert – ${list.length} Modelle verfügbar.`);
    } catch (e) {
      setStatus(`Fehler: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const toggle = (id: string) => {
    const on = settings.geminiModels.includes(id);
    void update({ geminiModels: on ? settings.geminiModels.filter((m) => m !== id) : [...settings.geminiModels, id] });
  };
  const move = (id: string, d: number) => {
    const list = [...settings.geminiModels];
    const i = list.indexOf(id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    void update({ geminiModels: list });
  };

  return (
    <section className="panel stack" aria-labelledby="ai-h">
      <h3 id="ai-h" className="h-sm">
        KI-Leser (optional)
      </h3>
      <p className="faint small" style={{ margin: 0 }}>
        Nur der Notfall: Wenn die Erkennung auf dem Gerät unsicher bleibt, liest Gemini den Kartenausschnitt. Das Ergebnis wird immer gegen den
        Kartenkatalog geprüft. Kostenlosen Schlüssel holen unter{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
          aistudio.google.com/apikey
        </a>
        .
      </p>
      <label className="field">
        <span>Gemini-API-Schlüssel (bleibt nur auf diesem Gerät)</span>
        <div className="row">
          <input
            className="input"
            type={show ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            value={key}
            placeholder="AIza…"
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Schlüssel verbergen' : 'Schlüssel zeigen'} aria-pressed={show}>
            <Icon name="key" />
          </button>
        </div>
      </label>
      <div className="row wrap">
        <button className="btn btn-sm btn-primary" onClick={test} disabled={testing || !key.trim()}>
          {testing ? 'Prüfe …' : 'Speichern & testen'}
        </button>
        {settings.geminiKey && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setKey('');
              setModels(null);
              void update({ geminiKey: '', geminiModels: [] });
              toast({ text: 'Schlüssel entfernt' });
            }}
          >
            Entfernen
          </button>
        )}
      </div>
      {status && (
        <p className={`small ${status.startsWith('Fehler') ? 'loss' : 'gain'}`} role="status" style={{ margin: 0 }}>
          {status}
        </p>
      )}

      {settings.geminiKey && (
        <div className="stack">
          <span className="label">Modell-Kette (von oben nach unten; bei Limit springt sie zum nächsten)</span>
          <ul className="chain">
            {settings.geminiModels.map((m, i) => {
              const limit = settings.geminiLimits[m] ?? defaultLimit(m);
              return (
                <li key={m}>
                  <span className="num">{i + 1}.</span>
                  <span className="chain-name">{m}</span>
                  <span className={`num small ${full(m) || count(m) >= limit ? 'loss' : 'muted'}`}>
                    Heute: {count(m)} /{' '}
                    <input
                      className="limit"
                      inputMode="numeric"
                      aria-label={`Tageslimit für ${m}`}
                      value={limit}
                      onChange={(e) => update({ geminiLimits: { ...settings.geminiLimits, [m]: Math.max(0, parseInt(e.target.value, 10) || 0) } })}
                    />
                    {full(m) ? ' · voll' : ''}
                  </span>
                  <span className="row">
                    <button className="icon-btn" aria-label="nach oben" onClick={() => move(m, -1)} disabled={i === 0}>
                      <Icon name="chevronUp" size={16} />
                    </button>
                    <button className="icon-btn" aria-label="entfernen" onClick={() => toggle(m)}>
                      <Icon name="close" size={16} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {models && (
            <details>
              <summary className="small">Weitere verfügbare Modelle</summary>
              <div className="row wrap" style={{ marginTop: 8 }}>
                {models
                  .filter((m) => !settings.geminiModels.includes(m.id))
                  .map((m) => (
                    <button key={m.id} className="chip" onClick={() => toggle(m.id)}>
                      + {m.id}
                    </button>
                  ))}
              </div>
            </details>
          )}
          <p className="faint small" style={{ margin: 0 }}>
            Google zeigt die Restmenge nicht an – HoloScan zählt selbst mit (Neustart täglich um 9 Uhr deutscher Zeit).{' '}
            <a href="https://ai.google.dev/gemini-api/docs/rate-limits" target="_blank" rel="noopener noreferrer">
              Genaue Limits bei Google ansehen
            </a>
            . Im kostenlosen Tarif darf Google Eingaben zur Produktverbesserung nutzen; HoloScan schickt nur den Kartenausschnitt.
          </p>
        </div>
      )}

    </section>
  );
}
