// Blatt von unten: nach unten wischen oder Schließen-Knopf, Escape, Fokus wandert hinein.

import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Sheet({
  open,
  title,
  onClose,
  children,
  full = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  full?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useDragControls();

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(
      () => ref.current?.querySelector<HTMLElement>('input, button:not([data-handle]), [tabindex]')?.focus(),
      60,
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // Fokus bleibt im Blatt (Tab läuft im Kreis)
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
          (el) => el.offsetParent !== null,
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="sheet-backdrop"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            ref={ref}
            className={`sheet ${full ? 'sheet-full' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            drag="y"
            dragListener={false}
            dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) onClose();
            }}
          >
            <div className="sheet-head" onPointerDown={(e) => drag.start(e)}>
              <span className="sheet-grip" aria-hidden />
              <h2>{title}</h2>
              <button className="icon-btn" onClick={onClose} aria-label="Schließen" data-handle>
                <Icon name="close" />
              </button>
            </div>
            <div className="sheet-body">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
