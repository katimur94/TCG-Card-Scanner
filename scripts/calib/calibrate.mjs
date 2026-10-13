#!/usr/bin/env node
// Kalibrierung: alle Szenen aus .cache/calib (scripts/calib/make-scenes.py) durch die echte Erkennung
// im Browser schicken und mit der Wahrheit vergleichen.
//
//   npm run build && node scripts/calib/calibrate.mjs [--only single] [--limit 20]
//
// Ausgabe: Kennzahlen je Szenenart und .cache/calib/results.json (Rohdaten zum Einstellen der Schwellen).
// Ziel laut Spec: null falsche „sichere“ Treffer – lieber nachfragen als falsch erkennen.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAL = join(ROOT, '.cache', 'calib');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const only = opt('--only', null);
const limit = Number(opt('--limit', 1e9));
const PORT = 4190;

const truth = JSON.parse(readFileSync(join(CAL, 'truth.json'), 'utf8'))
  .filter((s) => !only || s.kind === only)
  .slice(0, limit);

const server = spawn(process.execPath, [join(ROOT, 'e2e', 'serve.mjs'), `${join(ROOT, 'dist')},${CAL}`, String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const exe = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(exe) ? exe : undefined,
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()));
await page.goto(`http://localhost:${PORT}/TCG-Card-Scanner/?calib`);
await page.waitForFunction(() => !!window.__holoscanCalib, null, { timeout: 30000 });
console.log('Bildmodell lädt …', await page.evaluate(() => window.__holoscanCalib.warmup()));

const inside = (p, q) => {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (!c) continue;
    if (!sign) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
};
const same = (a, b) => a && b && a.group === b.group && a.setId === b.setId && String(a.localId).replace(/^0+/, '') === String(b.localId).replace(/^0+/, '');

const rows = [];
const stats = {};
for (const scene of truth) {
  const res = await page.evaluate((u) => window.__holoscanCalib.recognizeUrl(u), `scenes/${scene.file}`);
  // Szenen sind z. B. 1080 px breit, die App rechnet auf höchstens 2000 px skaliert – Ecken zurückrechnen
  const s = Math.max(res.width, res.height) / Math.max(...scene.cards.flatMap((c) => c.quad.flat()), 1) > 0 ? 1 : 1;
  const st = (stats[scene.kind] ||= { cards: 0, found: 0, sure: 0, sureOk: 0, sureWrong: 0, ask: 0, askHasRight: 0, extra: 0, ms: 0, scenes: 0 });
  st.scenes++;
  st.ms += res.ms;
  const used = new Set();
  for (const t of scene.cards) {
    st.cards++;
    const i = res.cards.findIndex((c, k) => !used.has(k) && inside([c.center[0] * s, c.center[1] * s], t.quad));
    const r = res.cards[i];
    if (i >= 0) used.add(i);
    const row = { file: scene.file, kind: scene.kind, level: scene.level, truth: t, found: !!r, ...r };
    if (r) {
      st.found++;
      row.correct = same(r.best, t);
      row.inOptions = r.options.some((o) => same(o, t));
      if (r.status === 'sure') {
        st.sure++;
        if (row.correct) st.sureOk++;
        else st.sureWrong++;
      } else {
        st.ask++;
        if (row.inOptions) st.askHasRight++;
      }
    }
    rows.push(row);
  }
  st.extra += res.cards.length - used.size;
  const wrong = rows.filter((r) => r.file === scene.file && r.status === 'sure' && !r.correct);
  process.stdout.write(`${scene.file}: ${res.cards.length}/${scene.cards.length} gefunden, ${res.ms} ms${wrong.length ? `  FALSCH SICHER: ${wrong.map((w) => `${w.best?.setId}-${w.best?.localId} statt ${w.truth.setId}-${w.truth.localId}`).join(', ')}` : ''}\n`);
}

writeFileSync(join(CAL, 'results.json'), JSON.stringify(rows, null, 1));
console.log('\nArt       Karten gefunden  sicher(richtig/falsch)  nachfragen(richtige Option dabei)  zusätzlich  Ø ms/Szene');
for (const [k, v] of Object.entries(stats)) {
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : '–');
  console.log(
    `${k.padEnd(9)} ${String(v.cards).padStart(6)} ${pct(v.found, v.cards).padStart(8)}  ${pct(v.sure, v.found).padStart(6)} (${v.sureOk}/${v.sureWrong})  ${pct(v.ask, v.found).padStart(12)} (${v.askHasRight}/${v.ask})  ${String(v.extra).padStart(10)}  ${Math.round(v.ms / v.scenes)}`,
  );
}
await browser.close();
server.kill();
