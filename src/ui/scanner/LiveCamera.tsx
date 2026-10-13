// Live-Kamera: findet Karten im Bild (ca. 8 Bilder/s), löst automatisch aus, sobald sie ruhig und scharf
// im Bild liegen, erkennt bis zu 9 Karten pro Aufnahme und lässt sie auf den Stapel fliegen.

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, cameraGranted } from '../../scan/camera';
import { Trigger } from '../../scan/trigger';
import { analyzeImage, detectFast, warmupVision } from '../../scan/vision';
import { recognizeCard } from '../../scan/recognize';
import { toEntry } from '../../scan/processor';
import { useStack, stackSettings, type StackEntry } from '../../state/stack';
import { toast } from '../../state/ui';
import { haptic } from '../../lib/util';
import { Icon } from '../Icon';
import type { Quad } from '../../scan/rgba';

interface Flyer {
  id: string;
  url: string;
  from: { x: number; y: number; w: number; h: number; rot: number };
}

type Phase = 'off' | 'starting' | 'searching' | 'steadying' | 'working' | 'cooldown' | 'error';

/** Gleiche Karte kurz zuvor schon erkannt? (Doppel-Schutz für eine zweite gleiche Karte) */
function recentDuplicate(entries: StackEntry[], e: Omit<StackEntry, 'id' | 'createdAt'>) {
  const since = Date.now() - 3 * 60 * 1000;
  return entries.find(
    (x) =>
      x.createdAt > since &&
      x.best &&
      e.best &&
      x.best.group === e.best.group &&
      x.best.setId === e.best.setId &&
      x.best.localId === e.best.localId,
  );
}

export function LiveCamera({ paused, onPhase }: { paused: boolean; onPhase?: (p: Phase) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const camRef = useRef<Camera | null>(null);
  const trigger = useRef(new Trigger());
  const [phase, setPhaseState] = useState<Phase>('off');
  const [quads, setQuads] = useState<Quad[]>([]);
  const [frameSize, setFrameSize] = useState<[number, number]>([1, 1]);
  const [hint, setHint] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const setPhase = useCallback(
    (p: Phase) => {
      setPhaseState(p);
      onPhase?.(p);
    },
    [onPhase],
  );

  const start = useCallback(async () => {
    if (!videoRef.current) return;
    camRef.current ||= new Camera(videoRef.current);
    setPhase('starting');
    setError(null);
    try {
      await camRef.current.start();
      if (!camRef.current.active) return;
      trigger.current.reset();
      setPhase('searching');
      void warmupVision();
    } catch (err) {
      const name = (err as Error)?.name;
      setError(
        name === 'NotAllowedError'
          ? 'Kamera nicht erlaubt. Bitte in den Browser-Einstellungen freigeben – oder Fotos aus der Galerie wählen.'
          : name === 'NotFoundError'
            ? 'Keine Kamera gefunden. Du kannst Fotos aus der Galerie wählen.'
            : `Kamera konnte nicht starten (${(err as Error)?.message || name}).`,
      );
      setPhase('error');
    }
  }, [setPhase]);

  // Starten, wenn erlaubt; pausieren, solange ein anderer Ort offen ist oder die App im Hintergrund liegt
  useEffect(() => {
    let alive = true;
    const sync = async () => {
      const hidden = document.hidden;
      if (paused || hidden) {
        camRef.current?.stop();
        setTorch(false);
        if (alive) setPhase('off');
        return;
      }
      if (camRef.current?.active || (await cameraGranted())) {
        if (alive) void start();
      }
    };
    void sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', sync);
    };
  }, [paused, start, setPhase]);

  useEffect(() => () => camRef.current?.stop(), []);

  const capture = useCallback(
    async (manual = false) => {
      const cam = camRef.current;
      if (!cam?.active || busy.current) return;
      busy.current = true;
      setPhase('working');
      setHint('Erkenne …');
      const toScreen = cam.toScreen();
      try {
        const photo = await cam.photo(2000);
        if (!photo) return;
        const pw = photo.width;
        const ph = photo.height;
        const vw = cam.video.videoWidth;
        const { cards } = await analyzeImage(photo, { straight: true });
        if (!cards.length) {
          setHint(manual ? 'Keine Karte gefunden – Karte ganz ins Bild halten' : null);
          return;
        }
        haptic(12);
        let glareSeen = false;
        for (const card of cards) {
          if (card.glare > 0.015) glareSeen = true;
          const r = await recognizeCard(card, { ...stackSettings() });
          const entry = await toEntry(r);
          const st = useStack.getState();
          const dup = recentDuplicate(st.entries, entry);
          // Bildschirm-Position der Karte für den Flug zum Stapel
          if (toScreen) {
            const s = vw / pw;
            const pts = card.quad.map(([x, y]) => toScreen(x * s, y * s));
            const xs = pts.map((p) => p[0]);
            const ys = pts.map((p) => p[1]);
            const rot = (Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]) * 180) / Math.PI;
            const url = entry.photo ? URL.createObjectURL(entry.photo) : '';
            const id = `${Date.now()}-${Math.random()}`;
            if (url && !dup) {
              setFlyers((f) => [...f, { id, url, from: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), rot } }]);
              setTimeout(() => {
                setFlyers((f) => f.filter((x) => x.id !== id));
                URL.revokeObjectURL(url);
              }, 900);
            }
          }
          if (dup) {
            toast({
              text: `${entry.best?.name || 'Karte'} liegt schon auf dem Stapel`,
              action: { label: 'Nochmal hinzufügen', run: async () => void (await useStack.getState().push(entry)) },
              ms: 6000,
            });
          } else {
            await st.push(entry);
            haptic([8, 30, 10]);
          }
        }
        setHint(glareSeen ? 'Spiegelung – Karte leicht kippen' : null);
        trigger.current.markFired(cards.map((c) => c.quad.map(([x, y]) => [(x * 640) / Math.max(pw, ph), (y * 640) / Math.max(pw, ph)]) as Quad), (ph * 640) / Math.max(pw, ph));
      } catch (err) {
        console.error('[HoloScan] Aufnahme', err);
        setHint('Erkennung fehlgeschlagen – nochmal versuchen');
      } finally {
        busy.current = false;
        if (camRef.current?.active) setPhase('cooldown');
      }
    },
    [setPhase],
  );

  // Vorschau-Schleife (~8 Bilder/s): Karten finden, Ruhe prüfen, auslösen
  useEffect(() => {
    if (phase === 'off' || phase === 'starting' || phase === 'error') return;
    let stop = false;
    let inflight = false;
    const tick = async () => {
      const cam = camRef.current;
      if (stop || inflight || busy.current || !cam?.active) return;
      const f = cam.frame(640);
      if (!f) return;
      inflight = true;
      try {
        const fw = f.width;
        const fh = f.height;
        const res = await detectFast(f, 360);
        if (stop) return;
        setFrameSize([fw, fh]);
        setQuads(res.quads);
        const st = trigger.current.push(res.quads, fh, res.sharp);
        if (st === 'fire') void capture();
        else if (!busy.current) {
          setPhase(st === 'cooldown' ? 'cooldown' : st === 'steadying' ? 'steadying' : 'searching');
          if (st === 'searching') setHint(null);
        }
      } catch {
        /* Vorschau-Fehler ignorieren */
      } finally {
        inflight = false;
      }
    };
    const timer = setInterval(() => void tick(), 125);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [phase === 'off' || phase === 'starting' || phase === 'error', capture]); // eslint-disable-line react-hooks/exhaustive-deps

  const cam = camRef.current;
  const map = cam?.toScreen();
  const vw = cam?.video.videoWidth || 1;
  const stage = videoRef.current?.getBoundingClientRect();
  const label =
    phase === 'steadying' ? 'Ruhig halten …' : phase === 'working' ? 'Erkenne …' : phase === 'cooldown' ? 'Erkannt – nächste Karte' : 'Karte ins Bild halten';

  return (
    <div className="live">
      <video ref={videoRef} className="live-video" playsInline muted autoPlay aria-hidden />
      {map && stage && quads.length > 0 && (
        <svg className="live-overlay" aria-hidden>
          {quads.map((q, i) => {
            const s = vw / frameSize[0];
            const pts = q.map(([x, y]) => map(x * s, y * s)).map(([x, y]) => `${x - stage.left},${y - stage.top}`);
            return <polygon key={i} points={pts.join(' ')} className={`live-quad ${phase === 'steadying' ? 'is-steady' : ''} ${phase === 'cooldown' ? 'is-done' : ''}`} />;
          })}
        </svg>
      )}

      {(phase === 'off' || phase === 'error') && (
        <div className="live-start">
          {error ? <p className="muted small">{error}</p> : <p className="muted small">Kamera an – Karte hinhalten, fertig. Mehrere Karten gleichzeitig gehen auch.</p>}
          <button className="btn btn-primary" onClick={() => void start()}>
            <Icon name="camera" /> Kamera starten
          </button>
        </div>
      )}

      {phase !== 'off' && phase !== 'error' && (
        <>
          <div className="live-hint" aria-live="polite">
            {hint || label}
          </div>
          <button className="live-shutter" onClick={() => void capture(true)} aria-label="Jetzt scannen" disabled={phase === 'working'}>
            <span />
          </button>
          {cam?.hasTorch && (
            <button
              className="icon-btn live-torch"
              aria-pressed={torch}
              aria-label="Taschenlampe"
              onClick={async () => setTorch(await cam.setTorch(!torch))}
            >
              <Icon name="torch" />
            </button>
          )}
        </>
      )}

      <AnimatePresence>
        {flyers.map((f) => {
          const target = document.querySelector('.stack-fan')?.getBoundingClientRect();
          const tx = target ? target.left + target.width / 2 : window.innerWidth / 2;
          const ty = target ? target.top + target.height / 2 : window.innerHeight - 60;
          return (
            <motion.img
              key={f.id}
              src={f.url}
              alt=""
              className="flyer"
              initial={{ left: f.from.x, top: f.from.y, width: f.from.w, height: f.from.h, rotate: f.from.rot, rotateY: 0, opacity: 1 }}
              animate={{ left: tx - 29, top: ty - 40, width: 58, height: 81, rotate: -6, rotateY: 360, opacity: 0.9 }}
              transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}
