// Kurszettel (Rückseite der Karte): Trendpreis groß, Kursverlauf, 1/7/30-Tage-Schnitt, Tiefstpreis,
// dein Einstand und dein Gewinn. Nur Anzeige – Bedienelemente liegen außerhalb der Karte.

import { LineChart, type Point } from '../LineChart';
import { money, cents, change, date } from '../../lib/util';
import type { PriceFields } from '../../lib/pricing';

export interface SlipProps {
  name: string;
  variantLabel: string;
  cm: PriceFields | null;
  series: Point[];
  costCents?: number | null; // Einstand pro Stück
  valueCents?: number | null; // heutiger Wert pro Stück im Zustand
  qty?: number;
}

export function PriceSlip({ name, variantLabel, cm, series, costCents, valueCents, qty = 1 }: SlipProps) {
  const gain = costCents != null && valueCents != null ? (valueCents - costCents) * qty : null;
  const ratio = costCents && valueCents != null ? (valueCents - costCents) / costCents : null;
  return (
    <div className="slip">
      <div className="slip-head">
        <div className="slip-name">{name}</div>
        <div className="slip-sub faint">{variantLabel || 'Standard'}</div>
      </div>
      <div className="slip-main">
        <div className="faint slip-k">{cm?.valueLabel || 'Preistrend'}</div>
        <div className="slip-price num">{money(cm?.value)}</div>
      </div>
      <LineChart points={series} height={64} label="Kursverlauf" compact />
      <dl className="slip-grid num">
        <div>
          <dt>Ø 1 T</dt>
          <dd>{money(cm?.avg1)}</dd>
        </div>
        <div>
          <dt>Ø 7 T</dt>
          <dd>{money(cm?.avg7)}</dd>
        </div>
        <div>
          <dt>Ø 30 T</dt>
          <dd>{money(cm?.avg30)}</dd>
        </div>
        <div>
          <dt>Ab</dt>
          <dd>{money(cm?.low)}</dd>
        </div>
      </dl>
      {costCents != null && (
        <dl className="slip-grid slip-own num">
          <div>
            <dt>Einstand</dt>
            <dd>{cents(costCents)}</dd>
          </div>
          <div>
            <dt>Gewinn</dt>
            <dd className={gain == null ? '' : gain >= 0 ? 'gain' : 'loss'}>
              {gain == null ? '–' : `${gain >= 0 ? '+' : '−'}${cents(Math.abs(gain))}`}
              {ratio != null && <small> {change(ratio)}</small>}
            </dd>
          </div>
        </dl>
      )}
      <div className="slip-foot faint">
        Cardmarket-Preis-Guide{cm?.updated ? ` · Stand ${date(cm.updated)}` : ''}
        {cm?.source === 'cardmarket' ? ' · zugeordnet' : ''}
      </div>
    </div>
  );
}
