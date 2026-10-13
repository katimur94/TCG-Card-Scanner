// Depot: Gesamtwert, investiert, Gewinn, Wertverlauf, Top 5 / Flop 5 seit Kauf, Karten ohne Preis.

import { Sheet } from '../Sheet';
import { useDepot } from '../../state/hooks';
import { useUi } from '../../state/ui';
import { LineChart } from '../LineChart';
import { cents, change } from '../../lib/util';
import type { CollectionItem } from '../../db/schema';

export function DepotSheet() {
  const open = useUi((s) => s.sheet === 'depot');
  const openSheet = useUi((s) => s.openSheet);
  const openCard = useUi((s) => s.openCard);
  const { depot, history, day } = useDepot();
  const show = (it: CollectionItem) => {
    openSheet(null);
    openCard({
      ref: { region: it.region, setId: it.setId, localId: it.localId, id: it.cardId, lang: it.lang, name: it.name },
    });
  };
  const list = (rows: typeof depot.top, tone: 'gain' | 'loss') =>
    rows.length ? (
      <ol className="perf">
        {rows.map((r) => (
          <li key={r.item.id}>
            <button onClick={() => show(r.item)}>
              <span>{r.item.name}</span>
              <span className={`num ${tone}`}>
                {r.delta >= 0 ? '+' : '−'}
                {cents(Math.abs(r.delta))} · {change(r.ratio)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    ) : (
      <p className="faint small">Noch keine Karten mit Kaufpreis oder Vergleichswert.</p>
    );

  return (
    <Sheet open={open} title="Depot" onClose={() => openSheet(null)} full>
      <div className="stack">
        <div className="panel">
          <div className="faint small">Gesamtwert (Trendpreis × Menge, Zustand berücksichtigt)</div>
          <div className="num price-big">{cents(depot.valueCents)}</div>
          {day != null && <div className={`num ${day >= 0 ? 'gain' : 'loss'}`}>{change(day)} seit gestern</div>}
          <dl className="kv num">
            <div>
              <dt>Investiert</dt>
              <dd>{cents(depot.investedCents)}</dd>
            </div>
            <div>
              <dt>Heutiger Wert davon</dt>
              <dd>{cents(depot.investedValueCents)}</dd>
            </div>
            <div>
              <dt>Gewinn</dt>
              <dd className={depot.gainCents >= 0 ? 'gain' : 'loss'}>
                {depot.gainCents >= 0 ? '+' : '−'}
                {cents(Math.abs(depot.gainCents))} {depot.gainRatio != null ? change(depot.gainRatio) : ''}
              </dd>
            </div>
            <div>
              <dt>Karten</dt>
              <dd>{depot.cards}</dd>
            </div>
          </dl>
          {depot.unpriced > 0 && (
            <p className="faint small">{depot.unpriced} Karte(n) ohne Preis – nicht als 0 € gewertet.</p>
          )}
        </div>
        <section className="panel stack">
          <h3 className="h-sm">Wertverlauf</h3>
          <LineChart points={history} height={140} label="Wertverlauf der Sammlung" />
        </section>
        <section className="panel stack">
          <h3 className="h-sm">
            <span className="gain">▲</span> Top 5 seit Kauf
          </h3>
          {list(depot.top, 'gain')}
        </section>
        <section className="panel stack">
          <h3 className="h-sm">
            <span className="loss">▼</span> Flop 5 seit Kauf
          </h3>
          {list(depot.flop, 'loss')}
        </section>
        <p className="faint small">
          Gewinn bezieht sich auf Karten mit Kaufpreis. Ohne Kaufpreis vergleicht der Binder mit dem Wert beim
          Hinzufügen.
        </p>
      </div>
    </Sheet>
  );
}
