// Einen Posten bearbeiten: Menge, Zustand, Kaufpreis, Herkunft, Kaufdatum, Notiz, Preisalarm, löschen.

import { useEffect, useState } from 'react';
import { Sheet } from '../Sheet';
import { MoneyInput } from '../MoneyInput';
import { ConditionBar } from '../ConditionBar';
import { Icon } from '../Icon';
import type { CollectionItem, Origin } from '../../db/schema';
import { removePost, updatePost } from '../../domain/collection';
import { toast } from '../../state/ui';

const ORIGINS: Array<[Origin, string]> = [
  ['kauf', 'Kauf'],
  ['booster', 'Booster'],
  ['tausch', 'Tausch'],
  ['geschenk', 'Geschenk'],
];

export function PostEditor({ item, onClose }: { item: CollectionItem | null; onClose: () => void }) {
  const [draft, setDraft] = useState<CollectionItem | null>(item);
  useEffect(() => setDraft(item), [item]);
  if (!draft)
    return (
      <Sheet open={false} title="" onClose={onClose}>
        {null}
      </Sheet>
    );

  const set = (patch: Partial<CollectionItem>) => setDraft({ ...draft, ...patch });
  const save = async () => {
    const { id, ...rest } = draft;
    await updatePost(id, rest);
    toast({ text: 'Gespeichert', tone: 'gain', ms: 1500 });
    onClose();
  };
  const remove = async () => {
    const undo = await removePost(draft.id);
    onClose();
    toast({ text: `${draft.name} entfernt`, action: { label: 'Rückgängig', run: undo } });
  };
  const paidDate = draft.paidAt ? new Date(draft.paidAt).toISOString().slice(0, 10) : '';

  return (
    <Sheet open={!!item} title={draft.list === 'wish' ? 'Merkliste' : 'Posten bearbeiten'} onClose={onClose}>
      <div className="stack">
        <div className="spread">
          <span className="label">Menge</span>
          <div className="stepper">
            <button
              className="icon-btn"
              aria-label="Eine weniger"
              onClick={() => set({ qty: Math.max(1, draft.qty - 1) })}
            >
              <Icon name="minus" />
            </button>
            <output className="num" aria-live="polite">
              {draft.qty}
            </output>
            <button className="icon-btn" aria-label="Eine mehr" onClick={() => set({ qty: draft.qty + 1 })}>
              <Icon name="plus" />
            </button>
          </div>
        </div>
        <ConditionBar value={draft.condition} onChange={(condition) => set({ condition })} />
        {draft.list === 'collection' ? (
          <>
            <MoneyInput
              label="Kaufpreis pro Karte"
              value={draft.pricePaidCents}
              onChange={(c) => set({ pricePaidCents: c, origin: draft.origin ?? (c != null ? 'kauf' : null) })}
            />
            <div className="scroll-x" role="group" aria-label="Herkunft">
              {ORIGINS.map(([o, label]) => (
                <button
                  key={o}
                  className="chip"
                  aria-pressed={draft.origin === o}
                  onClick={() =>
                    set({
                      origin: draft.origin === o ? null : o,
                      ...(o === 'tausch' || o === 'geschenk' ? { pricePaidCents: 0 } : {}),
                    })
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Kaufdatum</span>
              <input
                className="input"
                type="date"
                value={paidDate}
                onChange={(e) => set({ paidAt: e.target.value ? new Date(e.target.value).getTime() : null })}
              />
            </label>
          </>
        ) : (
          <MoneyInput
            label="Preisalarm bei höchstens"
            value={draft.targetCents}
            onChange={(c) => set({ targetCents: c, alarmedAt: null })}
          />
        )}
        <label className="field">
          <span>Notiz</span>
          <textarea
            className="input"
            value={draft.note}
            maxLength={500}
            onChange={(e) => set({ note: e.target.value })}
          />
        </label>
        <button className="btn btn-primary btn-block" onClick={save}>
          Speichern
        </button>
        {draft.list === 'wish' && (
          <button
            className="btn btn-block"
            onClick={() =>
              updatePost(draft.id, {
                list: 'collection',
                createdAt: Date.now(),
                addedPriceCents: draft.priceCents,
              }).then(onClose)
            }
          >
            In die Sammlung verschieben
          </button>
        )}
        <button className="btn btn-danger btn-block" onClick={remove}>
          <Icon name="trash" /> Entfernen
        </button>
      </div>
    </Sheet>
  );
}
