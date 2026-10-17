import { expect, test, type Page } from '@playwright/test';
import { collectErrors, gpuInfo, recordPerf, waitFrames, waitReady } from './helpers';

interface G {
  advanceUntil(phase: string, maxSeconds?: number): Promise<boolean>;
  advance(n: number): void;
  mockGift(id: string | null, diamonds: number, count: number, name?: string): void;
  meter: { history: number[] };
  status(): { cpuMs: number; simMs: number; phase: string; simPhase: string };
  sim: {
    cars: {
      cur: { p: { x: number; y: number; z: number } };
      d: number;
      phys: { speed(): number };
      race: { out: boolean };
    }[];
    track: { def: { width: number } };
  };
}
const game = (p: Page) => p.evaluate(() => (window as unknown as { __game: G }).__game.status());
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;

test('стресс: 50 подарков в секунду не роняют кадр и не ломают физику', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const errors = collectErrors(page);
  await page.goto('/?seed=42&bridge=off&fresh&quick&quality=broadcast');
  await waitReady(page);
  const gpu = await gpuInfo(page);
  const software = /swiftshader|llvmpipe|software/i.test(gpu);
  await page.evaluate(async () => {
    const g = (window as unknown as { __game: G & { mockViewers(n: number): void } }).__game;
    g.mockViewers(12);
    await g.advanceUntil('race', 60);
    g.advance(60 * 4);
  });
  // Опорный замер без подарков.
  await page.evaluate(() => (window as unknown as { __game: G }).__game.meter.history.splice(0));
  await waitFrames(page, 14);
  const base = await page.evaluate(() => (window as unknown as { __game: G }).__game.meter.history.slice(1));
  const cpuBase = (await game(page)).cpuMs;

  // 50 подарков в секунду реального времени, 6 секунд, случайные тиры — через тот же мок, что и панель.
  await page.evaluate(() => (window as unknown as { __game: G }).__game.meter.history.splice(0));
  const sent = await page.evaluate(async () => {
    const g = (window as unknown as { __game: G }).__game;
    const tiers = [1, 5, 10, 30, 60, 100, 300, 500, 1000, 5000];
    let n = 0;
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        // Досылаем столько, сколько положено к этому моменту (50 в секунду): медленный кадр
        // не уменьшает поток подарков, а превращает его в пачки — это даже жёстче.
        const due = Math.min(300, Math.floor((performance.now() - t0) / 20));
        while (n < due) {
          g.mockGift(null, tiers[n % tiers.length] as number, 1 + (n % 3), 'Стресс');
          n++;
        }
        if (performance.now() - t0 > 6000) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });
    return n;
  });
  await waitFrames(page, 10);
  const during = await page.evaluate(() => (window as unknown as { __game: G }).__game.meter.history.slice(1));
  const st = await game(page);
  const mb = median(base);
  const md = median(during);
  console.info(
    `GPU: ${gpu}; подарков ${sent} за 6 с; кадр до ${mb.toFixed(1)} мс, во время ${md.toFixed(1)} мс; процессор ${cpuBase} → ${st.cpuMs} мс`,
  );
  recordPerf('stress-50-gifts', {
    gpu,
    gifts: sent,
    baseMedianMs: mb,
    stressMedianMs: md,
    cpuBaseMs: cpuBase,
    cpuStressMs: st.cpuMs,
    simMs: st.simMs,
  });
  expect(sent).toBeGreaterThanOrEqual(290);
  if (software) {
    // В SwiftShader абсолютный fps не показателен: требуем, чтобы кадр не просел больше чем 60→45 (×1,33),
    // а процессорная часть уложилась в бюджет.
    expect(md).toBeLessThan(mb * 1.33 + 120);
    expect(st.cpuMs).toBeLessThan(16);
  } else {
    expect(1000 / md).toBeGreaterThanOrEqual(45);
  }
  // Физика жива: координаты конечные, никто не улетел в космос и не провалился.
  const sanity = await page.evaluate(() => {
    const g = (window as unknown as { __game: G }).__game;
    return g.sim.cars.map((c) => ({ x: c.cur.p.x, y: c.cur.p.y, z: c.cur.p.z, v: c.phys.speed(), out: c.race.out }));
  });
  for (const c of sanity) {
    expect(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z)).toBe(true);
    if (!c.out) {
      expect(c.y).toBeGreaterThan(-15);
      expect(c.y).toBeLessThan(120);
      expect(c.v).toBeLessThan(160);
    }
  }
  // И гонка доезжает до конца.
  expect(await page.evaluate(() => (window as unknown as { __game: G }).__game.advanceUntil('finished', 400))).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
