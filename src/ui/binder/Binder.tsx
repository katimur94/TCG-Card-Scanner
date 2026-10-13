// Ort „Binder“: Album mit 3×3-Taschen, seitlich blättern. Oben die Depot-Leiste.
// Zurück zum Scanner: nach unten wischen (Kopfbereich) oder Knopf.

import { motion, useDragControls, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useUi } from '../../state/ui';
import { useDepot } from '../../state/hooks';
import {
  filterPockets,
  pages,
  pocketsOf,
  sortPockets,
  type BinderFilter,
  type Pocket,
  type SortKey,
} from '../../domain/binder';
import { DepotBar } from './DepotBar';
import { PocketTile } from './PocketTile';
import { Icon } from '../Icon';
import { LANGS } from '../../lib/lang';
import type { ListKind } from '../../db/schema';

const SORTS: Array<[SortKey, string]> = [
  ['value', 'Wert'],
  ['gain', 'Gewinn'],
  ['set', 'Set'],
  ['added', 'Zuletzt hinzugefügt'],
];

export function Binder() {
  const open = useUi((s) => s.binderOpen);
  const setBinder = useUi((s) => s.setBinder);
  const drag = useDragControls();
  return (
    <AnimatePresence>
      {open && (
        <motion.section
          className="binder"
          aria-label="Binder"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 260, damping: 32 }}
          drag="y"
          dragListener={false}
          dragControls={drag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.7 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 110 || info.velocity.y > 700) setBinder(false);
          }}
        >
          <div className="binder-grip" onPointerDown={(e) => drag.start(e)}>
            <span className="sheet-grip" aria-hidden />
          </div>
          <BinderBody onClose={() => setBinder(false)} startDrag={(e) => drag.start(e)} />
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function BinderBody({ onClose, startDrag }: { onClose: () => void; startDrag: (e: React.PointerEvent) => void }) {
  const { items, depot, history, day } = useDepot();
  const openSheet = useUi((s) => s.openSheet);
  const [filter, setFilter] = useState<BinderFilter>({
    list: 'collection',
    query: '',
    lang: null,
    setId: null,
    rarity: null,
    trend: null,
  });
  const [sort, setSort] = useState<SortKey>('value');
  const [page, setPage] = useState(0);
  const [showFilter, setShowFilter] = useState(false);

  const all = useMemo(() => pocketsOf(items, filter.list), [items, filter.list]);
  const shown = useMemo(() => sortPockets(filterPockets(all, filter), sort), [all, filter, sort]);
  const sheets = useMemo(() => pages(shown), [shown]);
  const setOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of all) m.set(p.first.setId, p.first.setName || p.first.setId);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);
  const rarityOptions = useMemo(
    () => [...new Set(all.map((p) => p.first.rarity).filter((r): r is string => !!r))].sort(),
    [all],
  );

  useEffect(() => setPage(0), [filter, sort]);
  const pageCount = sheets.length;
  const current = Math.min(page, pageCount - 1);
  const go = (d: number) => setPage((p) => Math.max(0, Math.min(pageCount - 1, p + d)));
  const set = (patch: Partial<BinderFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const filtersOn = !!(filter.lang || filter.setId || filter.rarity || filter.trend);

  return (
    <div className="binder-body">
      <header className="binder-head" onPointerDown={startDrag}>
        <button className="icon-btn" onClick={onClose} aria-label="Zum Scanner">
          <Icon name="chevronDown" />
        </button>
        <h1 className="binder-title">Binder</h1>
        <div className="row">
          <button className="icon-btn" onClick={() => openSheet('search')} aria-label="Karte suchen">
            <Icon name="search" />
          </button>
          <button className="icon-btn" onClick={() => openSheet('settings')} aria-label="Einstellungen">
            <Icon name="settings" />
          </button>
        </div>
      </header>

      <DepotBar depot={depot} day={day} history={history} onOpen={() => openSheet('depot')} />

      <div className="seg" role="tablist" aria-label="Liste">
        {(['collection', 'wish'] as ListKind[]).map((l) => (
          <button
            key={l}
            role="tab"
            aria-selected={filter.list === l}
            className={filter.list === l ? 'is-on' : ''}
            onClick={() => set({ list: l })}
          >
            {l === 'collection' ? 'Sammlung' : 'Merkliste'}{' '}
            <span className="num faint">{pocketsOf(items, l).reduce((a, p) => a + p.qty, 0)}</span>
          </button>
        ))}
      </div>

      <div className="binder-tools">
        <label className="search-mini">
          <Icon name="search" size={16} />
          <span className="visually-hidden">In der Sammlung suchen</span>
          <input
            type="search"
            placeholder="Name oder Nummer"
            value={filter.query}
            onChange={(e) => set({ query: e.target.value })}
          />
        </label>
        <label className="select-mini">
          <span className="visually-hidden">Sortieren nach</span>
          <Icon name="sort" size={16} />
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button
          className={`icon-btn ${filtersOn ? 'is-on' : ''}`}
          aria-pressed={showFilter}
          aria-label="Filter"
          onClick={() => setShowFilter(!showFilter)}
        >
          <Icon name="filter" />
        </button>
      </div>

      {showFilter && (
        <div className="binder-filters">
          <select
            className="input"
            value={filter.lang || ''}
            onChange={(e) => set({ lang: e.target.value || null })}
            aria-label="Sprache"
          >
            <option value="">Alle Sprachen</option>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.flag} {l.label}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={filter.setId || ''}
            onChange={(e) => set({ setId: e.target.value || null })}
            aria-label="Set"
          >
            <option value="">Alle Sets</option>
            {setOptions.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={filter.rarity || ''}
            onChange={(e) => set({ rarity: e.target.value || null })}
            aria-label="Seltenheit"
          >
            <option value="">Alle Seltenheiten</option>
            {rarityOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <div className="row">
            <button
              className="chip"
              aria-pressed={filter.trend === 'plus'}
              onClick={() => set({ trend: filter.trend === 'plus' ? null : 'plus' })}
            >
              <span className="gain">▲</span> Im Plus
            </button>
            <button
              className="chip"
              aria-pressed={filter.trend === 'minus'}
              onClick={() => set({ trend: filter.trend === 'minus' ? null : 'minus' })}
            >
              <span className="loss">▼</span> Im Minus
            </button>
          </div>
        </div>
      )}

      {all.length === 0 ? (
        <EmptyBinder list={filter.list} onClose={onClose} />
      ) : (
        <>
          <div className="binder-pages">
            <AnimatePresence initial={false} mode="popLayout" custom={current}>
              <motion.div
                key={current}
                className="binder-page"
                initial={{ opacity: 0, x: 60 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -60 }}
                transition={{ duration: 0.22 }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.35}
                onDragEnd={(_, info) => {
                  if (info.offset.x < -60) go(1);
                  else if (info.offset.x > 60) go(-1);
                }}
              >
                {Array.from({ length: 9 }, (_, i) => sheets[current]?.[i]).map((p: Pocket | undefined, i) =>
                  p ? (
                    <PocketTile key={p.key} pocket={p} />
                  ) : (
                    <div key={`e${i}`} className="pocket pocket-empty" aria-hidden />
                  ),
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          {shown.length === 0 && <p className="faint center">Keine Karte passt zum Filter.</p>}
          <nav className="binder-pager" aria-label="Seiten">
            <button className="icon-btn" onClick={() => go(-1)} disabled={current === 0} aria-label="Vorige Seite">
              <Icon name="back" />
            </button>
            <span className="num faint">
              Seite {current + 1} / {pageCount}
            </span>
            <button
              className="icon-btn"
              onClick={() => go(1)}
              disabled={current >= pageCount - 1}
              aria-label="Nächste Seite"
            >
              <Icon name="back" />
            </button>
          </nav>
        </>
      )}
    </div>
  );
}

function EmptyBinder({ list, onClose }: { list: ListKind; onClose: () => void }) {
  const openSheet = useUi((s) => s.openSheet);
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
      <p className="muted">
        {list === 'collection'
          ? 'Noch leer. Scanne eine Karte oder suche sie.'
          : 'Merke dir Karten, die du suchst – mit Preisalarm.'}
      </p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn btn-primary" onClick={onClose}>
          <Icon name="camera" /> Scannen
        </button>
        <button className="btn" onClick={() => openSheet('search')}>
          <Icon name="search" /> Suchen
        </button>
      </div>
    </div>
  );
}
