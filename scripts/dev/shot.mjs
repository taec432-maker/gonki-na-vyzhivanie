// Быстрый снимок экрана для разработки: node scripts/dev/shot.mjs URL out.png [секунд] [w h]
import { chromium } from '@playwright/test';
const [url, out, secs = '6', w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.info('[console]', m.type(), m.text());
});
page.on('pageerror', (e) => console.info('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 }).catch(() => console.info('not ready'));
await page.waitForTimeout(+secs * 1000);
const st = await page.evaluate(() => window.__game?.status());
console.info(JSON.stringify(st));
await page.screenshot({ path: out });
await browser.close();
