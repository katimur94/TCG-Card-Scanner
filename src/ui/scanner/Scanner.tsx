// Ort „Scanner“ (Startbildschirm). Oben nur Sammlungswert und Tagesänderung.
// Nach oben wischen öffnet den Binder (zusätzlich ein sichtbarer Knopf).
// M1: noch ohne Erkennung – der neue Scanner kommt mit M2/M3.

import { motion } from 'framer-motion';
import { useUi } from '../../state/ui';
import { useDepot } from '../../state/hooks';
import { cents, change } from '../../lib/util';
import { Icon } from '../Icon';
import { requestGyro } from '../card/useTilt';

export function Scanner() {
  const setBinder = useUi((s) => s.setBinder);
  const openSheet = useUi((s) => s.openSheet);
  const { depot, day } = useDepot();

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
        <button className="icon-btn" onClick={() => openSheet('search')} aria-label="Karte suchen">
          <Icon name="search" />
        </button>
      </header>

      <div className="scanner-stage">
        <div className="scan-frame" aria-hidden>
          <i className="c tl" />
          <i className="c tr" />
          <i className="c bl" />
          <i className="c br" />
        </div>
        <div className="scanner-note">
          <p className="h-sm">Neuer Scanner in Arbeit</p>
          <p className="muted small">
            Die Erkennung per Kamera kommt im nächsten Update. Bis dahin findest du jede Karte über die Suche.
          </p>
          <button className="btn btn-primary" onClick={() => openSheet('search')}>
            <Icon name="search" /> Karte suchen
          </button>
        </div>
      </div>

      <footer className="scanner-bottom">
        <button className="round-btn" disabled aria-label="Foto aus der Galerie (kommt mit dem Scanner-Update)">
          <Icon name="gallery" />
        </button>
        <button className="binder-handle" onClick={() => setBinder(true)} aria-label="Binder öffnen">
          <Icon name="chevronUp" />
          <span>Binder</span>
          <span className="num faint">{depot.cards} Karten</span>
        </button>
        <button className="round-btn" disabled aria-label="Taschenlampe (kommt mit dem Scanner-Update)">
          <Icon name="torch" />
        </button>
      </footer>
    </motion.main>
  );
}
