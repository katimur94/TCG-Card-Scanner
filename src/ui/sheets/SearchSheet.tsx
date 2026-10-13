// Suche nach Name, Set oder Nummer (z. B. „Glurak“, „123/165“, „MEW 25“) – offline über den Kartenindex.

import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../Sheet';
import { useUi } from '../../state/ui';
import { useSettings } from '../../state/settings';
import { searchCards, type SearchHit } from '../../lib/identify';
import { guessImageBase, imageUrl } from '../../lib/api';
import { LANGS, langInfo } from '../../lib/lang';
import { FallbackImg } from '../card/Card';

const HINTS = ['Glurak', 'Pikachu', 'MEW 25', '4/102', 'Mewtu ex'];

export function SearchSheet() {
  const open = useUi((s) => s.sheet === 'search');
  const openSheet = useUi((s) => s.openSheet);
  const openCard = useUi((s) => s.openCard);
  const { settings, update } = useSettings();
  const lang = settings.searchLang;
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      return;
    }
    const n = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      searchCards(query, lang)
        .then((r) => n === seq.current && (setHits(r), setErr(null)))
        .catch(() => n === seq.current && setErr('Kartenindex konnte nicht geladen werden.'))
        .finally(() => n === seq.current && setBusy(false));
    }, 180);
    return () => clearTimeout(t);
  }, [q, lang]);

  const cycleLang = () => {
    const i = LANGS.findIndex((l) => l.code === lang);
    update({ searchLang: LANGS[(i + 1) % LANGS.length].code });
  };

  return (
    <Sheet open={open} title="Karte suchen" onClose={() => openSheet(null)} full>
      <div className="stack">
        <div className="search-bar">
          <input
            className="input"
            type="search"
            inputMode="search"
            autoComplete="off"
            aria-label="Name, Set oder Nummer"
            placeholder="Name, Set oder Nummer – z. B. 123/165"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            className="chip"
            onClick={cycleLang}
            aria-label={`Suchsprache: ${langInfo(lang).label}. Tippen zum Wechseln`}
          >
            {langInfo(lang).flag} {langInfo(lang).short}
          </button>
        </div>
        {q.trim().length < 2 && (
          <div className="scroll-x">
            {HINTS.map((h) => (
              <button key={h} className="chip" onClick={() => setQ(h)}>
                {h}
              </button>
            ))}
          </div>
        )}
        {err && <p className="loss">{err}</p>}
        {busy && hits.length === 0 && <p className="faint">Suche …</p>}
        {!busy && q.trim().length >= 2 && hits.length === 0 && !err && (
          <p className="faint">Nichts gefunden. Andere Sprache oder Schreibweise probieren.</p>
        )}
        <ul className="results">
          {hits.map((h) => {
            const base = guessImageBase(lang === 'ja' ? 'ja' : lang, h.set, h.localId);
            const en = h.group === 'intl' ? guessImageBase('en', h.set, h.localId) : null;
            return (
              <li key={`${h.group}:${h.id}`}>
                <button
                  className="result"
                  onClick={() => {
                    openSheet(null);
                    openCard({
                      ref: {
                        region: h.group,
                        setId: h.setId,
                        localId: h.localId,
                        id: h.id,
                        lang: h.group === 'ja' ? 'ja' : lang,
                        name: h.name,
                        set: h.set,
                      },
                    });
                  }}
                >
                  <div className="result-img">
                    <FallbackImg
                      sources={[imageUrl(base, 'low'), imageUrl(en, 'low')].filter((x): x is string => !!x)}
                      alt={h.name}
                    />
                  </div>
                  <span className="result-name">{h.name}</span>
                  <span className="faint small">
                    {h.set?.nl?.[lang] || h.set?.n || h.setId} ·{' '}
                    <span className="num">
                      {h.localId}
                      {h.set?.o ? `/${h.set.o}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}
