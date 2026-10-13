// Schlanke Linie für Kursverläufe (SVG, ohne Bibliothek). Werte in Cent.

import { useId } from 'react';
import { cents, date } from '../lib/util';

export interface Point {
  d: string; // YYYY-MM-DD
  c: number;
}

export function LineChart({
  points,
  height = 90,
  label,
  compact = false,
}: {
  points: Point[];
  height?: number;
  label: string;
  compact?: boolean;
}) {
  const id = 'lc' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  if (points.length < 2) {
    return (
      <p className="chart-empty faint">
        {compact ? 'Verlauf folgt' : 'Der Verlauf beginnt mit dem ersten Abruf und wächst mit jedem Tag.'}
      </p>
    );
  }
  const W = 300;
  const H = height;
  const pad = compact ? 4 : 6;
  const xs = points.map((p) => new Date(p.d).getTime());
  const ys = points.map((p) => p.c);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const sx = (x: number) => pad + ((x - x0) / Math.max(1, x1 - x0)) * (W - 2 * pad);
  const sy = (y: number) => H - pad - ((y - y0) / Math.max(1, y1 - y0)) * (H - 2 * pad);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(p.c).toFixed(1)}`).join('');
  const up = ys[ys.length - 1] >= ys[0];
  const color = up ? 'var(--gain)' : 'var(--loss)';
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <figure
      className="chart"
      aria-label={`${label}: von ${cents(first.c)} am ${date(first.d)} auf ${cents(last.c)} am ${date(last.d)}`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d}L${sx(x1)},${H}L${sx(x0)},${H}Z`} fill={`url(#${id})`} stroke="none" />
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>
      {!compact && (
        <figcaption className="chart-axis faint num">
          <span>{date(first.d, { day: '2-digit', month: '2-digit' })}</span>
          <span>
            {cents(y0)} – {cents(y1)}
          </span>
          <span>{date(last.d, { day: '2-digit', month: '2-digit' })}</span>
        </figcaption>
      )}
    </figure>
  );
}
