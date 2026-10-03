# HoloScan – Pokémon Karten-Scanner

Karte vor die Handykamera halten und sofort den **Cardmarket-Preis** sehen. HoloScan ist eine installierbare Web-App (PWA): Sie läuft im Browser, lässt sich wie eine App auf den Home-Bildschirm legen und funktioniert nach dem ersten Laden auch offline.

**Live:** https://katimur94.github.io/TCG-Card-Scanner/

## Funktionen

- **Scannen per Kamera** mit Kartenrahmen, Taschenlampe und optionalem **Auto-Scan** (löst aus, sobald die Karte ruhig im Rahmen liegt)
- **Foto-Import** aus der Galerie: Foto mit zwei Fingern zoomen, verschieben und bei Bedarf drehen, bis die Karte im Rahmen liegt – gescannt wird genau der Rahmen; das Foto bleibt zum Nachjustieren stehen
- **Spracherkennung**: Deutsch, Englisch, Französisch, Spanisch, Italienisch, Portugiesisch und Japanisch, erkannt über
  - den aufgedruckten Sprachcode (z. B. „PAL DE“ ab Karmesin & Purpur),
  - Kartenbegriffe wie Schwäche/Weakness/Faiblesse, KP/HP/PV/PS,
  - den gelesenen Kartennamen (z. B. „Enigmara“ → Deutsch).
- **Cardmarket-Preise** aus dem offiziellen Preisguide: Preistrend, Ab-Preis, Ø Verkaufspreis, Ø 1/7/30 Tage und die Tendenz (7 gegenüber 30 Tagen)
- **Varianten** mit eigenem Preis: Normal, Holo, Reverse Holo, Pokéball- und Meisterball-Muster, 1. Edition …
- **Preis nach Zustand** für alle Cardmarket-Zustände (MT, NM, EX, GD, LP, PL, PO): Richtwert je Zustand (Preistrend = NM, übliche Abschläge, in „Mehr“ anpassbar) und je Zustand ein Direktlink zu den echten Cardmarket-Angeboten – gefiltert auf Kartensprache und Zustand, günstigstes zuerst
- **Sprachgerechte Cardmarket-Links**: öffnet das Produkt direkt mit Filter auf die Kartensprache und den gewünschten Mindestzustand
- **Japanische Karten** werden als eigene Cardmarket-Produkte mit eigenem Preis erkannt
- **Kartenbild immer da**: Fehlt ein Bild in der Datenbank, nimmt HoloScan dein eigenes Scan-Foto („Dein Scan“) und speichert es mit in Sammlung und Verlauf; bei Suchtreffern ohne Bild springt das Bild einer anderen Ausgabe ein (z. B. „Bild: EN-Ausgabe“) oder ein Link zum Bild auf Cardmarket
- **Kauf-Check**: Preis eingeben, zu dem du die Karte kaufen könntest (z. B. auf dem Flohmarkt) – HoloScan vergleicht mit dem Cardmarket-Wert im gewählten Zustand und sagt sofort, ob es ein Top-Deal, ein guter Kauf, ein fairer Preis oder zu teuer ist. Dazu: Ersparnis, möglicher Gewinn beim Weiterverkauf (nach 5 % Cardmarket-Provision und Verpackung), Verhandlungsziele und eine Investment-Einschätzung (Kursentwicklung, Set-Alter, Seltenheit, Wertniveau, Schwankung) mit Begründung. Beim Hinzufügen zur Sammlung wird der Preis als Einkaufspreis übernommen. Keine Anlageberatung.
- **Serienscan**: Karten nacheinander scannen, der Gesamtwert des Stapels wird live summiert
- **Sammlung** mit Gesamtwert, Wertentwicklung seit dem Hinzufügen, Einkaufspreis/Gewinn und Wertverlauf
- **Merkliste mit Preisalarm** (wird beim Öffnen der App geprüft, optional mit Benachrichtigung)
- **Suche** nach Name, Nummer oder Set-Kürzel (z. B. `Glurak`, `4/102`, `MEW 25`), auch offline
- **Export** als CSV (Excel) oder JSON-Backup, Import auf anderen Geräten
- Holo-Effekt mit 3D-Neigung, Haptik, Scan-Verlauf und eigener Preisverlauf je Karte

## Auf dem Handy installieren

- **Android (Chrome):** Seite öffnen → „Mehr“ → „Installieren“ oder im Browser-Menü „App installieren“.
- **iPhone (Safari):** Seite öffnen → Teilen-Symbol → „Zum Home-Bildschirm“.

## So funktioniert die Erkennung

1. Die Texterkennung ([Tesseract.js](https://github.com/naptha/tesseract.js)) läuft **direkt auf dem Gerät**; es werden keine Fotos hochgeladen.
2. Gelesen werden die ganze Karte, die Namensleiste und – vergrößert – der untere Rand mit Kartennummer (z. B. `025/165`) und Set-Kürzel.
3. Ein Offline-Kartenindex (`data/`) ordnet Nummer, Gesamtzahl, Set-Kürzel und Namen einer Karte zu. Dabei werden einzelne falsch gelesene Ziffern toleriert und anhand des Namens geprüft.
4. Preise und Kartendetails kommen live von [TCGdex](https://tcgdex.dev), das den Cardmarket-Preisguide täglich übernimmt.

Hinweis zu Zuständen: Cardmarket veröffentlicht nur den Preisguide (Trend, Ab-Preis, Durchschnitte) und keine Preise je Zustand; die einzelnen Angebote sind nicht frei abrufbar. Die Zustandspreise in HoloScan sind deshalb Richtwerte, die echten Angebote öffnet der Link der jeweiligen Zeile. Der Sammlungswert rechnet mit dem Zustand jeder Karte.

Hinweis zur Sprache: Bei Cardmarket teilen sich die europäischen Sprachversionen einer Karte ein Produkt, der Preisguide gilt also sprachübergreifend. Deshalb öffnet HoloScan die Cardmarket-Seite gefiltert auf die erkannte Sprache. Japanische Karten sind eigene Produkte mit eigenem Preis.

## GitHub Pages einrichten (einmalig)

Der Workflow `.github/workflows/pages.yml` veröffentlicht die App bei jedem Push auf den Standard-Branch. Einmalig muss GitHub Pages aktiviert werden:

1. Repository → **Settings → Pages**
2. Unter **Build and deployment → Source** die Option **GitHub Actions** wählen
3. Unter **Actions** den Workflow „GitHub Pages“ erneut starten („Re-run all jobs“ oder „Run workflow“)

Montags aktualisiert derselbe Workflow automatisch den Kartenindex, damit neue Sets erkannt werden.

## Lokal starten

Die App ist rein statisch und braucht keinen Build-Schritt. Die Kamera funktioniert nur über `https://` oder `localhost`.

```bash
npx http-server -p 8080 -c-1 .
# oder
python3 -m http.server 8080
```

Dann `http://localhost:8080` öffnen.

Kartenindex neu erzeugen (Node.js 22 oder neuer):

```bash
node scripts/build-index.mjs
```

## Aufbau

```
index.html, css/app.css      Oberfläche und Design
manifest.webmanifest, sw.js  PWA: Installation, Offline-Cache, Updates
js/app.js                    Start, Navigation
js/camera.js                 Kamera, Ausschnitt, Auto-Auslöser
js/ocr.js                    Texterkennung (Tesseract.js)
js/parse.js                  Nummer, Set-Kürzel, Sprachcode, Name aus dem OCR-Text
js/lang.js                   Sprachen, Cardmarket-IDs, Spracherkennung
js/identify.js               Zuordnung zum Kartenindex, unscharfe Suche
js/recognize.js              Gesamte Erkennungs-Pipeline
js/api.js                    TCGdex-Client und Index-Laden
js/pricing.js                Varianten, Preisfelder, Zustands-Richtwerte, Cardmarket-Links
js/deal.js                   Kauf-Check und Investment-Einschätzung
js/store.js, js/db.js        Sammlung, Verlauf, Einstellungen (IndexedDB)
js/ui/*                      Ansichten (Scanner, Ergebnis, Sammlung, Suche, Mehr)
data/                        Offline-Kartenindex (generiert)
scripts/build-index.mjs      Erzeugt den Kartenindex aus TCGdex
vendor/tesseract/            Tesseract.js (Apache-2.0)
```

## Datenquellen und Lizenzen

- Kartendaten, Bilder und Preise: [TCGdex](https://tcgdex.dev) (Cardmarket-Preisguide, TCGplayer)
- Texterkennung: [Tesseract.js](https://github.com/naptha/tesseract.js), Apache-2.0 (`vendor/tesseract/LICENSE.md`)
- Schrift: [Outfit](https://fonts.google.com/specimen/Outfit), SIL Open Font License

HoloScan ist ein inoffizielles Fanprojekt. Pokémon und alle zugehörigen Namen sind Marken von Nintendo, Creatures Inc., GAME FREAK und The Pokémon Company. Das Projekt ist nicht mit Cardmarket oder TCGdex verbunden. Alle Preise ohne Gewähr.
