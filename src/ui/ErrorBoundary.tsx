// Fängt Darstellungsfehler eines Bereichs ab, damit nie die ganze App leer wird.

import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<
  { children: ReactNode; label: string; onReset?: () => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[HoloScan] Fehler in ${this.props.label}`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal" role="alert">
        <h2>Da ist etwas schiefgelaufen</h2>
        <p className="muted small">
          {this.props.label}: {this.state.error.message}
        </p>
        <p className="faint small">Deine Sammlung ist sicher gespeichert.</p>
        <button
          className="btn btn-primary"
          onClick={() => {
            this.props.onReset?.();
            this.setState({ error: null });
          }}
        >
          Zurück
        </button>
      </div>
    );
  }
}
