import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, gpuInfo, recordPerf, shotDir, waitFrames, waitReady } from './helpers';

/** Этап 5: картинка — профиль кадра по уровням качества и витрина (день, суперкар, ночь с дождём). */
interface Status {
  drawCalls: number;
  triangles: number;
  cpuMs: number;
  simMs: number;
  renderMs: number;
  cars: number;
  quality: string;
  features: string[];
}
interface GameHandle {
  status(): Status;
  advanceUntil(phase: string, maxSeconds?: number): Promise<boolean>;
  advance(n: number): void;
  sim: { standings(): { id: number }[] };
  director: { manualId: number | null; closeUp: boolean };
  meter: { history: number[] };
}

const LABEL: Record<string, string> = { high: 'Высокое', medium: 'Среднее', broadcast: 'Эфир' };

async function openRace(page: Page, query: string, seconds: number): Promise<void> {
  await page.goto(`/?seed=42&bridge=off&fresh&quick${query}`);
  await waitReady(page);
  await page.evaluate(async (s: number) => {
    const g = (window as unknown as { __game: GameHandle }).__game;
    await g.advanceUntil('race', 60);
    g.advance(Math.round(s * 60));
  }, seconds);
}

async function jpeg(page: Page): Promise<string> {
  return (await page.screenshot({ type: 'jpeg', quality: 86, timeout: 180_000 })).toString('base64');
}

test('картинка: профиль кадра по качеству (≤ 300 draw calls), день, суперкар, ночь с дождём', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const errors = collectErrors(page);
  const profile: Record<string, unknown>[] = [];
  const tiles: string[] = [];
  let gpu = '';
  for (const q of ['high', 'medium', 'broadcast'] as const) {
    // 12 обычных машин; суперкары (GLB) — отдельно ниже, 6 штук сразу.
    await openRace(page, `&bots=12&quality=${q}`, 8);
    gpu ||= await gpuInfo(page);
    await waitFrames(page, 6);
    await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.meter.history.splice(0));
    await waitFrames(page, 8);
    const st = await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.status());
    const frames = await page.evaluate(() =>
      (window as unknown as { __game: GameHandle }).__game.meter.history.slice(1).sort((a, b) => a - b),
    );
    const row = {
      quality: q,
      features: st.features.join(', '),
      cars: st.cars,
      drawCalls: st.drawCalls,
      triangles: st.triangles,
      cpuMs: st.cpuMs,
      simMsPerStep: st.simMs,
      renderMs: st.renderMs,
      frameMedianMs: frames[Math.floor(frames.length / 2)] ?? 0,
    };
    profile.push(row);
    expect(st.cars).toBe(12);
    expect(st.drawCalls).toBeLessThanOrEqual(300);
    // Процессорная часть кадра (без отрисовки) — в бюджете 16 мс с запасом.
    expect(st.cpuMs).toBeLessThan(10);
    tiles.push(await jpeg(page));
    if (q === 'high')
      fs.writeFileSync(`${shotDir()}/1-порт-день-высокое.jpg`, Buffer.from(tiles[0] as string, 'base64'));
  }
  recordPerf('picture', { gpu, profile });
  console.info(`GPU: ${gpu}`);
  for (const r of profile) console.info(JSON.stringify(r));

  // Три уровня качества рядом.
  const sheet = await page.evaluate(
    async ({ images, labels }) => {
      const W = 640;
      const H = 360;
      const c = document.createElement('canvas');
      c.width = W * 3;
      c.height = H;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      for (let i = 0; i < images.length; i++) {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${images[i]}`;
        await img.decode();
        ctx.drawImage(img, i * W, 0, W, H);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(i * W, H - 40, W, 40);
        ctx.fillStyle = '#ffcc00';
        ctx.font = 'bold 26px sans-serif';
        ctx.fillText(labels[i] as string, i * W + 12, H - 13);
      }
      return c.toDataURL('image/jpeg', 0.88).split(',')[1] as string;
    },
    {
      images: tiles,
      labels: profile.map((r) => `${LABEL[String(r.quality)]}: ${String(r.drawCalls)} draw calls`),
    },
  );
  fs.writeFileSync(`${shotDir()}/4-качество-высокое-среднее-эфир.jpg`, Buffer.from(sheet, 'base64'));

  // Суперкар (настоящая glTF-модель) крупным планом.
  await openRace(page, '&bots=6&car=supercar&quality=high', 6);
  await page.evaluate(() => {
    const g = (window as unknown as { __game: GameHandle }).__game;
    g.director.manualId = g.sim.standings()[1]?.id ?? null;
    g.director.closeUp = true;
  });
  await waitFrames(page, 8);
  const sc = await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.status());
  expect(sc.drawCalls).toBeLessThanOrEqual(300);
  fs.writeFileSync(`${shotDir()}/2-суперкар-крупный-план.jpg`, Buffer.from(await jpeg(page), 'base64'));

  // Ночь, дождь, мокрый асфальт (система погоды для ночного города этапа 6).
  await openRace(page, '&bots=12&quality=high&light=port-night', 50);
  await waitFrames(page, 8);
  fs.writeFileSync(`${shotDir()}/3-порт-ночь-дождь-мокрый-асфальт.jpg`, Buffer.from(await jpeg(page), 'base64'));

  expect(errors).toEqual([]);
});
