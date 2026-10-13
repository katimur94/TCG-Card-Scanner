// Der Stapel unten im Scanner: gefächerte Karten, Anzahl, Fortschritt der Warteschlange. Tippen öffnet die Triage.

import { AnimatePresence, motion } from 'framer-motion';
import { useStack, type StackEntry } from '../../state/stack';
import { FallbackImg } from '../card/Card';
import { useBlobUrl, useThumbs } from './useThumb';

function Mini({ e, i, n }: { e: StackEntry; i: number; n: number }) {
  const thumbs = useThumbs(e.status === 'sure' ? e.best : null, e.lang);
  const photo = useBlobUrl(e.photo);
  const k = n - 1 - i; // 0 = oberste Karte
  return (
    <motion.div
      className="stack-card"
      layout
      initial={{ y: -260, scale: 1.6, opacity: 0, rotate: -8 }}
      animate={{ y: -k * 3, x: (k - 1) * 9, rotate: (k - 1) * 7, scale: 1 - k * 0.04, opacity: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      style={{ zIndex: 10 - k }}
    >
      <FallbackImg sources={[...thumbs, photo].filter((x): x is string => !!x)} alt={e.best?.name || 'Karte'} />
      {e.status !== 'sure' && <span className="stack-ask" aria-hidden>?</span>}
    </motion.div>
  );
}

export function Stack({ onOpen }: { onOpen: () => void }) {
  const entries = useStack((s) => s.entries);
  const working = useStack((s) => s.working);
  const queue = useStack((s) => s.queue);
  const top = entries.slice(-3);
  const ask = entries.filter((e) => e.status !== 'sure').length;
  const label = entries.length
    ? `Stapel: ${entries.length} Karte(n)${ask ? `, ${ask} zum Prüfen` : ''}${working ? `, ${working.label}` : ''}. Sortieren`
    : working
      ? working.label
      : 'Stapel leer';
  return (
    <button className="stack" onClick={onOpen} disabled={!entries.length} aria-label={label}>
      <div className="stack-fan">
        <AnimatePresence>
          {top.map((e, i) => (
            <Mini key={e.id} e={e} i={i} n={top.length} />
          ))}
        </AnimatePresence>
        {!entries.length && <div className="stack-empty" aria-hidden />}
      </div>
      {entries.length > 0 && <span className="stack-count num">{entries.length}</span>}
      {(working || queue.length > 0) && (
        <span className="stack-progress" aria-hidden>
          <svg viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" />
            <circle
              cx="18"
              cy="18"
              r="15"
              className="stack-progress-bar"
              style={{ strokeDasharray: `${working && working.total ? (94 * (working.done + 0.5)) / working.total : 20} 94` }}
            />
          </svg>
        </span>
      )}
    </button>
  );
}
