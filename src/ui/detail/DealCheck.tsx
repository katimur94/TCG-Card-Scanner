// Kauf-Check: Angebotspreis eingeben -> Urteil, Ersparnis, Gewinn beim Weiterverkauf, Investment-Einschätzung.

import { useMemo, useState } from 'react';
import { MoneyInput } from '../MoneyInput';
import { evaluateBuy, evaluateInvestment, verdictSummary, SELL_FEE, PACKAGING } from '../../lib/deal';
import type { PriceFields } from '../../lib/pricing';
import { money } from '../../lib/util';
import type { Point } from '../LineChart';

export function DealCheck({
  cm,
  condition,
  rarity,
  setDate,
  reverse,
  series,
  onAsk,
}: {
  cm: PriceFields | null;
  condition: number;
  rarity: string | null;
  setDate: string | null;
  reverse: boolean;
  series: Point[];
  onAsk?: (cents: number | null) => void;
}) {
  const [ask, setAsk] = useState<number | null>(null);
  const buy = ask ? evaluateBuy(ask / 100, cm, condition) : null;
  const inv = useMemo(
    () =>
      evaluateInvestment({
        cm,
        market: buy?.market ?? cm?.value ?? null,
        rarity: rarity || undefined,
        setDate,
        reverse,
        history: series.map((p) => ({ d: p.d, v: p.c / 100 })),
      }),
    [cm, buy?.market, rarity, setDate, reverse, series],
  );
  if (!cm?.value) return null;
  return (
    <section className="panel stack" aria-labelledby="deal-h">
      <h3 id="deal-h" className="h-sm">
        Kauf-Check
      </h3>
      <MoneyInput
        label="Angebotspreis (z. B. Flohmarkt)"
        value={ask}
        onChange={(c) => {
          setAsk(c);
          onAsk?.(c);
        }}
      />
      {buy && (
        <div className={`deal deal-${buy.tier.key}`}>
          <div className="spread">
            <b>{buy.tier.label}</b>
            <span className="num">
              {Math.round(buy.ratio * 100)} % vom Wert ({money(buy.market)})
            </span>
          </div>
          <p className="muted">{buy.tier.text}</p>
          <dl className="kv num">
            <div>
              <dt>{buy.diff >= 0 ? 'Ersparnis' : 'Aufpreis'}</dt>
              <dd className={buy.diff >= 0 ? 'gain' : 'loss'}>{money(Math.abs(buy.diff))}</dd>
            </div>
            <div>
              <dt>Weiterverkauf netto</dt>
              <dd>{money(buy.net)}</dd>
            </div>
            <div>
              <dt>Möglicher Gewinn</dt>
              <dd className={buy.profit >= 0 ? 'gain' : 'loss'}>
                {buy.profit >= 0 ? '▲ ' : '▼ '}
                {money(Math.abs(buy.profit))}
              </dd>
            </div>
            <div>
              <dt>Guter Kauf ab</dt>
              <dd>{money(buy.targetGood)}</dd>
            </div>
          </dl>
          {buy.notes.map((n) => (
            <p key={n} className="faint small">
              {n}
            </p>
          ))}
          <p>
            <b>{verdictSummary(buy, inv)}</b>
          </p>
        </div>
      )}
      <details className="inv">
        <summary>
          Investment: <b>{inv.label}</b> <span className="num faint">({inv.score}/100)</span>
        </summary>
        <ul>
          {inv.reasons.map((r) => (
            <li key={r.text} className={r.sign > 0 ? 'gain' : r.sign < 0 ? 'loss' : 'muted'}>
              {r.sign > 0 ? '▲' : r.sign < 0 ? '▼' : '■'} <span style={{ color: 'var(--text-2)' }}>{r.text}</span>
            </li>
          ))}
        </ul>
        <p className="faint small">
          Weiterverkauf nach {Math.round(SELL_FEE * 100)} % Cardmarket-Provision und {money(PACKAGING)} Verpackung.
          Richtwerte, keine Anlageberatung.
        </p>
      </details>
    </section>
  );
}
