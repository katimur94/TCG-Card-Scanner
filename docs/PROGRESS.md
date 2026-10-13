# Fortschritt: Umbau von HoloScan nach `docs/SPEC.md`

Der Umbau läuft auf dem Branch `claude/trusting-ramanujan-rxy6ep`. Veröffentlicht wird erst, wenn der neue Scanner fertig ist (siehe „Freigabe“).

## M1 Fundament – erledigt (13.10.2026)

### Bestehende Nutzerdaten bleiben erhalten
- Die App läuft weiter unter derselben Adresse (GitHub Pages). Damit bleiben IndexedDB und Service Worker dieselben.
- Beim ersten Start übernimmt `src/db/migrate.ts` aus der alten Datenbank `holoscan`:
  - Sammlung, Merkliste und Preisalarme
  - eigene Scan-Fotos
  - Scan-Verlauf, eigene Preisverläufe und Wertverlauf
  - Einstellungen, auch einen eingetragenen OpenRouter-Schlüssel
- Die alte Datenbank wird nur gelesen und nie verändert.
- Die Übernahme läuft genau einmal und ist idempotent. Unter „Einstellungen → Erneut prüfen“ lässt sie sich erneut anstoßen und ergänzt dann nur, was fehlt.
- „Alles löschen“ holt die alten Daten nicht zurück.
- Der neue Service Worker liegt wieder unter `sw.js` und übernimmt den alten sofort.
- Die Caches für Bildmodell, Bibliotheken und API behalten ihre Namen. Das ca. 30 MB große Bildmodell muss deshalb nicht neu geladen werden.
- Backups der alten Version (JSON v1) lassen sich importieren.

### Neu
- **Design „Die Vitrine“**:
  - samtschwarzer Hintergrund mit Holo-Akzent
  - Schriften Unbounded, Figtree und JetBrains Mono, selbst gehostet
  - Gewinn und Verlust immer mit ▲/▼
- **Karte als Objekt**:
  - 3D-Kippen per Finger oder Gyroskop, auf iOS nach einem Tipp
  - Holo-Glanz je nach Seltenheit
  - Antippen dreht die Karte zum **Kurszettel**: Trendpreis, Kursverlauf, Ø 1/7/30 Tage, Tiefstpreis, Einstand, Gewinn
  - `prefers-reduced-motion` schaltet Kippen und Glanz ab
- **Drei Orte**:
  - Scanner als Startbildschirm mit Sammlungswert und Tagesänderung
  - Binder: vom Scanner nach oben wischen oder auf den Knopf tippen
  - Karte: als Ansicht über allem
  - Zurück geht per Wischen nach unten oder per Knopf.
- **Binder**:
  - 3×3-Taschen, seitlich blättern
  - Mengen-Badge, wenn mehrere Posten dieselbe Karte betreffen
  - Ränder glühen grün oder rot je nach Entwicklung seit dem Kauf
  - Depot-Leiste mit Gesamtwert, Investiert und Gewinn in € und %
  - Sortieren nach Wert, Gewinn, Set oder „Zuletzt hinzugefügt“
  - Filtern nach Sprache, Set, Seltenheit, im Plus oder im Minus
  - Suche über Name und Nummer
- **Depot**:
  - Wertverlauf, Top 5 und Flop 5 seit dem Kauf
  - Karten ohne Preis werden separat gezählt und nicht als 0 € gewertet
- **Posten**:
  - Kaufpreis pro Stück, Herkunft (Kauf, Booster, Tausch, Geschenk), Kaufdatum, Notiz
  - Booster-Rechner: Packpreis ÷ Karten
  - Jede Aktion lässt sich 5 Sekunden lang rückgängig machen.
  - Geld wird durchgehend in ganzen Cent gespeichert.
- **Zustand**: Leiste M, NM, EX, GD, LP, PL, PO. Gedrückt halten zeigt eine Kurzerklärung.
- Kauf-Check, Cardmarket-Links je Zustand und Merkliste mit Preisalarm aus der alten Version bleiben erhalten.
- **Sicherheit**:
  - Der Backup-Import prüft jeden Eintrag streng und schreibt alles in einer Transaktion. Ein kaputtes Backup kann nichts mehr löschen und keinen Code einschleusen.
  - Kein API-Schlüssel steckt mehr im ausgelieferten Code.

### Daten-Pipeline
- Die erzeugten Daten liegen im Branch `data` als einzelner Commit, der ersetzt wird. Er wird nur gepusht, wenn sich etwas geändert hat.
- Damit ist der Fehler behoben, durch den der tägliche Lauf das Montags-Update von Karten- und Bildindex sofort wieder überschrieb.
- **Neu: tägliche Preis-Historie** aus Cardmarkets offiziellem Preis-Guide (`scripts/build-price-history.mjs`):
  - rund 80.000 Produkte, aufgeteilt auf 512 Dateien
  - ab 90 Tagen ein Wert pro Woche
  - Der Kursverlauf beginnt mit dem ersten Lauf und wächst mit jedem Tag.
- Bei jedem Push laufen Lint, Typecheck, Unit-Tests, Build und Browser-Tests. Veröffentlicht wird nur vom Standard-Branch.

### Tests
- `npm test`: 23 Unit-Tests
  - Übernahme der alten Daten, geschrieben mit dem **originalen** alten Speichermodul
  - Bewertung und Depot
  - Binder
  - Backup und Import
  - Preis-Historie: Pipeline und App müssen dasselbe Format lesen
- `npm run e2e`: 4 Browser-Tests
  - **Update-Test**: Die alte App läuft mit ihrem Service Worker und speichert Karten. Dann wird am selben Origin die neue App ausgeliefert. Geprüft wird, dass die Sammlung übernommen ist, die alte Datenbank unverändert bleibt und es keine doppelte Übernahme gibt.
  - Smoke-Tests: Suche → Karte → Kurszettel → Sammlung → Binder → Depot, Rückgängig, Backup
  - Jeder Test prüft außerdem, dass nichts über den Bildschirmrand ragt.

### Screenshots (Pixel 7)
Kartenbilder sind in den Tests Platzhalter, weil die TCGdex-Antworten aus festen Testdaten kommen.

| | |
|---|---|
| ![Alte Version](screenshots/00-alte-version.jpg) | ![Nach dem Update](screenshots/01-binder-nach-update.jpg) |
| ![Scanner](screenshots/02-scanner-start.jpg) | ![Suche](screenshots/03-suche.jpg) |
| ![Karte](screenshots/04-karte.jpg) | ![Kurszettel](screenshots/05-kurszettel.jpg) |
| ![Kaufpreis](screenshots/06-kaufpreis.jpg) | ![Binder](screenshots/07-binder.jpg) |
| ![Depot](screenshots/08-depot.jpg) | ![Einstellungen](screenshots/09-einstellungen.jpg) |

### Kennzahlen
- App-Bundle: 175 KB gzip (Budget laut Spec: 400 KB)
- Vorab-Cache: 0,95 MB

## Freigabe
**Noch nicht veröffentlichen.** Der Branch ersetzt die alte App komplett, und die alte App hat einen funktionierenden Kamera-Scanner. Würde M1 jetzt live gehen, könnten die Nutzer vorübergehend nicht mehr scannen. Vorschlag: zuerst M2 (Galerie-Scan) und M3 (Live-Scan) umsetzen, dann alles zusammen als großes Update veröffentlichen.

## Nächste Schritte
- **M2 Galerie-Scan**:
  - Erkennung aus `legacy/js/vision.js`, `ocr.js` und `recognize.js` nach TypeScript in einen Web Worker übertragen
  - Stapel mit Triage: rechts = Sammlung, links = verwerfen, oben = korrigieren
  - Kalibrier-Testset aus echten Fotos
- **M3 Live-Scan**:
  - automatisches Auslösen bei ruhigem und scharfem Bild
  - mehrere Karten pro Bild
  - Doppel-Schutz und Haptik
- **M4**: Gemini-Fallback mit Modell-Kette und Limit-Anzeige
- **M5**: Feinschliff

## Offene Punkte
- Nutzungsbedingungen des Cardmarket-Preis-Guides vor einer breiteren Veröffentlichung klären (siehe `FINDINGS.md`).
- Der eingebaute OpenRouter-Schlüssel ist entfernt. Der Schlüssel im GitHub-Secret `OPENROUTER_KEY` war öffentlich lesbar und sollte bei OpenRouter **widerrufen** werden.
