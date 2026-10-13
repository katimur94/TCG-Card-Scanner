// „Was hast du bezahlt?“ – großes Zahlenfeld mit Schnellwahl Booster / Getauscht / Geschenkt.

import { useEffect, useState } from 'react';
import { Sheet } from '../Sheet';
import { MoneyInput } from '../MoneyInput';
import type { Origin } from '../../db/schema';
import { cents } from '../../lib/util';

export interface Purchase {
  pricePaidCents: number | null;
  origin: Origin | null;
}

export function PurchaseSheet({
  open,
  onClose,
  onSave,
  initialCents = null,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (p: Purchase) => void;
  initialCents?: number | null;
}) {
  const [price, setPrice] = useState<number | null>(initialCents);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [pack, setPack] = useState<number | null>(null);
  const [perPack, setPerPack] = useState('10');

  useEffect(() => {
    if (open) {
      setPrice(initialCents);
      setOrigin(null);
      setPack(null);
    }
  }, [open, initialCents]);

  const n = Math.max(1, parseInt(perPack, 10) || 1);
  const boosterShare = pack != null ? Math.round(pack / n) : null;

  const save = (p: Purchase) => {
    onSave(p);
    onClose();
  };

  return (
    <Sheet open={open} title="Was hast du bezahlt?" onClose={onClose}>
      <div className="stack">
        <MoneyInput
          big
          label="Preis pro Karte"
          value={origin === 'booster' ? boosterShare : price}
          onChange={(c) => (setPrice(c), setOrigin(c == null ? origin : 'kauf'))}
          autoFocus
        />
        <div className="scroll-x" role="group" aria-label="Herkunft">
          <button
            className="chip"
            aria-pressed={origin === 'booster'}
            onClick={() => setOrigin(origin === 'booster' ? null : 'booster')}
          >
            Aus Booster gezogen
          </button>
          <button
            className="chip"
            aria-pressed={origin === 'tausch'}
            onClick={() => save({ pricePaidCents: 0, origin: 'tausch' })}
          >
            Getauscht
          </button>
          <button
            className="chip"
            aria-pressed={origin === 'geschenk'}
            onClick={() => save({ pricePaidCents: 0, origin: 'geschenk' })}
          >
            Geschenkt
          </button>
        </div>
        {origin === 'booster' && (
          <div className="panel stack">
            <p className="muted" style={{ margin: 0 }}>
              Optional: Packpreis ÷ Karten pro Pack
            </p>
            <div className="row" style={{ alignItems: 'end' }}>
              <MoneyInput label="Packpreis" value={pack} onChange={setPack} />
              <label className="field" style={{ width: 110 }}>
                <span>Karten</span>
                <input
                  className="input num"
                  inputMode="numeric"
                  value={perPack}
                  onChange={(e) => setPerPack(e.target.value)}
                />
              </label>
            </div>
            {boosterShare != null && (
              <p className="num" style={{ margin: 0 }}>
                = {cents(boosterShare)} pro Karte
              </p>
            )}
          </div>
        )}
        <button
          className="btn btn-primary btn-block"
          onClick={() =>
            save(
              origin === 'booster'
                ? { pricePaidCents: boosterShare ?? 0, origin: 'booster' }
                : { pricePaidCents: price, origin: price != null ? 'kauf' : null },
            )
          }
        >
          Speichern
        </button>
        <button className="btn btn-ghost btn-block" onClick={() => save({ pricePaidCents: null, origin: null })}>
          Ohne Preis speichern
        </button>
      </div>
    </Sheet>
  );
}
