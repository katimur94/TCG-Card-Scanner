// Zustand: eine Leiste mit den Cardmarket-Stufen. Gedrückt halten zeigt eine Kurzerklärung.

import { useRef, useState } from 'react';
import { CONDITIONS, conditionInfo } from '../lib/pricing';

export function ConditionBar({
  value,
  onChange,
  label = 'Zustand',
}: {
  value: number;
  onChange: (id: number) => void;
  label?: string;
}) {
  const [peek, setPeek] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = conditionInfo(peek ?? value);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPeek(null);
  };
  return (
    <div className="cond" role="radiogroup" aria-label={label}>
      <div className="cond-bar">
        {CONDITIONS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={value === c.id}
            aria-label={`${c.short} – ${c.label}: ${c.hint}`}
            className={`cond-step ${value === c.id ? 'is-on' : ''}`}
            style={{ ['--c' as string]: c.color }}
            onClick={() => onChange(c.id)}
            onPointerDown={() => {
              timer.current = setTimeout(() => setPeek(c.id), 420);
            }}
            onPointerUp={clear}
            onPointerLeave={clear}
            onContextMenu={(e) => e.preventDefault()}
          >
            {c.short === 'MT' ? 'M' : c.short}
          </button>
        ))}
      </div>
      <div className="cond-hint" aria-live="polite">
        <b>{shown.label}</b> <span className="muted">{shown.hint}</span>
      </div>
    </div>
  );
}
