// Depot-Leiste: Gesamtwert, investiert, Gewinn in € und %. Tippen öffnet das Depot.

import type { Depot } from '../../domain/valuation';
import { cents, change } from '../../lib/util';
import { LineChart } from '../LineChart';

export function DepotBar({
  depot,
  day,
  history,
  onOpen,
}: {
  depot: Depot;
  day: number | null;
  history: Array<{ d: string; c: number }>;
  onOpen: () => void;
}) {
  const gainTone = depot.gainCents > 0 ? 'gain' : depot.gainCents < 0 ? 'loss' : '';
  return (
    <button className="depot-bar" onClick={onOpen} aria-label="Depot öffnen">
      <div className="depot-main">
        <span className="faint small">Sammlungswert</span>
        <span className="num depot-value">{cents(depot.valueCents)}</span>
        {day != null && <span className={`num small ${day >= 0 ? 'gain' : 'loss'}`}>{change(day)} heute</span>}
      </div>
      <dl className="depot-kv num">
        <div>
          <dt>Investiert</dt>
          <dd>{cents(depot.investedCents)}</dd>
        </div>
        <div>
          <dt>Gewinn</dt>
          <dd className={gainTone}>
            {depot.gainCents >= 0 ? '+' : '−'}
            {cents(Math.abs(depot.gainCents))} <small>{depot.gainRatio != null ? change(depot.gainRatio) : ''}</small>
          </dd>
        </div>
      </dl>
      {history.length >= 2 && (
        <div className="depot-spark">
          <LineChart points={history.slice(-60)} height={34} label="Wertverlauf" compact />
        </div>
      )}
    </button>
  );
}
