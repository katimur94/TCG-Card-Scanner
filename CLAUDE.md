# HoloScan – Projektregeln

HoloScan wird nach `docs/SPEC.md` (Arbeitstitel „HOLO“, Design „Die Vitrine“) umgebaut. Die Spec ist die
Quelle der Wahrheit; Abweichungen stehen begründet in `docs/FINDINGS.md`.

## Unverhandelbar

- **Bestehende Nutzerdaten dürfen nie verloren gehen.** Die App läuft weiter unter
  `https://katimur94.github.io/TCG-Card-Scanner/` (gleicher Origin = gleiche IndexedDB). Kein Umzug auf eine
  andere Domain ohne Export/Import-Weg. Die alte Datenbank `holoscan` (v1) wird nur gelesen, nie gelöscht
  oder verändert; die Migration in die neue Datenbank ist idempotent und getestet (`src/db/migrate.ts`).
- Der neue Service Worker liegt unter demselben Pfad `sw.js` und übernimmt den alten sauber
  (`skipWaiting`, versteht die alte Nachricht `'SKIP_WAITING'`).
- Lokal zuerst: kein eigener Server, kein Konto, keine Analytics, keine Tracker.
- Geldbeträge in der Datenbank immer als ganze Cent (`*Cents`). Anzeige in Euro.
- Oberfläche Deutsch (Texte zentral in `src/i18n/de.ts`).
- Keine geschützten Marken im Namen/Logo (kein „Pokémon“, keine Pokéball-Symbole).
- Kein Scraping. Nur offizielle Dateien (Cardmarket-Preis-Guide/Produktkatalog auf
  `downloads.s3.cardmarket.com`) und die TCGdex-API.
- Kartenbilder nie ins Repo oder auf einen eigenen Server; angezeigt wird vom TCGdex-CDN.
- Erkennung nie raten: lieber nachfragen als eine falsche Karte zeigen. KI-Antworten werden immer gegen
  den Katalog (Set + Nummer) geprüft.
- Kein API-Schlüssel im ausgelieferten Code. KI nur mit dem Schlüssel des Nutzers.

## Technik

- Vite + React + TypeScript, Zustand (State), Dexie (IndexedDB), Framer Motion (Gesten), eigene SVG-Kurslinie.
- Statische Daten unter `public/data/` (vom Workflow erzeugt), Bildmodell unter `public/models/`.
- `npm run dev` · `npm run build` · `npm test` (Vitest) · `npm run e2e` (Playwright) · `npm run lint`.
- Vor jedem Push: `npm run lint && npm run typecheck && npm test && npm run build`.
