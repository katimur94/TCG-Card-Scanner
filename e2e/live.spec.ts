// Live-Kamera mit Chromes Test-Kamera: startet, zeigt Hinweise, erfindet auf dem Testbild keine Karte,
// stoppt, wenn der Binder offen ist.

import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { mockTcgdex } from './helpers';

const root = join(import.meta.dirname, '..');

test('Kamera startet automatisch (erlaubt) und meldet auf dem Testbild keine Karte', async ({ page, request }) => {
  await request.get(`/__roots?set=${encodeURIComponent(join(root, 'dist'))}`);
  await mockTcgdex(page);
  await page.goto('./');
  await expect(page.locator('.live-hint')).toHaveText(/Karte ins Bild halten|Ruhig halten/, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (document.querySelector('.live-video') as HTMLVideoElement)?.videoWidth || 0)).toBeGreaterThan(0);
  await page.waitForTimeout(4000);
  await expect(page.locator('.stack-count')).toHaveCount(0);
  // Binder öffnen -> Kamera aus
  await page.getByRole('button', { name: 'Binder öffnen' }).first().click();
  await expect.poll(() => page.evaluate(() => !!(document.querySelector('.live-video') as HTMLVideoElement)?.srcObject)).toBe(false);
  // zurück -> Kamera wieder an
  await page.getByRole('button', { name: 'Zum Scanner' }).click();
  await expect.poll(() => page.evaluate(() => !!(document.querySelector('.live-video') as HTMLVideoElement)?.srcObject), { timeout: 10_000 }).toBe(true);
});
