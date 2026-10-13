// Triage: Karten vom Stapel einzeln sortieren – wie beim Kartenausteilen.
// Rechts wischen = in die Sammlung (danach nur die Kaufpreis-Frage), links = verwerfen,
// nach oben = Details und Korrektur. Jede Geste hat auch einen sichtbaren Knopf; 5 s Rückgängig.

import { AnimatePresence, motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useStack, type StackEntry, type StackOption } from '../../state/stack';
import { useUi, toast } from '../../state/ui';
import { useSettings } from '../../state/settings';
import { cardDataOrOffline, type CardData } from '../../domain/cardData';
import { addPost, removePost } from '../../domain/collection';
import { db } from '../../db/schema';
import { Card, FallbackImg } from '../card/Card';
import { ConditionBar } from '../ConditionBar';
import { Icon } from '../Icon';
import { PurchaseSheet, type Purchase } from '../detail/PurchaseSheet';
import { LANGS, langInfo } from '../../lib/lang';
import { money, haptic, uid } from '../../lib/util';
import { useBlobUrl, useThumbs } from './useThumb';

export function Triage() {
  const open = useUi((s) => s.triageOpen);
  const setTriage = useUi((s) => s.setTriage);
  const entries = useStack((s) => s.entries);
  const current = entries[0];
  useEffect(() => {
    if (open && !entries.length) setTriage(false);
  }, [open, entries.length, setTriage]);
  return (
    <AnimatePresence>
      {open && current && (
        <motion.div className="triage" role="dialog" aria-modal="true" aria-label="Stapel sortieren" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <header className="triage-top">
            <button className="icon-btn" onClick={() => setTriage(false)} aria-label="Zurück zum Scanner">
              <Icon name="chevronDown" />
            </button>
            <span className="num muted">
              {entries.length} {entries.length === 1 ? 'Karte' : 'Karten'} im Stapel
            </span>
            <span style={{ width: 44 }} />
          </header>
          <AnimatePresence mode="popLayout">
            <TriageCard key={current.id} entry={current} />
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TriageCard({ entry }: { entry: StackEntry }) {
  const settings = useSettings((s) => s.settings);
  const stack = useStack();
  const pickCard = useUi((s) => s.pickCard);
  const openCard = useUi((s) => s.openCard);
  const [lang, setLang] = useState(entry.lang);
  const [choice, setChoice] = useState<StackOption | null>(entry.status === 'sure' ? entry.best : null);
  const [data, setData] = useState<CardData | null>(null);
  const [variantKey, setVariantKey] = useState<string | null>(null);
  const [condition, setCondition] = useState(settings.condition || 2);
  const [buying, setBuying] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const photo = useBlobUrl(entry.photo);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-14, 14]);
  const hintRight = useTransform(x, [30, 120], [0, 1]);
  const hintLeft = useTransform(x, [-120, -30], [1, 0]);
  const hintUp = useTransform(y, [-120, -30], [1, 0]);

  useEffect(() => {
    if (!choice) {
      setData(null);
      return;
    }
    let alive = true;
    cardDataOrOffline({ region: choice.group, setId: choice.setId, localId: choice.localId, id: `${choice.setId}-${choice.localId}`, lang: choice.group === 'ja' ? 'ja' : lang, name: choice.name })
      .then((d) => {
        if (!alive) return;
        setData(d);
        setVariantKey((k) => (k && d.variants.some((v) => v.key === k) ? k : d.variants[0]?.key ?? null));
      })
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [choice, lang]);

  const variant = data?.variants.find((v) => v.key === variantKey) || data?.variants[0];
  const thumbs = useThumbs(choice, lang, 'high');
  const images = useMemo(() => [...(data?.images || thumbs), ...(photo ? [photo] : [])], [data, thumbs, photo]);

  const fly = async (dx: number, dy: number) => {
    await Promise.all([animate(x, dx, { duration: 0.22 }), animate(y, dy, { duration: 0.22 })]);
  };
  const reset = () => {
    animate(x, 0, { type: 'spring', stiffness: 300, damping: 25 });
    animate(y, 0, { type: 'spring', stiffness: 300, damping: 25 });
  };

  const discard = async () => {
    haptic(8);
    await fly(-500, 0);
    const removed = await stack.remove(entry.id);
    toast({ text: 'Verworfen', action: removed ? { label: 'Rückgängig', run: () => stack.restore(removed) } : undefined });
  };

  const collect = async (p: Purchase) => {
    if (!data) return;
    // Kein Bild in der Datenbank: eigenes Foto der Karte speichern
    let photoId: string | null = null;
    if (!data.imageBase && entry.photo) {
      photoId = `scan-${uid()}`;
      await db.photos.put({ id: photoId, blob: entry.photo });
    }
    await fly(500, 0);
    const item = await addPost({ list: 'collection', data: { ...data, ref: { ...data.ref, lang } }, variantKey: variant?.key || 'normal', condition, pricePaidCents: p.pricePaidCents, origin: p.origin, photoId });
    const removed = await stack.remove(entry.id);
    haptic([10, 40, 14]);
    toast({
      text: `${item.name} ist in der Sammlung`,
      tone: 'gain',
      action: {
        label: 'Rückgängig',
        run: async () => {
          await removePost(item.id);
          if (removed) await stack.restore(removed);
        },
      },
    });
  };

  const choose = async (o: StackOption) => {
    setChoice(o);
    setCorrecting(false);
    await stack.update(entry.id, { status: 'sure', best: o, reason: 'von dir gewählt' });
  };

  const sure = !!choice;
  const name = data?.display.name || choice?.name || 'Unbekannte Karte';
  const langChoices = entry.langOptions.length > 1 ? entry.langOptions : null;

  return (
    <motion.div className="triage-body" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="triage-card"
        style={{ x, y, rotate }}
        drag={sure && !buying}
        dragElastic={0.7}
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        onDragEnd={(_, info) => {
          const { x: ox, y: oy } = info.offset;
          if (ox > 110 && data) setBuying(true);
          else if (ox < -110) void discard();
          else if (oy < -110) setCorrecting(true);
          if (!(ox < -110)) reset();
        }}
      >
        <motion.span className="swipe-hint hint-right" style={{ opacity: hintRight }} aria-hidden>
          Sammlung
        </motion.span>
        <motion.span className="swipe-hint hint-left" style={{ opacity: hintLeft }} aria-hidden>
          Verwerfen
        </motion.span>
        <motion.span className="swipe-hint hint-up" style={{ opacity: hintUp }} aria-hidden>
          Korrigieren
        </motion.span>
        {sure ? (
          <Card image={images} alt={name} finish={data?.finish} width="min(62vw, 300px)" tilt={false} />
        ) : (
          <div className="triage-photo">
            <FallbackImg sources={photo} alt="Dein Foto" eager />
          </div>
        )}
        {sure && photo && (
          <div className="triage-inset" aria-hidden>
            <img src={photo} alt="" />
          </div>
        )}
      </motion.div>

      {sure ? (
        <div className="triage-info">
          <h2 className="triage-name">{name}</h2>
          <p className="faint small">
            {data?.setName || choice?.setName || choice?.setId} · <span className="num">{choice?.localId}{data?.official ? `/${data.official}` : ''}</span>
            {entry.reason === 'von dir gewählt' ? ' · von dir gewählt' : ''}
          </p>
          <p className="num triage-price">{(data as { offline?: boolean } | null)?.offline ? 'Preis folgt, sobald du online bist' : money(variant?.cm?.value)}</p>
          {choice?.group === 'intl' && (
            <div className="scroll-x center-x" role="group" aria-label="Sprache">
              {(langChoices || [lang]).map((l) => (
                <button key={l} className="chip" aria-pressed={l === lang} onClick={() => setLang(l)}>
                  {langInfo(l).flag} {langInfo(l).short}
                </button>
              ))}
              {!langChoices && (
                <button className="chip" onClick={() => setCorrecting(true)} aria-label="Andere Sprache wählen">
                  …
                </button>
              )}
            </div>
          )}
          {langChoices && <p className="faint small center">Sprache unsicher – bitte wählen</p>}
          {data && data.variants.length > 1 && (
            <div className="scroll-x center-x" role="group" aria-label="Variante">
              {data.variants.slice(0, 4).map((v) => (
                <button key={v.key} className="chip" aria-pressed={v.key === variant?.key} onClick={() => setVariantKey(v.key)}>
                  {v.label}
                </button>
              ))}
            </div>
          )}
          <ConditionBar value={condition} onChange={setCondition} />
        </div>
      ) : (
        <div className="triage-info">
          <h2 className="triage-name">{entry.options.length ? 'Welche Karte ist es?' : 'Karte nicht erkannt'}</h2>
          <p className="faint small center">{entry.reason}</p>
          <OptionList options={entry.options} lang={lang} onPick={choose} />
          <button className="btn btn-block" onClick={() => pickCard((hit) => void choose(hit))}>
            <Icon name="search" /> Andere suchen
          </button>
        </div>
      )}

      <div className="triage-actions">
        <button className="round-btn" onClick={discard} aria-label="Verwerfen (nach links wischen)">
          <Icon name="close" />
        </button>
        <button className="round-btn" onClick={() => setCorrecting(true)} aria-label="Details und Korrektur (nach oben wischen)" disabled={!sure}>
          <Icon name="chevronUp" />
        </button>
        <button className="round-btn round-primary" onClick={() => setBuying(true)} aria-label="In die Sammlung (nach rechts wischen)" disabled={!data}>
          <Icon name="check" />
        </button>
      </div>

      <AnimatePresence>
        {correcting && (
          <motion.div className="triage-correct panel" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}>
            <div className="spread">
              <h3 className="h-sm">Korrigieren</h3>
              <button className="icon-btn" onClick={() => setCorrecting(false)} aria-label="Schließen">
                <Icon name="close" />
              </button>
            </div>
            {entry.options.length > 1 && <OptionList options={entry.options.slice(0, 3)} lang={lang} onPick={choose} current={choice} />}
            {choice?.group === 'intl' && (
              <div className="scroll-x" role="group" aria-label="Sprache">
                {LANGS.filter((l) => l.group === 'intl').map((l) => (
                  <button key={l.code} className="chip" aria-pressed={l.code === lang} onClick={() => setLang(l.code)}>
                    {l.flag} {l.short}
                  </button>
                ))}
              </div>
            )}
            <div className="row wrap">
              <button className="btn btn-sm" onClick={() => pickCard((hit) => void choose(hit))}>
                <Icon name="search" /> Anderes Set / andere Karte
              </button>
              {choice && (
                <button
                  className="btn btn-sm"
                  onClick={() =>
                    openCard({ ref: { region: choice.group, setId: choice.setId, localId: choice.localId, id: `${choice.setId}-${choice.localId}`, lang, name }, photoUrl: photo })
                  }
                >
                  Alle Details
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <PurchaseSheet open={buying} onClose={() => setBuying(false)} onSave={(p) => void collect(p)} />
    </motion.div>
  );
}

function OptionList({ options, lang, onPick, current }: { options: StackOption[]; lang: string; onPick: (o: StackOption) => void; current?: StackOption | null }) {
  return (
    <ul className="options">
      {options.slice(0, 3).map((o) => (
        <li key={`${o.group}:${o.setId}:${o.localId}`}>
          <OptionTile o={o} lang={lang} onPick={onPick} active={!!current && current.setId === o.setId && current.localId === o.localId} />
        </li>
      ))}
    </ul>
  );
}

function OptionTile({ o, lang, onPick, active }: { o: StackOption; lang: string; onPick: (o: StackOption) => void; active: boolean }) {
  const thumbs = useThumbs(o, lang);
  return (
    <button className={`option ${active ? 'is-on' : ''}`} onClick={() => onPick(o)} aria-pressed={active}>
      <div className="result-img">
        <FallbackImg sources={thumbs} alt={o.name} />
      </div>
      <span className="result-name">{o.name}</span>
      <span className="faint small">
        {o.setName || o.setId} · <span className="num">{o.localId}</span>
      </span>
    </button>
  );
}
