import { describe, expect, it } from 'vitest';
import { dayPacific, suggestChain, defaultLimit } from './client';

describe('KI-Client', () => {
  it('Tageswechsel nach pazifischer Zeit (9 Uhr deutscher Sommerzeit)', () => {
    expect(dayPacific(new Date('2026-10-13T06:59:00Z'))).toBe('2026-10-12');
    expect(dayPacific(new Date('2026-10-13T07:01:00Z'))).toBe('2026-10-13');
  });

  it('baut die Modell-Kette aus der Modell-Liste (keine fest eingebauten Namen)', () => {
    const models = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash-lite-preview-09', 'gemini-3.8-pro', 'gemini-2.0-flash'].map((id) => ({ id, label: id }));
    expect(suggestChain(models)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash']);
  });

  it('vorbelegte Limits', () => {
    expect(defaultLimit('gemini-3.5-flash-lite')).toBeGreaterThan(defaultLimit('gemini-3.8-flash'));
  });
});
