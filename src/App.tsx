import { useEffect, useState } from 'react';
import { Scanner } from './ui/scanner/Scanner';
import { Binder } from './ui/binder/Binder';
import { CardDetail } from './ui/detail/CardDetail';
import { SearchSheet } from './ui/sheets/SearchSheet';
import { SettingsSheet } from './ui/sheets/SettingsSheet';
import { DepotSheet } from './ui/sheets/DepotSheet';
import { Toasts } from './ui/Toasts';
import { boot } from './boot';
import { useUi } from './state/ui';
import { ErrorBoundary } from './ui/ErrorBoundary';

export function App() {
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    boot()
      .then(() => setReady(true))
      .catch((e) => setFatal(String(e?.message || e)));
  }, []);

  // Start-Parameter der alten App (Verknüpfungen im Startbildschirm: ?view=collection/search)
  useEffect(() => {
    if (!ready) return;
    const view = new URLSearchParams(location.search).get('view');
    if (view === 'collection') useUi.getState().setBinder(true);
    if (view === 'search') useUi.getState().openSheet('search');
  }, [ready]);

  if (fatal) {
    return (
      <div className="fatal" role="alert">
        <h1>HoloScan konnte nicht starten</h1>
        <p className="muted">{fatal}</p>
        <p className="faint small">Deine Daten sind nicht verloren. Bitte die Seite neu laden.</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>
          Neu laden
        </button>
      </div>
    );
  }
  if (!ready) return <div className="splash" aria-label="Lädt" />;

  return (
    <>
      <ErrorBoundary label="Scanner">
        <Scanner />
      </ErrorBoundary>
      <ErrorBoundary label="Binder" onReset={() => useUi.getState().setBinder(false)}>
        <Binder />
      </ErrorBoundary>
      <ErrorBoundary label="Karte" onReset={() => useUi.getState().closeCard()}>
        <CardDetail />
      </ErrorBoundary>
      <ErrorBoundary label="Ansicht" onReset={() => useUi.getState().openSheet(null)}>
        <SearchSheet />
        <SettingsSheet />
        <DepotSheet />
      </ErrorBoundary>
      <Toasts />
    </>
  );
}
