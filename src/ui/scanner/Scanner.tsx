// Ort „Scanner“ (Startbildschirm). Oben nur Sammlungswert und Tagesänderung. Unten Galerie, Stapel, Taschenlampe.
// Nach oben wischen öffnet den Binder (zusätzlich ein sichtbarer Knopf).

import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { useUi } from '../../state/ui';
import { useDepot } from '../../state/hooks';
import { useStack } from '../../state/stack';
import { cents, change } from '../../lib/util';
import { Icon } from '../Icon';
import { requestGyro } from '../card/useTilt';
import { Stack } from '../stack/Stack';
import { addImages, processQueue } from '../../scan/processor';
import { warmupVision } from '../../scan/vision';
import { LiveCamera } from './LiveCamera';

export function Scanner() {
  const setBinder = useUi((s) => s.setBinder);
  const openSheet = useUi((s) => s.openSheet);
  const setTriage = useUi((s) => s.setTriage);
  const { depot, day } = useDepot();
  const working = useStack((s) => s.working);
  const paused = useUi((s) => s.binderOpen || s.triageOpen || !!s.card || !!s.sheet);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void useStack
      .getState()
      .load()
      .then(() => processQueue());
  }, []);

  return (
    <motion.main
      className="scanner"
      aria-label="Scanner"
      onPanEnd={(_, info) => {
        if (info.offset.y < -70 && Math.abs(info.offset.x) < 80) setBinder(true);
      }}
      onPointerDown={() => void requestGyro()}
    >
      <header className="scanner-top">
        <button
          className="ticker"
          onClick={() => setBinder(true)}
          aria-label={`Sammlungswert ${cents(depot.valueCents)}${day != null ? `, heute ${change(day)}` : ''}. Binder öffnen`}
        >
          <span className="num ticker-value">{cents(depot.valueCents)}</span>
          {day != null && <span className={`num ticker-day ${day >= 0 ? 'gain' : 'loss'}`}>{change(day)}</span>}
        </button>
        <button className="icon-btn" onClick={() => openSheet('settings')} aria-label="Einstellungen">
          <Icon name="settings" />
        </button>
      </header>

      <div className="scanner-stage">
        <LiveCamera paused={paused} />
        {working && (
          <div className="scanner-working" aria-live="polite">
            <span className="h-sm">{working.label}</span>
          </div>
        )}
      </div>

      <footer className="scanner-bottom">
        <button
          className="round-btn"
          onClick={() => {
            void warmupVision();
            fileRef.current?.click();
          }}
          aria-label="Fotos aus der Galerie scannen"
        >
          <Icon name="gallery" />
        </button>
        <div className="scanner-center">
          <Stack onOpen={() => setTriage(true)} />
          <button className="binder-handle" onClick={() => setBinder(true)} aria-label="Binder öffnen">
            <Icon name="chevronUp" size={16} />
            <span>Binder</span>
          </button>
        </div>
        <button className="round-btn" onClick={() => openSheet('search')} aria-label="Karte suchen">
          <Icon name="search" />
        </button>
      </footer>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void addImages(e.target.files);
          e.target.value = '';
        }}
      />
    </motion.main>
  );
}
