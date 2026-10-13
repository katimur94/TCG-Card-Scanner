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
    launchOptions: { executablePath },
    serviceWorkers: 'allow',
  },
  webServer: {
    command: 'node e2e/serve.mjs dist 4173',
    url: 'http://localhost:4173/TCG-Card-Scanner/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
