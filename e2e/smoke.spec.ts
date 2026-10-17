import { expect, test } from '@playwright/test';
import { collectErrors, gpuInfo, recordPerf, shot, waitFrames, waitReady } from './helpers';

interface GameHandle {
  ready: boolean;
  status(): {
    state: string;
    tick: number;
    drawCalls: number;
    cars: number;
    simMs: number;
    cpuMs: number;
    triangles: number;
  };
  advance(n: number): void;
  advanceUntil(phase: string, maxSeconds?: number): Promise<boolean>;
  setCameraMode(m: string): void;
  meter: { history: number[] };
  errors: string[];
}

test('smoke: игра загружается, машина едет, кадр без провалов', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?seed=42&bridge=off&fresh&bots=8');
  await waitReady(page);
  const gpu = await gpuInfo(page);
  const software = /swiftshader|llvmpipe|software/i.test(gpu);

  // Дождаться первой гонки (решётка → отсчёт → старт).
  expect(await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.advanceUntil('race', 90))).toBe(
    true,
  );
  // ≥ 10 с симуляции (600 шагов) — синхронно, чтобы не зависеть от скорости SwiftShader.
  const before = await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.status().tick);
  await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.advance(600));
  const st = await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.status());
  expect(st.tick - before).toBeGreaterThanOrEqual(600);
  expect(st.state).toBe('running');
  expect(st.cars).toBeGreaterThan(0);

  // Замер кадров: 14 кадров реального рендера (в SwiftShader это ~15 с, на GPU — четверть секунды).
  await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.meter.history.splice(0));
  await waitFrames(page, 14);
  // Первые кадры после синхронной перемотки отражают её время, а не рендер — отбрасываем.
  const frames = await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.meter.history.slice(2));
  frames.sort((a, b) => a - b);
  const median = frames[Math.floor(frames.length / 2)] ?? 0;
  const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0;
  const st2 = await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.status());
  recordPerf('smoke', {
    gpu,
    frames: frames.length,
    medianMs: median,
    p95Ms: p95,
    drawCalls: st2.drawCalls,
    triangles: st2.triangles,
    simMsPerStep: st2.simMs,
    cpuMsPerFrame: st2.cpuMs,
  });
  expect(st2.drawCalls).toBeLessThanOrEqual(300);
  console.info(`GPU: ${gpu}; кадров ${frames.length}, медиана ${median.toFixed(1)} мс, p95 ${p95.toFixed(1)} мс`);
  // Порог адаптивный: на настоящем GPU — 60 fps-класс, в SwiftShader важно отсутствие провалов.
  if (software) {
    // SwiftShader рисует 1080p на процессоре за секунды — проверяем, что кадры идут и нет зависаний.
    expect(frames.length).toBeGreaterThanOrEqual(10);
    expect(median).toBeLessThan(6000);
    expect(p95).toBeLessThan(median * 5 + 2000);
    // Процессорная часть кадра (симуляция + подготовка сцены) обязана укладываться в бюджет 16 мс.
    expect(st2.cpuMs).toBeLessThan(16);
  } else {
    expect(1000 / median).toBeGreaterThan(50);
  }

  await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.setCameraMode('overview'));
  await waitFrames(page, 2);
  await shot(page, '1-общий-план');
  await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.setCameraMode('chase'));
  await waitFrames(page, 3);
  await shot(page, '2-за-лидером');

  const control = await page.context().newPage();
  const controlErrors = collectErrors(control);
  await control.goto('/control');
  await expect(control.getByText('Игра на связи')).toBeVisible({ timeout: 20_000 });
  await shot(control, '3-панель');

  const gameErrors = await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.errors);
  expect(gameErrors).toEqual([]);
  expect(errors).toEqual([]);
  expect(controlErrors).toEqual([]);
});

test('панель: стоп и старт управляют игрой', async ({ page }) => {
  await page.goto('/?seed=7&bridge=off&fresh');
  await waitReady(page);
  const control = await page.context().newPage();
  await control.goto('/control');
  await expect(control.getByText('Игра на связи')).toBeVisible({ timeout: 20_000 });
  await control.getByRole('button', { name: 'Стоп', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.status().state))
    .toBe('stopped');
  await control.getByRole('button', { name: 'Старт', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.status().state))
    .toBe('running');
});
