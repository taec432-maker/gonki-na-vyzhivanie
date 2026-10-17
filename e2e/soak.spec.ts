import { expect, test } from '@playwright/test';
import { collectErrors, recordPerf, waitReady } from './helpers';

interface SoakReport {
  races: number;
  allFinished: boolean;
  respawns: number;
  maxNoProgress: number;
  perRace: { finished: number; cars: number; time: number; respawns: number; winner: string }[];
}

test('soak: 10 заездов по 8 ботов подряд — все финишируют, никто не застревает', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  const errors = collectErrors(page);
  await page.goto('/?seed=42&bridge=off&fresh&quick&bots=8&quality=broadcast');
  await waitReady(page);
  const report = await page.evaluate(() =>
    (window as unknown as { __game: { soak(n: number): Promise<SoakReport> } }).__game.soak(10),
  );
  console.info(JSON.stringify(report, null, 1));
  recordPerf('soak', report as unknown as Record<string, unknown>);
  expect(report.races).toBe(10);
  expect(report.allFinished).toBe(true);
  for (const r of report.perRace) expect(r.finished).toBe(r.cars);
  // «Застревание» — машина без прогресса дольше, чем срабатывает анти-застревание (3 с) + запас.
  expect(report.maxNoProgress).toBeLessThan(4.5);
  // Мягкий респаун — штатная страховка, но не норма: в среднем не больше одного на заезд.
  expect(report.respawns).toBeLessThanOrEqual(10);
  expect(errors).toEqual([]);
});
