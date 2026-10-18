// Все машины ростера крупными планами одной сеткой: node scripts/dev/showroom.mjs out.jpg [query]
import fs from 'node:fs';
import { chromium } from '@playwright/test';
const [out, query = '&quality=broadcast'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.info('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:8091/?seed=42&bridge=off&fresh&quick&bots=16${query}`);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 90000 });
await page.evaluate(async () => {
  const g = window.__game;
  await g.advanceUntil('race', 60);
  g.advance(60 * 3);
});
const specs = await page.evaluate(() => window.__game.vehicles.map((v) => `${v.number}. ${v.name}`));
const shots = [];
for (let i = 0; i < specs.length; i++) {
  await page.evaluate((i) => {
    const g = window.__game;
    const car = g.sim.cars[i];
    g.sim.swapVehicle(car, g.vehicles[i]);
    g.stepper.timeScale = 0;
    g.director.manualId = car.id;
    g.director.closeUp = true;
  }, i);
  const s = await page.evaluate(() => window.__game.frameCount);
  await page.waitForFunction((n) => window.__game.frameCount > n + 4, s, { timeout: 120000 });
  shots.push((await page.screenshot({ type: 'jpeg', quality: 80, timeout: 120000 })).toString('base64'));
}
const sheet = await page.evaluate(
  async ({ images, labels }) => {
    const W = 480;
    const H = 270;
    const c = document.createElement('canvas');
    c.width = W * 4;
    c.height = H * Math.ceil(images.length / 4);
    const ctx = c.getContext('2d');
    for (let i = 0; i < images.length; i++) {
      const img = new Image();
      img.src = `data:image/jpeg;base64,${images[i]}`;
      await img.decode();
      const x = (i % 4) * W;
      const y = Math.floor(i / 4) * H;
      ctx.drawImage(img, x, y, W, H);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x, y + H - 34, W, 34);
      ctx.fillStyle = '#ffcc00';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(labels[i], x + 10, y + H - 10);
    }
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  },
  { images: shots, labels: specs },
);
fs.writeFileSync(out, Buffer.from(sheet, 'base64'));
await browser.close();
