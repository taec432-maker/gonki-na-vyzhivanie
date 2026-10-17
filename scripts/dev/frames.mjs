import { chromium } from '@playwright/test';
const [url, secs = '15', w = '1920', h = '1080'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => {
  if (m.type() === 'error') console.info('[console]', m.text());
});
await page.goto(url);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.__game.meter.history.splice(0));
await page.waitForTimeout(+secs * 1000);
const f = await page.evaluate(() => window.__game.meter.history.map((x) => Math.round(x)));
console.info(f.join(' '));
const st = await page.evaluate(() => window.__game.status());
console.info(JSON.stringify(st));
await browser.close();
