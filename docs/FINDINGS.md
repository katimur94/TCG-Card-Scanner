# Befunde (Stand 13.10.2026)

## Cardmarket-Preis-Guide

- **Bezugsweg:** Cardmarket stellt den Preis-Guide und den Produktkatalog als öffentliche Dateien bereit
  (verlinkt auf der Website unter „Preis-Guide herunterladen“), kein Login, kein Scraping:
  - Preise: `https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json`
  - Produkte (Einzelkarten): `https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json`
  - `6` = Spiel Pokémon.
- **Format:** `{version, createdAt, priceGuides: [{idProduct, idCategory, avg, low, trend, avg1, avg7, avg30,
  avg-holo, low-holo, trend-holo, avg1-holo, avg7-holo, avg30-holo}]}`. Am 12.10.2026: 79.765 Produkte,
  einmal täglich neu (ca. 02:45 MESZ).
- **Inhalt:** Durchschnitte über alle Sprachen und Zustände eines Produkts. Europäische Sprachen teilen sich
  ein Produkt, japanische Karten sind eigene Produkte. Keine Preise je Zustand, keine Einzelangebote.
- **Nutzungsbedingungen:** Die Dateien sind öffentlich verlinkt; ausdrückliche Lizenzbedingungen für die
  Weiterverwendung habe ich nicht gefunden. **Offen:** vor einer breiteren Veröffentlichung bei Cardmarket
  nachfragen. Die App zeigt die Quelle an und verlinkt immer auf Cardmarket.
- Die API 2.0 (mit Preis-Guide-Endpunkt) nimmt keine neuen Anträge an – für uns nicht nötig.

## TCGdex

- **API:** `https://api.tcgdex.net/v2/{lang}/…` – `sets`, `sets/{id}`, `cards/{id}`, `cards?…` (Filter).
  Sprachen im Einsatz: en, de, fr, es, it, pt (gemeinsame Set-IDs) und ja (eigene Sets).
- **Preise:** `card.pricing.cardmarket` (gleiche Felder wie der Preis-Guide + `idProduct`, `updated`) und
  `card.pricing.tcgplayer`; je Variante zusätzlich in `variants_detailed[].pricing` mit
  `thirdParty.cardmarket` = Cardmarket-Produkt-ID. Damit ist die Zuordnung Karte+Variante ↔ Produkt-ID
  für die meisten Karten direkt geliefert; für Lücken gibt es `scripts/build-cardmarket.mjs`
  (Name + Attacken + Erweiterung).
- **Bilder:** `card.image` + `/{low|high}.webp`, z. B. `https://assets.tcgdex.net/en/swsh/swsh3/136/high.webp`.
  Je Sprache eigener Pfad (`/de/…`, `/ja/…`).
- **Abdeckung** (Karten im Offline-Index, 03.10.2026): en 21.256 · fr 19.961 · de 19.245 · it 14.514 ·
  es 14.264 · pt 13.907 · ja 12.781. Bilder fehlen vor allem bei älteren deutschen und japanischen Karten;
  die App nutzt dann das Bild der englischen Ausgabe oder das eigene Scan-Foto.

## Abweichungen von der Spec (begründet)

1. **Hosting bleibt GitHub Pages statt Vercel.** IndexedDB hängt am Origin. Ein Umzug auf eine Vercel-Domain
   würde bei allen bisherigen Nutzern die Sammlung „verschwinden“ lassen. Anforderung: Umbau als Update,
   ohne Datenverlust.
2. **Bilderkennung: DINOv2-Vektoren statt pHash/dHash als Hauptstufe.** Die bestehende Erkennung erreicht an
   simulierten Handyfotos 99 % (Toploader mit Fingern 96 %); Perceptual Hashes sind bei Spiegelung, Hülle
   und Holo-Glanz deutlich schwächer. Größer als das Budget der Spec (Modell 24 MB, Index 3 MB), wird aber
   erst beim ersten Scan geladen und dann gecacht. Vorschlag: pHash optional als schnelle Vorstufe in M2,
   nur wenn das Kalibrier-Testset zeigt, dass es ohne Fehltreffer Zeit spart.
3. **Daten-Branch als Einzel-Commit.** Der Workflow schreibt die erzeugten Daten in den Branch `data`, und
   zwar als einzelnen Commit, der jeden Tag ersetzt wird. Die Preis-Historie steckt in den Dateien selbst;
   so wächst das Repository nicht mit jedem Tag um mehrere MB.
4. **Datenformate bleiben vorerst** (`data/sets.json`, `data/cards-{lang}.json`, `data/vision/…`). Sie
   funktionieren, sind kompakt, und Erkennung und Suche bauen darauf auf. Neu dazu kommt
   `data/prices/history/{shard}.json`.
5. **KI-Leser:** Gemini mit eigenem Schlüssel (Spec). Ein bereits eingetragener OpenRouter-Schlüssel bleibt
   nutzbar, damit bestehende Einstellungen nicht verloren gehen. Der bisher eingebaute Schlüssel entfällt –
   er war im ausgelieferten JavaScript öffentlich lesbar.
6. **Merkliste mit Preisalarm** bleibt erhalten (nicht in der Spec, aber bestehende Nutzerdaten).
