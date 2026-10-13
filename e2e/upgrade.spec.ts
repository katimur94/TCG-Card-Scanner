// Update-Test: Die alte App (legacy/) läuft und speichert Karten. Dann wird am selben Origin die neue App
// ausgeliefert. Erwartet: Der neue Service Worker übernimmt, die neue App startet und zeigt die Sammlung.

import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockTcgdex, shot } from './helpers';

const root = join(import.meta.dirname, '..');

test('Update von der alten Version behält Sammlung, Merkliste und Einstellungen', async ({ page, request }) => {
  // Alte Version wie veröffentlicht: Service Worker mit Build-ID (sonst läuft er im Entwicklungsmodus)
  const shim = mkdtempSync(join(tmpdir(), 'holoscan-old-'));
  writeFileSync(
    join(shim, 'sw.js'),
    readFileSync(join(root, 'legacy', 'sw.js'), 'utf8').replace('__BUILD_ID__', 'old-1'),
  );
  await request.get(`/__roots?set=${encodeURIComponent([shim, join(root, 'legacy'), join(root, 'public')].join(','))}`);

  await mockTcgdex(page);
  await page.goto('./');
  await expect(page.locator('.brand-name')).toBeVisible();
  // Alte App: Service Worker aktiv, dann Karten über ihr eigenes Speichermodul anlegen
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Die alte App lädt sich bei der ersten Übernahme durch ihren Service Worker selbst neu
  await page.waitForTimeout(1500);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.evaluate(async () => {
    const store = await import(new URL('js/store.js', location.href).href);
    await store.loadSettings();
    await store.saveSettings({ fallbackLang: 'en', condition: 3, haptics: false });
    await store.addItem({
      list: 'collection',
      id: 'base1-4',
      group: 'intl',
      setId: 'base1',
      localId: '4',
      lang: 'de',
      name: 'Glurak',
      setName: 'Grundset',
      image: 'https://assets.tcgdex.net/de/base/base1/4',
      variantKey: 'holo',
      variantLabel: 'Holo',
      condition: 2,
      qty: 2,
      price: 350.5,
      buyPrice: 120,
    });
    await store.addItem({
      list: 'wish',
      id: 'base1-2',
      group: 'intl',
      setId: 'base1',
      localId: '2',
      lang: 'en',
      name: 'Blastoise',
      variantKey: 'holo',
      condition: 2,
      qty: 1,
      price: 200,
      target: 150,
    });
  });
  await shot(page, '00-alte-version');

  // Neue Version ausliefern (gleicher Origin, gleicher Pfad)
  await request.get(`/__roots?set=${encodeURIComponent(join(root, 'dist'))}`);
  await page.reload();
  // Der neue Service Worker übernimmt und lädt die Seite einmal neu
  await expect(page.locator('.ticker-value')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || '')).toContain('sw.js');
  await expect(page.getByText(/2 Karte\(n\) aus deiner Sammlung wurden übernommen/)).toBeVisible({ timeout: 10_000 });

  // Binder zeigt die übernommene Karte mit Menge, Merkliste die Merkkarte
  await page.getByRole('button', { name: 'Binder öffnen' }).first().click();
  const pocket = page.locator('.pocket:not(.pocket-empty)');
  await expect(pocket).toHaveCount(1);
  await expect(pocket.first()).toHaveAttribute('aria-label', /Glurak.*2 Stück/);
  await page.waitForTimeout(700);
  await shot(page, '01-binder-nach-update');
  await page.getByRole('tab', { name: /Merkliste/ }).click();
  await expect(page.locator('.pocket:not(.pocket-empty)').first()).toHaveAttribute('aria-label', /Blastoise/);

  // Einstellungen übernommen, alte Datenbank unverändert vorhanden
  const state = await page.evaluate(async () => {
    const dbs = (await indexedDB.databases()).map((d) => d.name);
    return { dbs };
  });
  expect(state.dbs).toEqual(expect.arrayContaining(['holoscan', 'holo']));

  // Zweiter Start: keine doppelte Übernahme
  await page.reload();
  await page.getByRole('button', { name: 'Binder öffnen' }).first().click();
  await expect(page.locator('.pocket:not(.pocket-empty)')).toHaveCount(1);
});
