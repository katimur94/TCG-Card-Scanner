// Ort „Karte“: groß, kippbar, umdrehbar. Sprache, Variante, Zustand, Preise je Zustand, eigene Posten.

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useUi, toast, type OpenCard } from '../../state/ui';
import { useSettings } from '../../state/settings';
import { db, type CollectionItem } from '../../db/schema';
import { loadCardData, type CardData } from '../../domain/cardData';
import { priceSeries } from '../../domain/history';
import { addPost, priceKeyOf, removePost } from '../../domain/collection';
import { unitValueCents } from '../../domain/valuation';
import { Card } from '../card/Card';
import { PriceSlip } from '../card/PriceSlip';
import { ConditionBar } from '../ConditionBar';
import { Icon } from '../Icon';
import { PurchaseSheet, type Purchase } from './PurchaseSheet';
import { PostEditor } from './PostEditor';
import { DealCheck } from './DealCheck';
import { LANGS, langInfo } from '../../lib/lang';
import { CONDITIONS, cardmarketUrl, conditionValue, momentum } from '../../lib/pricing';
import { cents, change, money, haptic } from '../../lib/util';
import type { Point } from '../LineChart';

export function CardDetail() {
  const open = useUi((s) => s.card);
  const close = useUi((s) => s.closeCard);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key={`${open.ref.region}:${open.ref.id}`}
          className="detail"
          role="dialog"
          aria-modal="true"
          aria-label={open.ref.name || 'Karte'}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 60 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        >
          <DetailBody key={`${open.ref.region}:${open.ref.id}`} open={open} onClose={close} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// `open` kommt als Prop: Während der Schließ-Animation ist die Karte im Store schon entfernt.
function DetailBody({ open, onClose }: { open: OpenCard; onClose: () => void }) {
  const settings = useSettings((s) => s.settings);
  const [lang, setLang] = useState(open.ref.lang);
  const [data, setData] = useState<CardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variantKey, setVariantKey] = useState<string | null>(null);
  const [condition, setCondition] = useState(settings.condition || 2);
  const [series, setSeries] = useState<Point[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [buying, setBuying] = useState<'collection' | null>(null);
  const [editing, setEditing] = useState<CollectionItem | null>(null);
  const [ask, setAsk] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !editing && !buying && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editing, buying]);

  useEffect(() => {
    let alive = true;
    setError(null);
    loadCardData({ ...open.ref, lang })
      .then((d) => {
        if (!alive) return;
        setData(d);
        setVariantKey((k) => (k && d.variants.some((v) => v.key === k) ? k : (d.variants[0]?.key ?? null)));
      })
      .catch((e) => alive && setError(String(e?.message || e)));
    return () => {
      alive = false;
    };
  }, [open.ref, lang]);

  const posts =
    useLiveQuery(
      () =>
        db.collection_items
          .where('cardId')
          .equals(open.ref.id)
          .filter((i) => i.region === open.ref.region)
          .toArray(),
      [open.ref.id, open.ref.region],
      [],
    ) ?? [];
  const collectionPosts = posts.filter((p) => p.list === 'collection');

  const variant = data?.variants.find((v) => v.key === variantKey) || data?.variants[0] || null;
  const cm = variant?.cm ?? null;

  useEffect(() => {
    if (!variant) return;
    let alive = true;
    priceSeries(
      cm?.idProduct,
      variant.reverse,
      priceKeyOf({ region: open.ref.region, cardId: open.ref.id, variantKey: variant.key }),
    ).then((s) => alive && setSeries(s));
    return () => {
      alive = false;
    };
  }, [variant, cm?.idProduct, open.ref.region, open.ref.id]);

  const value = conditionValue(cm?.value, condition);
  const mom = momentum(cm);
  const own = useMemo(() => {
    const p = collectionPosts.filter((x) => x.variantKey === variant?.key && x.lang === lang);
    const qty = p.reduce((a, x) => a + x.qty, 0);
    const paid = p.filter((x) => x.pricePaidCents != null);
    const paidQty = paid.reduce((a, x) => a + x.qty, 0);
    const cost = paidQty ? Math.round(paid.reduce((a, x) => a + (x.pricePaidCents || 0) * x.qty, 0) / paidQty) : null;
    const val = p.length
      ? unitValueCents({ priceCents: Math.round((cm?.value || 0) * 100), condition: p[0].condition })
      : null;
    return { qty, cost, val };
  }, [collectionPosts, variant?.key, lang, cm?.value]);

  const add = async (list: 'collection' | 'wish', purchase?: Purchase) => {
    if (!data || !variant) return;
    const item = await addPost({
      list,
      data: { ...data, ref: { ...data.ref, lang } },
      variantKey: variant.key,
      condition,
      pricePaidCents: purchase?.pricePaidCents ?? null,
      origin: purchase?.origin ?? null,
    });
    haptic([10, 40, 14]);
    toast({
      text: list === 'collection' ? `${item.name} ist in der Sammlung` : `${item.name} steht auf der Merkliste`,
      tone: 'gain',
      action: {
        label: 'Rückgängig',
        run: async () => {
          await removePost(item.id);
        },
      },
    });
  };

  const cmLang = langInfo(lang).cm;
  const name = data?.display.name || open.ref.name || 'Karte';
  const glow =
    own.cost != null && own.val != null && own.cost > 0
      ? own.val >= own.cost * 1.02
        ? 'gain'
        : own.val <= own.cost * 0.98
          ? 'loss'
          : null
      : null;

  return (
    <div className="detail-scroll">
      <header className="detail-top">
        <button className="icon-btn" onClick={onClose} aria-label="Zurück">
          <Icon name="chevronDown" />
        </button>
        <div className="detail-meta">
          <span className="faint">{data?.setName || open.ref.set?.n || ''}</span>
          <span className="num faint">
            {open.ref.localId}
            {data?.official ? `/${data.official}` : ''}
          </span>
        </div>
        <span className="flag" aria-label={`Sprache: ${langInfo(lang).label}`}>
          {langInfo(lang).flag}
        </span>
      </header>

      <div className="detail-card">
        <Card
          image={open.photoUrl ? [...(data?.images || []), open.photoUrl] : data?.images || null}
          alt={name}
          finish={data?.finish}
          glow={glow}
          flipped={flipped}
          onFlip={setFlipped}
          back={
            <PriceSlip
              name={name}
              variantLabel={variant?.label || ''}
              cm={cm}
              series={series}
              costCents={own.cost}
              valueCents={own.val}
              qty={own.qty || 1}
            />
          }
          width="min(78vw, 340px)"
        />
        <button className="btn btn-sm btn-ghost flip-hint" onClick={() => setFlipped(!flipped)}>
          <Icon name="flip" size={16} /> {flipped ? 'Vorderseite' : 'Umdrehen: Kurszettel'}
        </button>
      </div>

      {error && <p className="panel loss">{error}</p>}

      <section className="detail-head">
        <h1 className="detail-name">{name}</h1>
        {data?.altImage && <p className="faint small">Bild: Ausgabe einer anderen Sprache</p>}
        <div className="detail-price">
          <span className="num price-big">{money(value)}</span>
          {mom != null && <span className={`num ${mom >= 0 ? 'gain' : 'loss'}`}>{change(mom)} (7 T)</span>}
        </div>
        <p className="faint small">
          {cm?.valueLabel || 'Kein Preis'}{' '}
          {condition !== 2 ? `· Richtwert ${CONDITIONS.find((c) => c.id === condition)?.short}` : '· Near Mint'}
          {variant?.tcgplayer && settings.showUSD ? ` · TCGplayer ${money(variant.tcgplayer.value, 'USD')}` : ''}
        </p>
      </section>

      {data && data.variants.length > 1 && (
        <div className="scroll-x detail-pad" role="group" aria-label="Variante">
          {data.variants.map((v) => (
            <button
              key={v.key}
              className="chip"
              aria-pressed={v.key === variant?.key}
              onClick={() => setVariantKey(v.key)}
            >
              {v.label} <span className="num faint">{money(v.cm?.value)}</span>
            </button>
          ))}
        </div>
      )}

      {open.ref.region === 'intl' && (
        <div className="scroll-x detail-pad" role="group" aria-label="Kartensprache">
          {LANGS.filter((l) => l.group === 'intl').map((l) => (
            <button key={l.code} className="chip" aria-pressed={l.code === lang} onClick={() => setLang(l.code)}>
              {l.flag} {l.short}
            </button>
          ))}
        </div>
      )}

      <div className="detail-pad">
        <ConditionBar value={condition} onChange={setCondition} />
      </div>

      <div className="detail-actions detail-pad">
        <button className="btn btn-primary" disabled={!data} onClick={() => setBuying('collection')}>
          <Icon name="plus" /> In die Sammlung
        </button>
        <button className="btn" disabled={!data} onClick={() => add('wish')}>
          <Icon name="heart" /> Merkliste
        </button>
      </div>

      {posts.length > 0 && (
        <section className="panel detail-pad-m stack" aria-labelledby="own-h">
          <h3 id="own-h" className="h-sm">
            Deine Posten
          </h3>
          <ul className="posts">
            {posts.map((p) => (
              <li key={p.id}>
                <button className="post" onClick={() => setEditing(p)}>
                  <span className="num">{p.qty}×</span>
                  <span>
                    {langInfo(p.lang).flag} {p.variantLabel || 'Standard'} ·{' '}
                    {CONDITIONS.find((c) => c.id === p.condition)?.short}
                    {p.list === 'wish' ? ' · Merkliste' : ''}
                  </span>
                  <span className="num muted">
                    {p.list === 'wish'
                      ? p.targetCents != null
                        ? `Alarm ≤ ${cents(p.targetCents)}`
                        : ''
                      : p.pricePaidCents != null
                        ? `Einstand ${cents(p.pricePaidCents)}`
                        : 'ohne Kaufpreis'}
                  </span>
                  <Icon name="edit" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cm && (
        <section className="panel detail-pad-m stack" aria-labelledby="cm-h">
          <div className="spread">
            <h3 id="cm-h" className="h-sm">
              Angebote nach Zustand
            </h3>
            <a
              className="btn btn-sm"
              href={cardmarketUrl({ idProduct: cm.idProduct, siteLang: settings.siteLang, search: name })}
              target="_blank"
              rel="noopener noreferrer"
            >
              Alle <Icon name="external" size={14} />
            </a>
          </div>
          <ul className="cond-list">
            {CONDITIONS.map((c) => (
              <li key={c.id}>
                <a
                  href={cardmarketUrl({
                    idProduct: cm.idProduct,
                    siteLang: settings.siteLang,
                    cmLang,
                    minCondition: c.id,
                    reverse: variant?.reverse,
                    firstEd: variant?.firstEd,
                    search: name,
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="cond-dot" style={{ background: c.color }} aria-hidden />
                  <span>
                    {c.short} <span className="faint">{c.label}</span>
                  </span>
                  <span className="num">≈ {money(conditionValue(cm.value, c.id))}</span>
                  <Icon name="external" size={14} />
                </a>
              </li>
            ))}
          </ul>
          <p className="faint small">
            Richtwerte: Der Preis-Guide nennt Durchschnitte über alle Sprachen und Zustände einer Karte. Die echten
            Angebote öffnen sich gefiltert auf {langInfo(lang).label} und den Mindestzustand.
            {open.ref.region === 'ja' ? ' Japanische Karten sind eigene Produkte mit eigenem Preis.' : ''}
          </p>
        </section>
      )}

      <div className="detail-pad-m">
        <DealCheck
          cm={cm}
          condition={condition}
          rarity={data?.rarity || null}
          setDate={data?.setDate || null}
          reverse={!!variant?.reverse}
          series={series}
          onAsk={setAsk}
        />
      </div>

      <div style={{ height: 40 }} />

      <PurchaseSheet
        open={buying === 'collection'}
        initialCents={ask}
        onClose={() => setBuying(null)}
        onSave={(p) => add('collection', p)}
      />
      <PostEditor item={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
