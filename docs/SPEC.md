# Karten-App – Spec & Claude-Code-Prompt

Oct 13, 2026 · @Timur

## Überblick

Arbeitstitel **HOLO**: eine PWA, die Pokémon-Karten in jeder Sprache per Kamera erkennt, ihren Cardmarket-Wert zeigt und die Sammlung wie ein Aktiendepot verfolgt. Kernversprechen: Karte hinhalten, fertig. Kein Raster, kein Tippen, kein Konto.

**Für wen:** Sammler mit gemischten Sammlungen (Englisch, Deutsch, Japanisch und weitere), die wissen wollen, was ihre Karten wert sind und ob sich ein Kauf gelohnt hat.

**Die drei Grundsätze:**

1. **Erkennen ohne KI-Zwang.** Die Erkennung läuft auf dem Gerät per Bild-Fingerabdruck (Perceptual Hash). Gemini ist nur der Notfall-Fallback, mit dem eigenen API-Key des Nutzers.
2. **Lokal zuerst.** Die Sammlung liegt auf dem Gerät (IndexedDB). Keine Pflicht-Anmeldung, funktioniert offline.
3. **Null Laufkosten.** Statische Daten (Kartenkatalog, Hash-Index, Preise) baut eine nächtliche GitHub Action. Gehostet wird statisch auf Vercel.

**Abgrenzung v1:** Keine gegradeten Karten (PSA etc.), keine versiegelten Produkte, kein Handel zwischen Nutzern, keine Cloud-Synchronisation.

## Design-Konzept: „Die Vitrine“

Die App ist eine Vitrine, kein Formular. Der Bildschirm ist dunkel wie Samt, die Karten sind das einzig Bunte. Es gibt keine Tab-Leiste und keine Menüs. Bedient wird mit Gesten, wie man echte Karten anfasst.

### Die vier Ideen, die es so noch nicht gibt

1. **Kamera ist der Startbildschirm.** Die App öffnet direkt im Scanner. Oben steht nur eine Zeile: Sammlungswert und Tagesänderung (z. B. „1.284 € ▲ 3,2 %“).
2. **Karten springen aus dem Livebild.** Sobald eine Karte erkannt ist, löst sich ihr entzerrtes Bild aus dem Kamerabild und fliegt als 3D-Karte nach unten auf einen gefächerten **Stapel**, mit kurzem Haptik-Feedback. Mehrere Karten im Bild springen nacheinander.
3. **Umdrehen zeigt den Wert.** Ein Tipp dreht jede Karte um. Die Rückseite ist ein **Kurszettel**: Trendpreis groß, Kursverlauf als Linie, 1/7/30-Tage-Schnitt, Tiefstpreis, dein Einstand und dein Gewinn.
4. **Das Depot leuchtet.** Im Binder glühen die Kartenränder dezent grün oder rot, je nachdem ob die Karte seit dem Kauf gestiegen oder gefallen ist. Ein Blick auf eine Seite zeigt die Performance ohne eine Zahl zu lesen.

### Navigation: nur drei Orte

- **Scanner** (Mitte, Start): Livebild, Galerie-Knopf, Stapel unten.
- **Binder** (vom Scanner nach oben wischen): echte Album-Optik mit 3×3-Taschen, Seiten blättern durch seitliches Wischen. Ganz oben die **Depot-Leiste** mit Gesamtwert, Investiert, Gewinn in € und %.
- **Karte** (Tippen auf eine Karte, egal wo): groß, kippbar, umdrehbar.

Zurück geht immer per Wischen nach unten.

### Der Stapel: Sortieren wie beim Kartenausteilen

Tippen auf den Stapel öffnet die Triage, eine Karte nach der anderen:

- **Nach rechts wischen** = in die Sammlung. Danach erscheint nur die Kaufpreis-Frage.
- **Nach links wischen** = verwerfen (Fehlerkennung oder nur Preis gecheckt).
- **Nach oben wischen** = Details und Korrektur (andere Variante, andere Sprache, anderes Set).
- Jede Aktion hat 5 Sekunden lang einen „Rückgängig“-Hinweis.

### Eingaben auf das Minimum

- **Kaufpreis:** großes Zahlenfeld „Was hast du bezahlt?“ mit Schnellwahl *Aus Booster gezogen*, *Getauscht*, *Geschenkt* (= 0 €, Herkunft wird gespeichert). Bei „Booster“ optional Packpreis ÷ Anzahl Karten.
- **Zustand:** eine Leiste mit den Cardmarket-Stufen M, NM, EX, GD, LP, PL, PO. Vorauswahl NM. Gedrückt halten zeigt eine Kurzerklärung.
- **Sprache und Variante:** werden erkannt und als Flagge bzw. Chip auf der Karte gezeigt. Nur wenn die Erkennung unsicher ist, kommt eine Auswahl mit max. 3 Optionen.
- **Erster Scan ohne Onboarding.** Keine Anmeldung, kein Key, keine Erklär-Slides. Hinweise erscheinen erst, wenn sie gebraucht werden.

### Karten als echte Objekte

- 3D-Kippen mit Holo-Glanz, gesteuert über Gyroskop (DeviceOrientation, auf iOS nach einem Tipp zur Freigabe) oder den Finger.
- Glanzstärke nach Seltenheit: Common matt, Holo schimmernd, Secret/Illustration Rare mit Regenbogen-Effekt.
- `prefers-reduced-motion` schaltet Kippen und Glanz ab.

### Visuelle Sprache

| Element | Festlegung |
| --- | --- |
| Hintergrund | Samt-Schwarz #0B0B10 mit leichter Vignette, v1 nur dunkel |
| Akzent | gedämpfter Holo-Verlauf (konisch), nur für die wichtigste Aktion und den Scan-Rahmen |
| Gewinn / Verlust | #3DDC97 / #FF5C7A, immer zusätzlich mit ▲/▼ (nicht nur Farbe) |
| Überschriften | Unbounded (Google Fonts) |
| Fließtext | Figtree (Google Fonts) |
| Zahlen und Preise | JetBrains Mono mit Tabellenziffern |
| Ecken | 14 px wie echte Karten, Karten selbst im Format 63 × 88 mm |
| Icons | eigenes, schlichtes Linien-Set |

**Tabu:** Pokéball-Symbole, Pokémon-Logos, offizielle Schriften oder „Pokémon“ im App-Namen. Das sind geschützte Marken.

## Funktionen im Detail

Sechs Bereiche: Scannen, Erkennung, Preise, Sammlung, Depot, Gemini-Key mit Limits.

### 1. Scannen

- **Live-Kamera** (Rückkamera, mind. 1080p). Löst automatisch aus, sobald eine Karte ca. 0,5 s ruhig und scharf im Bild ist. Lage und Winkel sind egal, die Karte wird auf dem Gerät gerade gezogen.
- **Mehrere Karten pro Bild**, bis 9. Damit lässt sich eine ganze 3×3-Binderseite auf einmal scannen.
- **Doppel-Schutz:** Bleibt dieselbe Karte im Bild, wird sie nicht erneut erkannt. Hält man eine zweite gleiche Karte hin, fragt die App „Nochmal hinzufügen?“.
- **Galerie:** beliebig viele Bilder auf einmal auswählen, je Bild mehrere Karten. Abarbeitung in einer Warteschlange, Fortschritt am Stapel.
- **Taschenlampe** als Knopf. Bei starker Spiegelung (Hülle, Holo) kommt der Hinweis „leicht kippen“.
- **Offline-fähig:** Erkennung läuft mit dem gecachten Index auch ohne Netz. Preise werden nachgeladen, sobald wieder Netz da ist.

### 2. Erkennung

Jede erkannte Karte liefert: Katalog-ID, Region (International / Japan), Sprache, mögliche Varianten und einen Sicherheitswert.

1. **Bild-Fingerabdruck** (pHash + dHash) gegen den Index. Eindeutiger Treffer = fertig.
2. **Nachprüfung** bei knappen Treffern: Bildvergleich (NCC) gegen die 5 besten Kandidaten.
3. **Sprache** über das Namensfeld: Abgleich mit den Namensfeld-Fingerabdrücken je Sprache, sonst OCR (Tesseract.js), sonst Gemini.
4. **Gemini-Fallback**, nur wenn ein Key hinterlegt ist und Schritt 1–3 unsicher bleiben.
5. **Manuelle Auswahl** als letzte Stufe: max. 3 Kandidaten mit Bild, oder Suche nach Name, Set oder Nummer (z. B. „123/165“).

Varianten wie Reverse Holo oder 1st Edition haben oft dasselbe Referenzbild. Gibt es für eine Karte mehrere Varianten, wählt der Nutzer per Chip, vorbelegt mit der häufigsten.

### 3. Preise (Kurszettel)

- **Oben:** Trendpreis, Durchschnitt 1/7/30 Tage, Tiefstpreis, Stand-Datum. Quelle: Cardmarket-Preis-Guide.
- **Kursverlauf:** Linie aus der eigenen täglichen Preis-Historie. Die Historie beginnt mit dem Start der Pipeline und wächst mit der Zeit.
- **Hinweis in der App:** Die Guide-Werte sind Durchschnitte über alle Sprachen und Zustände einer Karte. Japanische Karten haben bei Cardmarket eigene Produkte.
- **Angebote nach Zustand (NM, EX, GD …):** in v1 ein Knopf, der die Cardmarket-Produktseite öffnet, möglichst mit vorgewählter Sprache und Mindestzustand. Dahinter liegt eine **Preis-Provider-Schnittstelle**, damit später eine Quelle mit Einzelangeboten angeschlossen werden kann.

### 4. Sammlung (Binder)

- **Ein Eintrag** = ein Exemplar oder ein Posten: Karte, Sprache, Variante, Zustand, Menge, Kaufpreis pro Stück, Kaufdatum, Herkunft (Kauf / Booster / Tausch / Geschenk), Notiz, optional eigenes Foto.
- Gleiche Karte mehrfach mit unterschiedlichen Kaufpreisen = mehrere Posten, im Binder als eine Tasche mit Mengen-Badge.
- **Sortieren:** Wert, Gewinn, Set, zuletzt hinzugefügt. **Filtern:** Sprache, Set, Seltenheit, im Plus / im Minus. **Suche** über Name und Nummer.

### 5. Depot

- Gesamtwert (Trendpreis × Menge), investierte Summe, Gewinn in € und %.
- Wertverlauf der ganzen Sammlung über die Zeit, berechnet aus der Preis-Historie.
- Top 5 und Flop 5 seit Kauf.
- Karten ohne Preis werden separat gezählt und nicht als 0 € gewertet.

### 6. Gemini-Key und Limits

- **Optional**, in den Einstellungen. Kurzanleitung mit Link zu aistudio.google.com/apikey, danach ein Test-Aufruf mit „Key funktioniert“.
- Der Key wird **nur auf dem Gerät** gespeichert. Die App ruft Gemini direkt aus dem Browser auf, kein eigener Server.
- **Modell-Kette (einstellbar):** Gemini 3.5 Flash Lite → 3.1 Flash Lite → 3.8 Flash für schwierige Fälle. Beim Speichern des Keys prüft die App über die Modell-Liste der API, welche Modelle es wirklich gibt.
- **Limit-Anzeige:** Da Google die Restmenge nicht per API liefert, zählt die App selbst mit, pro Modell und Tag. Reset um Mitternacht pazifischer Zeit (9 Uhr deutscher Zeit). Anzeige z. B. „Heute: 12 / 500“. Die Grenzwerte sind vorbelegt und änderbar.
- Bei Fehler 429 wird das Modell für den Tag als voll markiert, die Kette springt zum nächsten. Link „Genaue Limits bei Google ansehen“.
- Hinweis beim Einrichten: Im kostenlosen Tarif darf Google Eingaben zur Produktverbesserung nutzen. Die App schickt nur Kartenausschnitte.

### Einstellungen

Sammel-Sprachen (bestimmt, welche Indexe geladen werden), Gemini-Key und Modell-Kette, Export und Import (JSON und CSV), Backup-Erinnerung, Speicherverbrauch, „Alles löschen“. Währung in v1 nur Euro.

## Technik

Die App ist eine rein statische PWA. Alles Rechenintensive passiert entweder einmal nachts in einer GitHub Action (Katalog, Hash-Index, Preise) oder auf dem Gerät (Erkennung, Sammlung).

### Stack

- **Frontend:** Vite, React, TypeScript, PWA mit Service Worker (vite-plugin-pwa), Zustand für den State, Dexie für IndexedDB, Framer Motion für Gesten und Animationen, eine schlanke Chart-Bibliothek (z. B. uPlot) für Kursverläufe.
- **Bildverarbeitung:** Web Worker mit OffscreenCanvas. Entzerrung in reinem Canvas-JS (Kanten → Linien → Ecken → Homographie), nach dem Vorbild von Rarebox (MIT-Lizenz, mit Quellenangabe übernehmbar). OpenCV.js (ca. 8 MB) nur, falls das nicht reicht.
- **Mehrere Karten pro Bild:** zuerst über Konturen und Kartenformat. Reicht das nicht, ein kleines YOLO-Modell mit einer Klasse „card“ über ONNX Runtime Web.
- **OCR:** Tesseract.js (Englisch, Deutsch, Japanisch), wird erst bei Bedarf geladen und nur auf das Namensfeld angewendet.
- **Hosting:** Vercel, rein statisch. Daten-Pipeline: GitHub Actions.

### Datenquellen

| Quelle | Wofür | Achtung |
| --- | --- | --- |
| TCGdex | Kartenkatalog und Bilder für den Hash-Index, alle Sprachen | Vollständigkeit je Sprache schwankt, Stand unter api.tcgdex.net/status |
| Cardmarket-Preis-Guide | Trend, Schnitt 1/7/30 Tage, Tiefstpreis | Bezugsweg und Nutzungsbedingungen noch klären (offener Punkt) |
| pokemontcgapi.com | Abgleich, Zuordnung zu Cardmarket-Produkten, Lückenfüller | Tarif und Bedingungen prüfen |
| pokemontcg.io | Fallback für englische Karten inkl. Cardmarket-Preis-Snapshot | nur Englisch |
| Gemini API | Fallback-Erkennung | nur mit Key des Nutzers |

### Daten-Pipeline (GitHub Action, jede Nacht)

1. **Katalog:** alle Sets und Karten aus TCGdex je Sprache holen → `data/catalog/{region}/{setId}.json` mit ID, Nummer, Namen je Sprache, Seltenheit, Varianten, Bild-URL je Sprache. Dazu `data/catalog/index.json` mit Set-Liste und Versionsnummer.
2. **Hash-Index:** nur für neue oder geänderte Karten die Bilder laden, auf 630 × 880 px normieren und Fingerabdrücke berechnen: pHash und dHash (je 64 Bit) für die ganze Karte und für den Artwork-Ausschnitt, dazu ein Namensfeld-Hash je Sprache. Ausgabe als kompaktes Binärformat je Region, Namensfelder je Sprache als eigene Datei. Die Bilder selbst werden weder gespeichert noch ausgeliefert. Größenbudget: unter 1,5 MB (gzip) je Region.
3. **Preise:** Cardmarket-Preis-Guide laden → `data/prices/latest.json` (Produkt-ID → trend, avg1, avg7, avg30, low) und die Tageswerte an die Historie je Set anhängen. Werte älter als 90 Tage auf Wochenwerte verdichten.
4. **Zuordnung:** Katalog-ID plus Variante ↔ Cardmarket-Produkt-ID in `data/mapping/cardmarket.json`. Abgleich über Set-Name, Nummer und Name, ergänzt durch pokemontcgapi.com. Manuelle Korrekturen in `data/mapping/overrides.json`, die immer gewinnen.
5. **Ausliefern:** Commit nur bei Änderungen, und zwar in einen eigenen Branch `data`, damit das Haupt-Repo nicht durch die tägliche Historie anwächst. Vercel deployt danach automatisch.

### Erkennungs-Pipeline (auf dem Gerät)

1. Kamerabild mit ca. 8 Bildern pro Sekunde in 720p an den Worker geben.
2. Kanten finden, Vierecke im Kartenformat suchen (Seitenverhältnis 0,716 ± 10 %).
3. **Auslösen**, wenn die Ecken über 5 Bilder weniger als 6 px wandern und die Schärfe (Laplace-Varianz) über der Schwelle liegt. Dann ein volles Foto (ImageCapture, sonst Videobild).
4. Jede Karte auf 630 × 880 px entzerren, Fingerabdruck berechnen, auch um 180° gedreht.
5. Gegen den Index suchen (Hamming-Abstand, beste 5).
6. **Entscheiden:** Abstand ≤ T1 und Vorsprung zum Zweiten ≥ T2 → Treffer. Sonst Nachprüfung per NCC, dann Gemini, dann manuelle Auswahl.
7. **Kalibrieren:** T1 und T2 an einem Testset aus echten Fotos einstellen (schlechtes Licht, Hüllen, Holo-Spiegelung, schräg). Ziel: null falsche Treffer im Testset. Lieber nachfragen als falsch erkennen.

&#91;embedded content: Erkennungs-Kaskade · 4 Stufen, jede gibt nur bei Unsicherheit weiter\]

Ziel: Die meisten Karten sind nach Stufe 1 fertig, ohne Netz und ohne Key. Jede weitere Stufe greift nur, wenn die vorige unsicher bleibt.

**Gemini-Aufruf:** Kartenausschnitt auf 1024 px verkleinert, JPEG. Antwort als strukturiertes JSON mit `region`, `language`, `name`, `set_code`, `number`, `variant`, `confidence`. Das Ergebnis wird immer gegen den Katalog geprüft (Set + Nummer). Der Name von Gemini allein reicht nie als Treffer.

### Datenmodell (IndexedDB)

| Tabelle | Felder |
| --- | --- |
| collection\_items | id, cardId, region, lang, variant, condition, qty, pricePaidCents, paidAt, origin, note, photoId, createdAt, updatedAt |
| photos | id, blob |
| scan\_queue | id, imageBlob, status, candidates, createdAt |
| price\_cache | cardmarketId, trend, avg1, avg7, avg30, low, asOf |
| ai\_usage | dayPacific, model, count, exhaustedUntil |
| settings | key, value (Sprachen, Modell-Kette, Limits, Key) |

Geldbeträge immer als ganze Cent. Katalog, Index und Preise liegen im Cache Storage des Service Workers.

### Schnittstellen

- `PriceProvider` mit `getGuide(card)` und optional `getOffers(card, filter)`. v1 implementiert nur den Preis-Guide, Einzelangebote kommen über einen späteren Provider.
- `RecognitionStage` als austauschbare Stufen (Hash, NCC, OCR, Gemini), jede liefert Kandidaten mit Sicherheitswert.
- `AiClient` mit Modell-Kette, Zähler und 429-Behandlung, unabhängig von der Oberfläche testbar.

## Anforderungen, Recht, Meilensteine

### Nicht-funktionale Anforderungen

| Thema | Ziel |
| --- | --- |
| Scan-Geschwindigkeit | Karte im Bild → Ergebnis in ≤ 1,5 s auf einem Mittelklasse-Android |
| App-Start | ≤ 2 s bei gecachter App, Gesten mit 60 fps |
| Größe | App-Bundle ≤ 400 KB gzip ohne nachgeladene Module, Index ≤ 1,5 MB je Region |
| Offline | Scannen, Binder und Depot funktionieren offline, Preise mit Stand-Datum |
| Plattformen | Chrome Android, Safari iOS 17+, Chrome/Edge am Desktop mit Webcam |
| Barrierefreiheit | Kontrast AA, jede Geste auch über einen sichtbaren Knopf erreichbar, Screenreader-Labels, reduzierte Bewegung respektieren |
| Sprache der Oberfläche | Deutsch zuerst, Übersetzungen vorbereitet (Englisch als zweite) |
| Datenschutz | Keine Analytics, keine Tracker, Key nur lokal, Export jederzeit |
| Tests | Unit-Tests für Hashing und Matching, Kalibrier-Testset als Fixture mit gemessener Trefferquote in der CI, Playwright-Smoke-Tests für die Kernabläufe |

### Recht

- **Marken:** kein „Pokémon“ im App-Namen oder Logo. Hinweis im Impressum: nicht verbunden mit The Pokémon Company, Nintendo oder Cardmarket.
- **Kartenbilder:** nicht selbst hosten. Angezeigt wird direkt vom TCGdex-CDN. Der Hash-Index enthält keine Bilder.
- **Cardmarket:** kein Scraping, nur offiziell bereitgestellte Daten. Bedingungen vor einer Veröffentlichung prüfen.
- **DSGVO:** Schriften selbst hosten statt über das Google-Fonts-CDN laden. Impressum und kurze Datenschutzerklärung (Hosting-Logs bei Vercel, direkte Aufrufe an TCGdex und optional Google).
- **Gemini:** Der Nutzer nutzt seinen eigenen Key. Hinweis auf die Datennutzung im kostenlosen Tarif.

### Meilensteine

1. **M1 Fundament:** Daten-Pipeline für Katalog, Preise und Zuordnung. Suche, Karten-Detail mit Kurszettel, Sammlung und Depot, noch ohne Scan. Danach ist die App schon nutzbar.
2. **M2 Galerie-Scan:** Hash-Index, Entzerrung, Matching, Stapel mit Triage, Kalibrier-Testset.
3. **M3 Live-Scan:** automatisches Auslösen, mehrere Karten pro Bild, Doppel-Schutz, Haptik.
4. **M4 Fallbacks:** Sprache per Namensfeld und OCR, Gemini-Fallback mit Modell-Kette und Limit-Anzeige.
5. **M5 Feinschliff:** Holo-Effekte, Binder-Blättern, Depot-Glühen, Animationen, PWA-Installation.

### Offene Punkte

- [ ] Cardmarket-Preis-Guide: offiziellen Bezugsweg, Datei-URL, Format und Nutzungsbedingungen klären. Laut Cardmarket-Doku ist der Preis-Guide seit Juni 2024 über die Website allgemein verfügbar.
- [ ] Abdeckung der Zuordnung TCGdex ↔ Cardmarket messen, vor allem bei japanischen und alten Sets.
- [ ] Bildabdeckung von TCGdex je Sprache messen, vor allem Deutsch und Japanisch.
- [ ] Nur privat oder öffentlich? Bestimmt Impressum, Hinweise und ob ein eigener Name gebraucht wird.
- [ ] Endgültiger App-Name.

## Prompt für Claude Code

Diese Spec als Markdown exportieren, als `docs/SPEC.md` ins neue Repo legen und dann diesen Prompt in Claude Code einfügen:

```text
Du baust HOLO: eine PWA, die Pokémon-Sammelkarten in jeder Sprache per Kamera erkennt, ihren Cardmarket-Wert zeigt und die Sammlung wie ein Aktiendepot verfolgt. Die vollständige Spezifikation steht in docs/SPEC.md. Lies sie komplett, bevor du irgendetwas anlegst. Sie ist die Quelle der Wahrheit.

Vorgehen:
1. Lies docs/SPEC.md. Lege eine CLAUDE.md mit den Projektregeln an (lokal zuerst, kein eigener Server, Geld in Cent, Oberfläche Deutsch, keine geschützten Marken).
2. Kläre zuerst die offenen Punkte, die M1 blockieren, und schreib die Ergebnisse nach docs/FINDINGS.md:
   - Cardmarket-Preis-Guide: offizieller Bezugsweg, Datei-URL, Format, Nutzungsbedingungen.
   - TCGdex: Endpunkte, Bild-URLs je Sprache, Abdeckung laut api.tcgdex.net/status.
   Lässt sich der Preis-Guide nicht offiziell und automatisiert beziehen: stopp und nenn mir die Optionen. Niemals scrapen.
3. Projekt aufsetzen: Vite, React, TypeScript, vite-plugin-pwa, Dexie, Zustand, Framer Motion, Vitest, Playwright, ESLint, Prettier.
4. Design als Fundament, bevor Features kommen: Design-Tokens (Farben, selbst gehostete Schriften Unbounded/Figtree/JetBrains Mono, Abstände, Radien), Karten-Komponente mit 3D-Kippen und Holo-Glanz, Gesten-Gerüst Scanner ↔ Binder. Nutze den frontend-design-Skill, falls verfügbar. Ziel ist eine eigenständige Optik nach Abschnitt „Design-Konzept: Die Vitrine“, keine Standard-Templates.
5. Dann Meilenstein M1 vollständig: Pipeline-Skripte unter scripts/, GitHub Action mit Ausgabe in den Branch data, Suche, Karten-Detail mit Kurszettel, Sammlung, Depot.
6. Nach jedem Meilenstein: Tests grün, Build läuft, kurzer Bericht mit Playwright-Screenshots in docs/PROGRESS.md. Dann auf mein OK für den nächsten Meilenstein warten.

Regeln:
- Erkennung nie raten. Lieber den Nutzer fragen als eine falsche Karte zeigen.
- Gemini ist nur Fallback. Jede Gemini-Antwort wird gegen den Katalog geprüft (Set + Nummer). Modellnamen nicht hart verdrahten, sondern über die Modell-Liste der API prüfen.
- Kein Scraping von Cardmarket, pokemon.com oder anderen Seiten.
- Kartenbilder kommen nicht ins Repo und nicht auf einen eigenen Server. Der Hash-Index enthält keine Bilder.
- Kein „Pokémon“ im App-Namen oder Logo, keine Pokéball-Symbole.
- Rarebox (github.com/novaoc/rarebox, MIT) darfst du als Vorlage für Entzerrung und Hash-Matching nutzen und Teile übernehmen, mit Lizenzhinweis in THIRD_PARTY_NOTICES.md.
- Passt die Spec irgendwo nicht oder siehst du eine bessere Lösung: kurz begründen und fragen, nicht stillschweigend abweichen.

Starte mit Schritt 1 und 2.
```

## Quellen

- [TCGdex – Status und Sprachen](https://tcgdex.dev/status)
- [Rarebox – Open-Source-Sammlungs-App mit Hash-Scanner (MIT)](https://github.com/novaoc/rarebox)
- [jslok/card-scanner – Erkennung per Modell + Image Hashing](https://github.com/jslok/card-scanner)
- [Roboflow Universe – Datensatz „Find card“](https://universe.roboflow.com/findpokemoncard/find-card)
- [Cardmarket – API-Zugang (derzeit keine neuen Anträge)](https://help.cardmarket.com/en/cardmarket-api)
- [Cardmarket API 2.0 – Preis-Guide-Endpunkt (abgekündigt, Funktion auf der Website)](https://api.cardmarket.com/ws/documentation/API_2.0:PriceGuide)
- [Dex – Warum Regionen statt Sprachen](https://dextcg.com/help/getting-started/supported-card-languages-in-dex)
- [pokemontcgapi.com – MCP-/API-Beschreibung](https://mcpservers.org/servers/pokemontcgapi/mcp-server)
- [pkmnprices – Abdeckung Englisch/Deutsch mit Cardmarket](https://pypi.org/project/pkmnprices/3.3.0/)
- [Gemini API – Billing und Free Tier](https://ai.google.dev/gemini-api/docs/billing)
