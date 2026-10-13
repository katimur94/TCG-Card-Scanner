import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// In der Cloud-Umgebung liegt Chromium unter /opt/pw-browsers; in GitHub Actions installiert Playwright selbst.
const local = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const executablePath = existsSync(local) ? local : undefined;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://localhost:4173/TCG-Card-Scanner/',
    // Test-Kamera von Chrome (bewegtes Muster, keine echte Kamera nötig)
    launchOptions: { executablePath, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    permissions: ['camera'],
    serviceWorkers: 'allow',
    // In der Cloud-Umgebung läuft Internet über einen Proxy (TCGdex, jsDelivr für Bildmodell/Texterkennung)
    ...(process.env.HTTPS_PROXY
      ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }, ignoreHTTPSErrors: true }
      : {}),
  },
  webServer: {
    command: 'node e2e/serve.mjs dist 4173',
    url: 'http://localhost:4173/TCG-Card-Scanner/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
