// Karte als echtes Objekt: 3D-Kippen, Holo-Glanz je Seltenheit, Umdrehen zur Rückseite (Kurszettel).

import { motion, useMotionTemplate } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { useTilt } from './useTilt';
import type { Finish } from './finish';
import './card.css';

export interface CardProps {
  /** Bildquelle(n) – bei Ladefehler wird die nächste probiert. */
  image: string | string[] | null;
  alt: string;
  finish?: Finish;
  /** Rückseite (z. B. Kurszettel). Ohne Rückseite dreht ein Tipp die Karte nicht. */
  back?: ReactNode;
  flipped?: boolean;
  onFlip?: (flipped: boolean) => void;
  glow?: 'gain' | 'loss' | null;
  width?: number | string;
  tilt?: boolean;
  badge?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function Card({
  image,
  alt,
  finish = 'matte',
  back,
  flipped: flippedProp,
  onFlip,
  glow,
  width = '100%',
  tilt = true,
  badge,
  onClick,
  className,
}: CardProps) {
  const [own, setOwn] = useState(false);
  const flipped = flippedProp ?? own;
  const t = useTilt(tilt ? 14 : 0);
  const glare = useMotionTemplate`radial-gradient(circle at ${t.gx}% ${t.gy}%, rgba(255,255,255,0.45), rgba(255,255,255,0) 45%)`;
  const sheen = useMotionTemplate`${t.gx}% ${t.gy}%`;

  const toggle = () => {
    if (onClick) return onClick();
    if (!back) return;
    const next = !flipped;
    setOwn(next);
    onFlip?.(next);
  };

  return (
    <div className={`card3d ${className || ''}`} style={{ width }} data-glow={glow || undefined}>
      <motion.button
        type="button"
        className="card3d-inner"
        aria-label={back ? `${alt} – ${flipped ? 'Vorderseite zeigen' : 'Wert zeigen'}` : alt}
        aria-pressed={back ? flipped : undefined}
        onClick={toggle}
        {...(tilt ? t.bind : {})}
        style={{ rotateX: tilt ? t.rx : 0, rotateY: tilt ? t.ry : 0 }}
      >
        <motion.div
          className="card3d-flip"
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={t.reduced ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 20 }}
        >
          <div className="card3d-face card3d-front">
            <FallbackImg sources={image} alt={alt} />
            {!t.reduced && finish !== 'matte' && (
              <motion.div className={`card3d-foil foil-${finish}`} style={{ backgroundPosition: sheen }} />
            )}
            {!t.reduced && <motion.div className="card3d-glare" style={{ background: glare }} />}
            {badge}
          </div>
          {back && <div className="card3d-face card3d-back">{back}</div>}
        </motion.div>
      </motion.button>
    </div>
  );
}

/** <img> mit Ersatzquellen; ohne ladbares Bild bleibt ein Platzhalter mit dem Kartennamen. */
export function FallbackImg({
  sources,
  alt,
  eager = false,
}: {
  sources: string | string[] | null;
  alt: string;
  eager?: boolean;
}) {
  const list = (Array.isArray(sources) ? sources : sources ? [sources] : []).filter(Boolean);
  const key = list.join('|');
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [key]);
  if (i >= list.length) {
    return (
      <div className="card3d-placeholder">
        <span>{alt}</span>
      </div>
    );
  }
  return (
    <img
      src={list[i]}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onError={() => setI(i + 1)}
    />
  );
}
