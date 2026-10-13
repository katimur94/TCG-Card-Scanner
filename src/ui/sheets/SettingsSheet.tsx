// Einstellungen: Sammel-Sprachen, Zustand, Export/Import, Backup-Erinnerung, Speicher, Alles löschen.

import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../Sheet';
import { useUi, toast } from '../../state/ui';
import { useSettings } from '../../state/settings';
import { LANGS } from '../../lib/lang';
import { CONDITIONS } from '../../lib/pricing';
import { download, date } from '../../lib/util';
import { applyImport, exportBackup, exportCsv, planImport, type ImportPlan } from '../../domain/backup';
import { db } from '../../db/schema';
import { migrateFromLegacy, MIGRATION_KEY, PORTFOLIO_KEY, type MigrationReport } from '../../db/migrate';
import { Icon } from '../Icon';
import { indexInfo } from '../../lib/api';

const SITE_LANGS = [
  ['de', 'Deutsch'],
  ['en', 'English'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['it', 'Italiano'],
];

export function SettingsSheet() {
  const open = useUi((s) => s.sheet === 'settings');
  const openSheet = useUi((s) => s.openSheet);
  const { settings, update } = useSettings();
  const [storage, setStorage] = useState<string>('');
  const [migration, setMigration] = useState<MigrationReport | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [indexDate, setIndexDate] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    navigator.storage
      ?.estimate?.()
      .then((e) => setStorage(e.usage != null ? `${(e.usage / 1024 / 1024).toFixed(1)} MB belegt` : ''))
      .catch(() => {});
    db.settings.get(MIGRATION_KEY).then((r) => setMigration((r?.value as MigrationReport) || null));
    indexInfo().then((i) => setIndexDate(i?.generated ? date(i.generated) : ''));
  }, [open]);

  const toggleLang = (code: string) => {
    const has = settings.collectLangs.includes(code);
    const next = has ? settings.collectLangs.filter((c) => c !== code) : [...settings.collectLangs, code];
    if (next.length) update({ collectLangs: next });
  };

  const doExport = async () => {
    const file = await exportBackup();
    download(`holoscan-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(file), 'application/json');
    await update({ lastBackupAt: Date.now() });
    toast({ text: 'Backup gespeichert', tone: 'gain' });
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setPlan(planImport(await f.text()));
    } catch (e) {
      toast({ text: (e as Error).message, tone: 'loss' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const runImport = async (mode: 'merge' | 'replace') => {
    if (!plan) return;
    try {
      const r = await applyImport(plan, mode);
      toast({ text: `${r.added} Karte(n) importiert${r.skipped ? `, ${r.skipped} übersprungen` : ''}`, tone: 'gain' });
      setPlan(null);
    } catch (e) {
      toast({ text: (e as Error).message, tone: 'loss' });
    }
  };

  const wipe = async () => {
    if (
      !confirm(
        'Wirklich alles löschen? Sammlung, Merkliste, Verlauf und Einstellungen werden entfernt. Vorher ein Backup speichern!',
      )
    )
      return;
    await db.transaction(
      'rw',
      [db.collection_items, db.photos, db.scan_history, db.price_points, db.price_cache, db.scan_queue, db.ai_usage],
      async () => {
        await Promise.all([
          db.collection_items.clear(),
          db.photos.clear(),
          db.scan_history.clear(),
          db.price_points.clear(),
          db.price_cache.clear(),
          db.scan_queue.clear(),
          db.ai_usage.clear(),
        ]);
      },
    );
    // Der Übernahme-Merker bleibt bestehen, sonst kämen die Daten der alten Version beim nächsten Start zurück.
    await db.settings.delete(PORTFOLIO_KEY);
    toast({ text: 'Alles gelöscht' });
  };

  const remerge = async () => {
    const r = await migrateFromLegacy(db, { force: true });
    setMigration(r);
    toast({
      text: r?.found ? `${r.items} Karte(n) aus der alten Version ergänzt` : 'Keine Daten der alten Version gefunden',
    });
  };

  return (
    <Sheet open={open} title="Einstellungen" onClose={() => openSheet(null)} full>
      <div className="stack settings">
        <section className="panel stack">
          <h3 className="h-sm">Sammel-Sprachen</h3>
          <p className="faint small">Bestimmt, welche Kartenindexe geladen werden.</p>
          <div className="row wrap">
            {LANGS.map((l) => (
              <button
                key={l.code}
                className="chip"
                aria-pressed={settings.collectLangs.includes(l.code)}
                onClick={() => toggleLang(l.code)}
              >
                {l.flag} {l.label}
              </button>
            ))}
          </div>
        </section>

        <section className="panel stack">
          <h3 className="h-sm">Karten & Preise</h3>
          <label className="field">
            <span>Vorauswahl Zustand</span>
            <select
              className="input"
              value={settings.condition}
              onChange={(e) => update({ condition: Number(e.target.value) })}
            >
              {CONDITIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.short} – {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Sprache der Cardmarket-Seite</span>
            <select className="input" value={settings.siteLang} onChange={(e) => update({ siteLang: e.target.value })}>
              {SITE_LANGS.map(([c, l]) => (
                <option key={c} value={c}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <Toggle
            label="TCGplayer-Preis (USD) zusätzlich zeigen"
            checked={settings.showUSD}
            onChange={(v) => update({ showUSD: v })}
          />
          <Toggle label="Vibration" checked={settings.haptics} onChange={(v) => update({ haptics: v })} />
          {settings.conditionFactors && (
            <button className="btn btn-sm" onClick={() => update({ conditionFactors: null })}>
              Eigene Zustands-Abschläge zurücksetzen
            </button>
          )}
        </section>

        <section className="panel stack">
          <h3 className="h-sm">KI-Leser</h3>
          <p className="faint small">
            Gemini mit deinem eigenen Schlüssel als Notlösung bei schwierigen Karten – kommt mit dem Scanner-Update.
            {settings.openrouterKey
              ? ' Dein bisheriger OpenRouter-Schlüssel bleibt gespeichert und wird weiter genutzt.'
              : ''}
          </p>
        </section>

        <section className="panel stack">
          <h3 className="h-sm">Daten</h3>
          <div className="row wrap">
            <button className="btn" onClick={doExport}>
              <Icon name="download" /> Backup (JSON)
            </button>
            <button
              className="btn"
              onClick={async () =>
                download(
                  `holoscan-sammlung-${new Date().toISOString().slice(0, 10)}.csv`,
                  await exportCsv(),
                  'text/csv;charset=utf-8',
                )
              }
            >
              <Icon name="download" /> Excel (CSV)
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" /> Import
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </div>
          {plan && (
            <div className="panel stack" role="alert">
              <p style={{ margin: 0 }}>
                {plan.items.length} Karte(n) gefunden{plan.skipped ? `, ${plan.skipped} fehlerhaft` : ''}
                {plan.legacy ? ' (Backup der alten Version)' : ''}.
              </p>
              <div className="row wrap">
                <button className="btn btn-primary btn-sm" onClick={() => runImport('merge')}>
                  Ergänzen
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  disabled={!plan.items.length}
                  onClick={() => confirm('Aktuelle Sammlung durch das Backup ersetzen?') && runImport('replace')}
                >
                  Ersetzen
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setPlan(null)}>
                  Abbrechen
                </button>
              </div>
            </div>
          )}
          <label className="field">
            <span>Backup-Erinnerung</span>
            <select
              className="input"
              value={settings.backupReminderDays ?? 0}
              onChange={(e) => update({ backupReminderDays: Number(e.target.value) || null })}
            >
              <option value={0}>Aus</option>
              <option value={7}>Wöchentlich</option>
              <option value={30}>Monatlich</option>
            </select>
          </label>
          <p className="faint small">
            {settings.lastBackupAt ? `Letztes Backup: ${date(settings.lastBackupAt)}` : 'Noch kein Backup gespeichert.'}{' '}
            {storage && `· ${storage}`}
          </p>
          {migration?.found && (
            <p className="faint small">
              Aus der alten Version übernommen: {migration.items} Karte(n), {migration.history} Scans, am{' '}
              {date(migration.at)}.{' '}
              <button className="link" onClick={remerge}>
                Erneut prüfen
              </button>
            </p>
          )}
          <button className="btn btn-danger" onClick={wipe}>
            <Icon name="trash" /> Alles löschen
          </button>
        </section>

        <section className="panel stack small faint">
          <p style={{ margin: 0 }}>
            HoloScan ist ein inoffizielles Fanprojekt, nicht verbunden mit The Pokémon Company, Nintendo, Creatures,
            GAME FREAK, Cardmarket oder TCGdex. Alle Preise ohne Gewähr, keine Anlageberatung.
          </p>
          <p style={{ margin: 0 }}>
            Datenschutz: Keine Anmeldung, keine Analytics. Deine Sammlung bleibt auf diesem Gerät. Die App ruft
            Kartendaten direkt bei TCGdex ab (dabei sieht TCGdex deine IP-Adresse); das Hosting (GitHub Pages)
            protokolliert Zugriffe. Kartenindex vom {indexDate || '–'}.
          </p>
        </section>
      </div>
    </Sheet>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden />
    </label>
  );
}
