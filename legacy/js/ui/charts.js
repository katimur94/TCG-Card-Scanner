// Kleine SVG-Diagramme (ohne Bibliothek).

import { money, date } from '../util.js';

let gid = 0;

/**
 * Flächen-Linie für eine Wertereihe.
 * @param {Array<{label?: string, v: number}>} points
 */
export function areaChart(points, { height = 64, color = '#f5c451', showDots = true } = {}) {
  const pts = points.filter((p) => p.v != null && !Number.isNaN(p.v));
  if (pts.length < 2) return '';
  const id = `g${++gid}`;
  const W = 300;
  const H = height;
  const pad = 6;
  const vals = pts.map((p) => p.v);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max - min < max * 0.02) {
    min -= max * 0.05 || 1;
    max += max * 0.05 || 1;
  }
  const x = (i) => pad + (i * (W - 2 * pad)) / (pts.length - 1);
  const y = (v) => pad + (1 - (v - min) / (max - min)) * (H - 2 * pad);
  // weiche Kurve (Catmull-Rom -> Bezier)
  const P = pts.map((p, i) => [x(i), y(p.v)]);
  let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i];
    const p1 = P[i];
    const p2 = P[i + 1];
    const p3 = P[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const area = `${d} L${P[P.length - 1][0].toFixed(1)},${H} L${P[0][0].toFixed(1)},${H} Z`;
  const last = P[P.length - 1];
  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Preisverlauf">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${color}" stop-opacity=".35"/>
          <stop offset="1" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#${id})" stroke="none"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      ${showDots ? `<circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${color}" stroke="#0b0915" stroke-width="2" vector-effect="non-scaling-stroke"/>` : ''}
    </svg>`;
}

/** Diagramm aus den Preisguide-Durchschnitten: Ø30 → Ø7 → Ø1 → Trend */
export function guideChart(cm) {
  if (!cm) return '';
  const pts = [
    { label: 'Ø 30 T.', v: cm.avg30 },
    { label: 'Ø 7 T.', v: cm.avg7 },
    { label: 'Ø 1 T.', v: cm.avg1 },
    { label: 'Trend', v: cm.trend },
  ].filter((p) => p.v);
  if (pts.length < 3) return '';
  const up = pts[pts.length - 1].v >= pts[0].v;
  return `
    <div class="spark">${areaChart(pts, { color: up ? '#3ddc97' : '#ff6b81' })}</div>
    <div class="spark-labels">${pts.map((p) => `<span>${p.label}</span>`).join('')}</div>`;
}

/** Verlauf aus eigenen Abrufen [{d, v}] */
export function historyChart(points, opts) {
  if (!points || points.length < 2) return '';
  const pts = points.map((p) => ({ v: p.v, label: date(p.d, { day: '2-digit', month: '2-digit' }) }));
  return `
    <div class="spark">${areaChart(pts, opts)}</div>
    <div class="spark-labels"><span>${pts[0].label}</span><span>${money(points[points.length - 1].v)}</span><span>${pts[pts.length - 1].label}</span></div>`;
}
