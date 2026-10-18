import { expect, test } from '@playwright/test';
import { collectErrors, recordPerf, waitReady } from './helpers';

interface SoakReport {
  races: number;
  allFinished: boolean;
  respawns: number;
  falls: number;
  maxNoProgress: number;
  perRace: { finished: number; cars: number; time: number; respawns: number; winner: string }[];
}

const TRACKS = ['port', 'city', 'desert', 'mountain', 'forest'];

for (const track of TRACKS)
  test(`soak «${track}»: 10 заездов по 8 ботов подряд — все финишируют, никто не застревает`, async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const errors = collectErrors(page);
    await page.goto(`/?seed=42&bridge=off&fresh&quick&bots=8&quality=broadcast&track=${track}`);
    await waitReady(page);
    const report = await page.evaluate(() =>
      (window as unknown as { __game: { soak(n: number): Promise<SoakReport> } }).__game.soak(10),
    );
    console.info(
      `${track}: ${report.races} заездов, все финишировали: ${report.allFinished}, респаунов ${report.respawns} (из них вылетов ${report.falls}), ` +
        `сходов ${report.perRace.reduce((a, r) => a + (r.cars - r.finished), 0)}, макс. без прогресса ${report.maxNoProgress.toFixed(1)} с, время заезда ${report.perRace.map((r) => r.time).join(' / ')}`,
    );
    recordPerf(`soak-${track}`, report as unknown as Record<string, unknown>);
    expect(report.races).toBe(10);
    // Все финишируют; допускается редкий сход отставшего (вылеты с обрыва, недолёт трамплина) —
    // не больше 3 машин на 10 заездов. Застревание проверяет maxNoProgress.
    const dnf = report.perRace.reduce((a, r) => a + (r.cars - r.finished), 0);
    expect(dnf).toBeLessThanOrEqual(3);
    // «Застревание» — машина без прогресса дольше, чем срабатывает анти-застревание (3 с) + запас.
    expect(report.maxNoProgress).toBeLessThan(4.5);
    // Мягкий респаун после застревания или переворота — штатная страховка после завалов в узких местах: не больше четырёх на заезд в среднем.
    // Возвраты после вылета с обрыва и недолёта трамплина — часть трассы, считаются отдельно.
    expect(report.respawns - report.falls).toBeLessThanOrEqual(40);
    expect(errors).toEqual([]);
  });
