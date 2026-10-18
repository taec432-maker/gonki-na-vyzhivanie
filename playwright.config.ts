import { defineConfig } from '@playwright/test';

const PORT = 4318;

export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/report.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1920, height: 1080 },
    launchOptions: {
      args: [
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--enable-webgl',
        // Как в OBS: звук без щелчка по странице.
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: {
    command: `node scripts/serve.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
