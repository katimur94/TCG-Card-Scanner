// Eine Binder-Tasche: Karte mit Mengen-Badge; der Rand glüht grün/rot je nach Entwicklung seit dem Kauf.

import type { Pocket } from '../../domain/binder';
import { useUi } from '../../state/ui';
import { usePhotoUrl } from '../../state/hooks';
import { FallbackImg } from '../card/Card';
import { imageUrl } from '../../lib/api';
import { cents, change } from '../../lib/util';
import { langInfo } from '../../lib/lang';

export function PocketTile({ pocket }: { pocket: Pocket }) {
  const openCard = useUi((s) => s.openCard);
  const it = pocket.first;
  const photo = usePhotoUrl(it.image ? null : it.photoId);
  const glow =
    pocket.gainRatio == null || Math.abs(pocket.gainRatio) < 0.02 ? null : pocket.gainRatio > 0 ? 'gain' : 'loss';
  const wishHit =
    it.list === 'wish' && it.targetCents != null && it.priceCents != null && it.priceCents <= it.targetCents;
  const label = [
    it.name,
    `${langInfo(it.lang).label}`,
    it.variantLabel,
    pocket.qty > 1 ? `${pocket.qty} Stück` : '',
    pocket.valueCents != null ? `Wert ${cents(pocket.valueCents)}` : 'ohne Preis',
    pocket.gainRatio != null ? `seit Kauf ${change(pocket.gainRatio)}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <button
      className="pocket"
      data-glow={glow || undefined}
      data-hit={wishHit || undefined}
      aria-label={label}
      onClick={() =>
        openCard({
          ref: { region: it.region, setId: it.setId, localId: it.localId, id: it.cardId, lang: it.lang, name: it.name },
          postIds: pocket.items.map((i) => i.id),
          photoUrl: photo,
        })
      }
    >
      <div className="pocket-card">
        <FallbackImg sources={[imageUrl(it.image, 'low'), photo].filter((x): x is string => !!x)} alt={it.name} />
      </div>
      {pocket.qty > 1 && <span className="pocket-qty num">×{pocket.qty}</span>}
      <span className="pocket-flag" aria-hidden>
        {langInfo(it.lang).flag}
      </span>
      <span className="pocket-price num">{pocket.valueCents != null ? cents(pocket.valueCents) : '–'}</span>
    </button>
  );
}
