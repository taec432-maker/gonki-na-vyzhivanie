import { expect, test } from '@playwright/test';
import { collectErrors, shot, waitFrames, waitReady } from './helpers';

interface G {
  advanceUntil(phase: string, maxSeconds?: number): Promise<boolean>;
  advance(n: number): void;
  status(): { phase: string; standings: { finished: boolean }[] };
}
const game = 'window.__game';

/** Скриншоты-витрина этапа: старт с облётом, борьба в гонке, таблица результатов. */
test('витрина: решётка, гонка, результаты', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const errors = collectErrors(page);
  await page.goto('/?seed=42&bridge=off&fresh&bots=8');
  await waitReady(page);
  await page.evaluate(`${game}.advance(60)`);
  await waitFrames(page, 3);
  await shot(page, '4-решётка-облёт');
  await page.evaluate(() => (window as unknown as { __game: G }).__game.advanceUntil('race', 30));
  await page.evaluate(() => (window as unknown as { __game: G }).__game.advance(60 * 4));
  await waitFrames(page, 3);
  await shot(page, '5-старт-гонки');
  expect(await page.evaluate(() => (window as unknown as { __game: G }).__game.advanceUntil('finished', 400))).toBe(
    true,
  );
  await page.evaluate(() => (window as unknown as { __game: G }).__game.advance(30));
  await waitFrames(page, 3);
  await shot(page, '6-результаты');
  const st = await page.evaluate(() => (window as unknown as { __game: G }).__game.status());
  expect(st.standings.every((c) => c.finished)).toBe(true);
  expect(errors).toEqual([]);
});
