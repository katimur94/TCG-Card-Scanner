// Betragsfeld in Euro, liefert Cent (oder null bei leerem Feld).

import { useEffect, useState } from 'react';

export function parseEuroToCents(s: string): number | null {
  const t = s.trim().replace(/\s|€/g, '');
  if (!t) return null;
  // "1.234,56" / "1234,56" / "1234.56"
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const v = Number(normalized);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
}

export const centsToInput = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

export function MoneyInput({
  value,
  onChange,
  label,
  big = false,
  placeholder = '0,00',
  id,
  autoFocus,
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  label: string;
  big?: boolean;
  placeholder?: string;
  id?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(centsToInput(value));
  useEffect(() => {
    if (parseEuroToCents(text) !== value) setText(centsToInput(value));
    // nur bei Wertänderung von außen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className={`field money ${big ? 'money-big' : ''}`}>
      <span>{label}</span>
      <div className="money-wrap">
        <input
          id={id}
          className="input num"
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parseEuroToCents(e.target.value));
          }}
        />
        <span className="money-unit">€</span>
      </div>
    </label>
  );
}
