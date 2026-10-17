import { chromium } from '@playwright/test';
const [out, w = '1920', h = '1080'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.info('[console]', m.type(), m.text());
});
page.on('pageerror', (e) => console.info('[pageerror]', e.message));
await page.goto('http://127.0.0.1:8091/?seed=42&bridge=off&fresh&quality=broadcast&quick');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
await page.evaluate(async () => {
  const g = window.__game;
  g.mockViewers(10);
  await g.advanceUntil('race', 60);
  g.advance(60 * 6);
  const st = g.sim.standings();
  const pid = (car) => car.playerId;
  g.mockGift(pid(st[1]), 5, 1, 'Rose');
  g.mockGift(pid(st[0]), 100, 1, 'Hand Hearts');
  g.mockGift(pid(st[3]), 10, 2, 'Rosa');
  g.mockGift(pid(st[2]), 60, 1, 'Doughnut');
  g.advance(20);
  g.director.manualId = st[3].id;
});
const start = await page.evaluate(() => window.__game.frameCount);
await page.waitForFunction((n) => window.__game.frameCount > n + 4, start, { timeout: 120000 });
console.info(JSON.stringify((await page.evaluate(() => window.__game.status())).feed));
await page.screenshot({ path: out });
await browser.close();
