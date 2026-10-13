// Einen Posten bearbeiten: Menge, Zustand, Kaufpreis, Herkunft, Kaufdatum, Notiz, Preisalarm,
// als verkauft/verloren aus der Sammlung nehmen oder löschen.

import { useEffect, useState } from 'react';
import { Sheet } from '../Sheet';
import { MoneyInput } from '../MoneyInput';
import { ConditionBar } from '../ConditionBar';
import { Icon } from '../Icon';
import type { CollectionItem, Origin } from '../../db/schema';
import { disposePost, removePost, updatePost, type DisposalReason } from '../../domain/collection';
import { unitValueCents } from '../../domain/valuation';
import { cents } from '../../lib/util';
import { toast } from '../../state/ui';

const ORIGINS: Array<[Origin, string]> = [
  ['kauf', 'Kauf'],
  ['booster', 'Booster'],
  ['tausch', 'Tausch'],
  ['geschenk', 'Geschenk'],
];

export function PostEditor({ item, onClose }: { item: CollectionItem | null; onClose: () => void }) {
  const [draft, setDraft] = useState<CollectionItem | null>(item);
  const [leaving, setLeaving] = useState<DisposalReason | null>(null);
  const [leaveQty, setLeaveQty] = useState(1);
  const [soldCents, setSoldCents] = useState<number | null>(null);
  useEffect(() => {
    setDraft(item);
    setLeaving(null);
  }, [item]);
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
  const startLeave = (reason: DisposalReason) => {
    setLeaving(reason);
    setLeaveQty(draft.qty);
    setSoldCents(null);
  };
  const leave = async () => {
    if (!leaving) return;
    const n = Math.min(leaveQty, draft.qty);
    const undo = await disposePost(draft.id, { reason: leaving, qty: n, soldCents });
    onClose();
    const what = n > 1 ? `${n}× ${draft.name}` : draft.name;
    toast({
      text: leaving === 'sold' ? `${what} als verkauft vermerkt` : `${what} als verloren vermerkt`,
      action: { label: 'Rückgängig', run: undo },
    });
  };
  const paidDate = draft.paidAt ? new Date(draft.paidAt).toISOString().slice(0, 10) : '';

  if (leaving) {
    const unitValue = unitValueCents(draft);
    const n = Math.min(leaveQty, draft.qty);
    const gain =
      leaving === 'sold' && soldCents != null && draft.pricePaidCents != null
        ? (soldCents - draft.pricePaidCents) * n
        : null;
    return (
      <Sheet open={!!item} title={leaving === 'sold' ? 'Verkauft' : 'Verloren'} onClose={() => setLeaving(null)}>
        <div className="stack">
          <p className="muted">
            {draft.name} · {draft.variantLabel || 'Standard'}
          </p>
          {draft.qty > 1 && (
            <div className="spread">
              <span className="label">Wie viele?</span>
              <div className="stepper">
                <button className="icon-btn" aria-label="Eine weniger" onClick={() => setLeaveQty(Math.max(1, n - 1))}>
                  <Icon name="minus" />
                </button>
                <output className="num" aria-live="polite">
                  {n}
                </output>
                <button
                  className="icon-btn"
                  aria-label="Eine mehr"
                  onClick={() => setLeaveQty(Math.min(draft.qty, n + 1))}
                >
                  <Icon name="plus" />
                </button>
              </div>
            </div>
          )}
          {leaving === 'sold' ? (
            <>
              <MoneyInput big label="Verkauft für (pro Karte, optional)" value={soldCents} onChange={setSoldCents} />
              {unitValue != null && (
                <p className="faint small">
                  Marktwert zurzeit ≈ {cents(unitValue)} pro Karte
                  {draft.pricePaidCents != null ? ` · gekauft für ${cents(draft.pricePaidCents)}` : ''}
                </p>
              )}
              {gain != null && (
                <p className={`num ${gain >= 0 ? 'gain' : 'loss'}`}>
                  {gain >= 0 ? 'Gewinn' : 'Verlust'} {gain >= 0 ? '+' : '−'}
                  {cents(Math.abs(gain))}
                </p>
              )}
            </>
          ) : (
            <p className="faint small">
              Die Karte verlässt die Sammlung und wird im Depot unter „Verkauft &amp; verloren“ vermerkt.
            </p>
          )}
          <button className="btn btn-primary btn-block" onClick={leave}>
            {n < draft.qty
              ? `${n} von ${draft.qty} aus der Sammlung nehmen`
              : n > 1
                ? `Alle ${n} aus der Sammlung nehmen`
                : 'Aus der Sammlung nehmen'}
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setLeaving(null)}>
            Abbrechen
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={!!item} title={draft.list === 'wish' ? 'Merkliste' : 'Posten bearbeiten'} onClose={onClose}>
      <div className="stack">
        {draft.list === 'collection' && (
          <div className="leave-actions" role="group" aria-label="Aus der Sammlung nehmen">
            <button className="btn" onClick={() => startLeave('sold')}>
              <Icon name="tag" /> Verkauft
            </button>
            <button className="btn" onClick={() => startLeave('lost')}>
              <Icon name="close" /> Verloren
            </button>
          </div>
        )}
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
          <Icon name="trash" /> {draft.list === 'collection' ? 'Löschen (falsch erfasst)' : 'Entfernen'}
        </button>
      </div>
    </Sheet>
  );
}
