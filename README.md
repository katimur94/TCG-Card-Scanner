# HoloScan – Karten-Scanner

Sammelkarten in jeder Sprache erkennen, den **Cardmarket-Wert** sehen und die Sammlung wie ein Aktiendepot verfolgen. HoloScan ist eine installierbare Web-App (PWA): kein Konto, keine Anmeldung, alles bleibt auf dem Gerät, und nach dem ersten Laden funktioniert sie auch offline.

**Live:** https://katimur94.github.io/TCG-Card-Scanner/

> **Umbau in Arbeit:** HoloScan wird nach [`docs/SPEC.md`](docs/SPEC.md) neu gebaut, mit dem Design „Die Vitrine“. Der Stand steht in [`docs/PROGRESS.md`](docs/PROGRESS.md), Entscheidungen und Abweichungen in [`docs/FINDINGS.md`](docs/FINDINGS.md). Bestehende Sammlungen werden beim Update automatisch übernommen. Die alte Version liegt unter [`legacy/`](legacy/).

## Funktionen (neue Version)

- **Scanner als Startbildschirm** mit Sammlungswert und Tagesänderung:
  - löst automatisch aus, sobald Karten ruhig und scharf im Bild liegen
  - bis zu 9 Karten pro Bild (ganze Binderseite), Doppel-Schutz
  - die erkannten Karten fliegen auf einen **Stapel**
- **Galerie:** beliebig viele Fotos auf einmal, Abarbeitung in einer Warteschlange.
- **Stapel sortieren:**
  - rechts wischen = in die Sammlung (danach nur die Kaufpreis-Frage)
  - links wischen = verwerfen
  - nach oben = korrigieren
  - Ist die Erkennung unsicher, fragt die App mit höchstens 3 Vorschlägen nach, statt zu raten.
- **Erkennung auf dem Gerät:** Bildsuche (DINOv2), Texterkennung nur bei Bedarf, Sprache am Kartenbild. Optional **Gemini** mit eigenem Schlüssel als Notfall. Jede KI-Antwort wird gegen den Katalog geprüft.
- **Karte als Objekt:**
  - 3D-Kippen per Finger oder Gyroskop, Holo-Glanz je Seltenheit
  - Antippen dreht die Karte zum **Kurszettel**: Trendpreis, Kursverlauf, Ø 1/7/30 Tage, Tiefstpreis, dein Einstand, dein Gewinn
- **Binder:**
  - 3×3-Taschen zum Blättern
  - Ränder glühen grün oder rot je nach Entwicklung seit dem Kauf
  - Depot-Leiste mit Gesamtwert, Investiert und Gewinn
- **Depot:** Wertverlauf, Top 5 und Flop 5, Karten ohne Preis separat gezählt
- **Posten:** Kaufpreis, Herkunft (Kauf, Booster, Tausch, Geschenk), Zustand M–PO, Notiz, Rückgängig
- **Merkliste** mit Preisalarm, **Kauf-Check** für Flohmarkt-Angebote
- **Suche** nach Name, Set oder Nummer (`Glurak`, `4/102`, `MEW 25`), offline über den Kartenindex
- **Export und Import** als JSON-Backup oder CSV, mit Backup-Erinnerung

## Entwicklung

Node.js 22. Die Kamera funktioniert nur über `https://` oder `localhost`.

```bash
npm install
npm run dev          # Entwicklungsserver
npm run build        # Produktions-Build nach dist/
npm test             # Unit-Tests (Vitest)
npm run e2e          # Browser-Tests (Playwright), braucht vorher npm run build
npm run lint && npm run typecheck
```

Datenskripte (laufen auch automatisch im Workflow):

```bash
node scripts/build-index.mjs           # Kartenindex aus TCGdex (public/data/)
node scripts/build-cardmarket.mjs      # Ersatzpreise aus Cardmarkets Preis-Guide
node scripts/build-price-history.mjs   # tägliche Preis-Historie
python3 scripts/build-vision-index.py  # Bildindex (pip install onnxruntime opencv-python-headless numpy)
```

## Aufbau

```
src/db/          Datenbank (Dexie) und Übernahme der Daten aus der alten Version
src/lib/         Kartenindex, TCGdex, Preise, Sprachen, Kauf-Check (aus der alten Version übertragen)
src/domain/      Sammlung, Bewertung/Depot, Binder, Backup, Preis-Historie
src/state/       Einstellungen und Navigation (Zustand)
src/ui/          Scanner, Binder, Karte, Blätter, Karten-Komponente
src/sw.ts        Service Worker (ersetzt den alten unter sw.js)
public/data/     Offline-Kartenindex, Bildindex, Ersatzpreise (generiert)
public/models/   Bildmodell (DINOv2-small, int8)
scripts/         Datenskripte
e2e/             Browser-Tests inkl. Update-Test alte -> neue Version
legacy/          alte Version (nicht veröffentlicht)
```

## Veröffentlichung

Der Workflow `.github/workflows/pages.yml` prüft jeden Push und veröffentlicht den Standard-Branch auf GitHub Pages. Täglich schreibt er Ersatzpreise und Preis-Historie fort, montags auch Kartenindex und Bildindex. Die erzeugten Daten liegen im Branch `data`.

Einmalig einrichten: Repository → **Settings → Pages → Source: GitHub Actions**.

## Datenquellen und Lizenzen

- Kartendaten, Bilder und Preise: [TCGdex](https://tcgdex.dev) (Cardmarket-Preis-Guide, TCGplayer)
- Preis-Guide und Produktkatalog: öffentliche Dateien von [Cardmarket](https://www.cardmarket.com)
- Texterkennung: [Tesseract.js](https://github.com/naptha/tesseract.js), Apache-2.0
- Bildmodell: [DINOv2](https://github.com/facebookresearch/dinov2), Apache-2.0
- Schriften: Unbounded, Figtree, JetBrains Mono (SIL Open Font License, selbst gehostet)

HoloScan ist ein inoffizielles Fanprojekt und nicht verbunden mit The Pokémon Company, Nintendo, Creatures, GAME FREAK, Cardmarket oder TCGdex. Alle Preise ohne Gewähr, keine Anlageberatung.
