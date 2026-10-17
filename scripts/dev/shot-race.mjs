// Снимок в гонке: node scripts/dev/shot-race.mjs out.png [секунд гонки] [query]
import { chromium } from '@playwright/test';
const [out, secs = '20', query = '', w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.info('[console]', m.type(), m.text());
});
page.on('pageerror', (e) => console.info('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:8091/?seed=42&bridge=off&fresh&quality=broadcast${query}`);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
await page.evaluate(async (s) => {
  await window.__game.advanceUntil('race', 30);
  window.__game.advance(Math.round(s * 60));
}, +secs);
const start = await page.evaluate(() => window.__game.frameCount);
await page.waitForFunction((n) => window.__game.frameCount > n + 3, start, { timeout: 120000 });
console.info(JSON.stringify({ ...(await page.evaluate(() => window.__game.status())), standings: undefined }));
await page.screenshot({ path: out });
await browser.close();
