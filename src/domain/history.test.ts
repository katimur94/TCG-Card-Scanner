import { describe, expect, it } from 'vitest';
import { seriesFrom, HISTORY_SHARDS, type HistoryFile } from './history';
// @ts-expect-error – Node-Skript ohne Typen
import { appendDay, compactDays, SHARDS } from '../../scripts/build-price-history.mjs';

describe('Preis-Historie (Pipeline <-> App)', () => {
  it('gleiche Anzahl Dateien', () => {
    expect(SHARDS).toBe(HISTORY_SHARDS);
  });

  it('hängt Tage an und liest sie in der App wieder', () => {
    let f = appendDay(null, 20261013, [{ id: '42', t: 1050, h: null }]);
    f = appendDay(f, 20261014, [
      { id: '42', t: 1100, h: 300 },
      { id: '7', t: 500, h: null },
    ]);
    f = appendDay(f, 20261014, [{ id: '42', t: 1200, h: 300 }]); // gleicher Tag überschreibt
    expect(f.days).toEqual([20261013, 20261014]);
    expect(seriesFrom(f as HistoryFile, 42)).toEqual([
      { d: '2026-10-13', c: 1050 },
      { d: '2026-10-14', c: 1200 },
    ]);
    expect(seriesFrom(f as HistoryFile, 42, true)).toEqual([{ d: '2026-10-14', c: 300 }]);
    expect(seriesFrom(f as HistoryFile, 7)).toEqual([{ d: '2026-10-14', c: 500 }]);
  });

  it('verdichtet ältere Tage auf einen Wert pro Woche', () => {
    const days: number[] = [];
    for (let i = 0; i < 200; i++)
      days.push(Number(new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10).replace(/-/g, '')));
    const today = days[days.length - 1];
    const kept = compactDays(days, today);
    const recent = kept.filter((d: number) => d >= days[200 - 91]);
    expect(recent.length).toBeGreaterThanOrEqual(90);
    expect(kept.length).toBeLessThan(90 + 20);
  });
});
