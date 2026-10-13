// Galerie-Scan mit echter Erkennung (Bildmodell, Texterkennung): ein „Foto“ wird zur Laufzeit aus dem
// TCGdex-Kartenbild zusammengesetzt (keine Kartenbilder im Repository). Braucht Netz (TCGdex, jsDelivr).

import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { shot } from './helpers';

const root = join(import.meta.dirname, '..');
test.setTimeout(180_000);

/** Foto im Browser erzeugen: Karte leicht gedreht auf unruhigem Grund. */
async function makePhoto(page: import('@playwright/test').Page, cards: Array<{ url: string; x: number; y: number; w: number; angle: number }>, size: [number, number]) {
  const b64 = await page.evaluate(
    async ({ cards, size }) => {
      const c = document.createElement('canvas');
      [c.width, c.height] = size;
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, c.width, c.height);
      g.addColorStop(0, '#6b5a4a');
      g.addColorStop(1, '#3d342c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
      for (const k of cards) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = k.url;
        await img.decode();
        const h = (k.w * 88) / 63;
        ctx.save();
        ctx.translate(k.x, k.y);
        ctx.rotate((k.angle * Math.PI) / 180);
        ctx.drawImage(img, -k.w / 2, -h / 2, k.w, h);
        ctx.restore();
      }
      return c.toDataURL('image/jpeg', 0.88).split(',')[1];
    },
    { cards, size },
  );
  return Buffer.from(b64, 'base64');
}

test.beforeEach(async ({ request }) => {
  await request.get(`/__roots?set=${encodeURIComponent(join(root, 'dist'))}`);
});

test('Galerie: Foto erkennen, Stapel sortieren, in die Sammlung', async ({ page }) => {
  await page.goto('./');
  const photo = await makePhoto(page, [{ url: 'https://assets.tcgdex.net/en/swsh/swsh3/136/high.webp', x: 540, y: 720, w: 760, angle: 3 }], [1080, 1440]);
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'karte.jpg', mimeType: 'image/jpeg', buffer: photo });
  // Stapel bekommt eine Karte
  await expect(page.locator('.stack-count')).toHaveText('1', { timeout: 150_000 });
  await shot(page, '10-stapel');
  await page.getByRole('button', { name: /Stapel: 1 Karte/ }).click();
  await expect(page.getByRole('dialog', { name: 'Stapel sortieren' })).toBeVisible();
  await expect(page.locator('.triage-name')).toHaveText(/Furret/i, { timeout: 20_000 });
  await page.waitForTimeout(600);
  await shot(page, '11-triage');
  // In die Sammlung (Knopf statt Wischen), Kaufpreis: geschenkt
  await page.getByRole('button', { name: /In die Sammlung \(nach rechts wischen\)/ }).click();
  await page.getByRole('button', { name: 'Geschenkt' }).click();
  await expect(page.getByText(/ist in der Sammlung/)).toBeVisible();
  await page.getByRole('button', { name: 'Binder öffnen' }).first().click();
  await expect(page.locator('.pocket:not(.pocket-empty)')).toHaveCount(1);
});

test('Galerie: Binderseite mit mehreren Karten', async ({ page }) => {
  await page.goto('./');
  const urls = ['swsh3/136', 'swsh3/50', 'swsh3/19', 'swsh4/25'].map((p) => `https://assets.tcgdex.net/en/swsh/${p}/high.webp`);
  const w = 300;
  const cards = urls.map((url, i) => ({ url, x: 220 + (i % 2) * (w + 40), y: 260 + Math.floor(i / 2) * ((w * 88) / 63 + 40), w, angle: 0 }));
  const photo = await makePhoto(page, cards, [880, 1100]);
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'seite.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(page.locator('.stack-count')).toHaveText('4', { timeout: 170_000 });
});
