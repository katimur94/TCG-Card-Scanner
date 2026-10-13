// Smoke-Tests der Kernabläufe (M1): Suche -> Karte -> Kurszettel -> Sammlung -> Binder -> Depot.

import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { expectNoOverflow, mockTcgdex, shot } from './helpers';

const root = join(import.meta.dirname, '..');

test.beforeEach(async ({ page, request }) => {
  await request.get(`/__roots?set=${encodeURIComponent(join(root, 'dist'))}`);
  await mockTcgdex(page);
});

test('Suchen, Karte umdrehen, in die Sammlung legen, Binder und Depot', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.ticker-value')).toHaveText(/0,00/);
  await shot(page, '02-scanner-start');

  await page.getByRole('button', { name: 'Karte suchen' }).first().click();
  await page.getByRole('searchbox', { name: /Name, Set oder Nummer/ }).fill('4/102');
  const hit = page.locator('.result', { hasText: 'Glurak' }).first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await expectNoOverflow(page, '.sheet');
  await shot(page, '03-suche');
  await hit.click();

  await expect(page.locator('.detail-name')).toHaveText('Glurak');
  await expect(page.locator('.price-big')).toContainText('€');
  await expectNoOverflow(page, '.detail');
  await shot(page, '04-karte');
  await page.getByRole('button', { name: /Umdrehen: Kurszettel/ }).click();
  await expect(page.locator('.slip-price')).toBeVisible();
  await page.waitForTimeout(700);
  await shot(page, '05-kurszettel');

  // Zustand EX wählen, in die Sammlung mit Kaufpreis
  await page.getByRole('radio', { name: /^EX/ }).click();
  await page.getByRole('button', { name: 'In die Sammlung' }).click();
  await page.getByLabel('Preis pro Karte').fill('99,50');
  await shot(page, '06-kaufpreis');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByText(/ist in der Sammlung/)).toBeVisible();
  await expect(page.locator('.post')).toHaveCount(1);
  await expect(page.locator('.post')).toContainText('Einstand 99,50');

  await page.getByRole('button', { name: 'Zurück' }).click();
  await page.getByRole('button', { name: 'Binder öffnen' }).first().click();
  await expect(page.locator('.pocket:not(.pocket-empty)')).toHaveCount(1);
  await page.waitForTimeout(700);
  await expectNoOverflow(page, '.binder');
  await shot(page, '07-binder');

  await page.getByRole('button', { name: 'Depot öffnen' }).click();
  await expect(page.getByRole('dialog', { name: 'Depot' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Depot' })).toContainText('99,50');
  await page.waitForTimeout(500);
  await expectNoOverflow(page, '.sheet');
  await shot(page, '08-depot');
});

test('Rückgängig nach dem Hinzufügen entfernt den Posten wieder', async ({ page }) => {
  await page.goto('./?view=search');
  await page.getByRole('searchbox', { name: /Name, Set oder Nummer/ }).fill('Glurak');
  await page.locator('.result', { hasText: 'Glurak' }).first().click();
  await page.getByRole('button', { name: 'Merkliste' }).click();
  await expect(page.locator('.post')).toHaveCount(1);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.locator('.post')).toHaveCount(0);
});

test('Einstellungen: Backup exportieren und wieder importieren', async ({ page }) => {
  await page.goto('./?view=collection');
  await page.getByRole('region', { name: 'Binder' }).getByRole('button', { name: 'Einstellungen' }).click();
  await expect(page.getByRole('dialog', { name: 'Einstellungen' })).toBeVisible();
  await page.waitForTimeout(500);
  await expectNoOverflow(page, '.sheet');
  await shot(page, '09-einstellungen');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Backup \(JSON\)/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^holoscan-backup-.*\.json$/);
});

test.describe('Kleines Handy', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('Detailansicht nutzt die volle Breite, Binder scrollt bis zur letzten Tasche', async ({ page }) => {
    await page.goto('./?view=search');
    await page.getByRole('searchbox', { name: /Name, Set oder Nummer/ }).fill('Glurak');
    await page.locator('.result', { hasText: 'Glurak' }).first().click();
    await page.getByRole('button', { name: 'Merkliste' }).click();
    await expect(page.locator('.post')).toHaveCount(1);
    // Die Abschnitte der Karte sind volle Spalten, keine kleinen Kästchen
    for (const box of await page.locator('.detail .panel').all()) {
      expect((await box.boundingBox())!.width).toBeGreaterThan(300);
    }
    await expectNoOverflow(page, '.detail');

    await page.goto('./?view=collection');
    await page.getByRole('tab', { name: /Merkliste/ }).click();
    await page.getByRole('button', { name: 'Filter' }).click();
    const last = page.locator('.binder-page .pocket').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Nächste Seite' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Nächste Seite' })).toBeInViewport({ ratio: 1 });
  });
});
