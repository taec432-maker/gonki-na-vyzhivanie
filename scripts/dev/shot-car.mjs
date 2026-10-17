// Крупный план машины: node scripts/dev/shot-car.mjs out.jpg "&car=supercar&quality=high" [секунд гонки] [место] [w h]
import { chromium } from '@playwright/test';
const [out, query = '', secs = '6', place = '0', w = '1920', h = '1080'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.info('[console]', m.type(), m.text());
});
page.on('pageerror', (e) => console.info('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:8091/?seed=42&bridge=off&fresh&quick${query}`);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 90000 });
await page.evaluate(
  async ([s, pl]) => {
    const g = window.__game;
    await g.advanceUntil('race', 60);
    g.advance(Math.round(s * 60));
    g.director.manualId = g.sim.standings()[pl].id;
    g.director.closeUp = true;
  },
  [+secs, +place],
);
const start = await page.evaluate(() => window.__game.frameCount);
await page.waitForFunction((n) => window.__game.frameCount > n + 6, start, { timeout: 180000 });
const st = await page.evaluate(() => window.__game.status());
console.info(
  JSON.stringify({ drawCalls: st.drawCalls, triangles: st.triangles, cpuMs: st.cpuMs, quality: st.quality }),
);
await page.screenshot({ path: out, type: 'jpeg', quality: 88, timeout: 180000 });
await browser.close();
