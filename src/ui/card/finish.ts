// Glanzstärke nach Seltenheit: Common matt, Holo schimmernd, Secret/Illustration Rare mit Regenbogen.

export type Finish = 'matte' | 'holo' | 'rainbow';

const RAINBOW = [
  'secret',
  'illustration',
  'hyper',
  'gold',
  'rainbow',
  'shiny',
  'amazing',
  'radiant',
  'crown',
  'ultra rare',
  'full art',
  'special',
];

export function finishFor(rarity?: string | null, variantType?: string | null): Finish {
  const r = String(rarity || '').toLowerCase();
  if (RAINBOW.some((x) => r.includes(x))) return 'rainbow';
  if (r.includes('holo') || r.includes('double rare') || r.includes('prime') || r.includes('lv.x')) return 'holo';
  const v = String(variantType || '').toLowerCase();
  if (v === 'holo' || v === 'reverse') return 'holo';
  return 'matte';
}
