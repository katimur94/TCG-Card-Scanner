import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIX = join(import.meta.dirname, 'fixtures');
const card = (lang: string) =>
  JSON.parse(readFileSync(join(FIX, `card-${lang === 'de' ? 'de' : 'en'}-base1-4.json`), 'utf8'));
const png = readFileSync(join(import.meta.dirname, '..', 'public', 'assets', 'icons', 'icon-192.png'));

/** TCGdex-Aufrufe mit festen Testdaten beantworten (Tests laufen ohne Netz und deterministisch). */
export async function mockTcgdex(page: Page) {
  await page.route('https://api.tcgdex.net/**', (route) => {
    const m = new URL(route.request().url()).pathname.match(/^\/v2\/(\w+)\/cards\/([^/]+)$/);
    if (!m) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    const [, lang, id] = m;
    const c = card(lang);
    const localId = decodeURIComponent(id).split('-').pop();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...c, id: decodeURIComponent(id), localId }),
    });
  });
  await page.route('https://assets.tcgdex.net/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: png }),
  );
}

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: join('docs', 'screenshots', `${name}.jpg`), type: 'jpeg', quality: 72, scale: 'css' });
}

/** Kein Element darf breiter als der Bildschirm sein (kein seitliches Scrollen am Handy). */
export async function expectNoOverflow(page: Page, scope: string) {
  const wide = await page.evaluate((sel) => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll(`${sel} *`)]
      .filter((e) => {
        if (e.closest('.scroll-x, .binder-page')) return false;
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.left < -1 || r.right > vw + 1);
      })
      .map((e) => `${e.tagName}.${e.className}`)
      .slice(0, 5);
  }, scope);
  if (wide.length) throw new Error(`Zu breit in ${scope}: ${wide.join(', ')}`);
}
