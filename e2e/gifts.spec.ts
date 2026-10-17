import { expect, test, type Page } from '@playwright/test';
import { collectErrors, shot, waitFrames, waitReady } from './helpers';

interface G {
  status(): {
    phase: string;
    roster: { id: string; name: string }[];
    likes: { bar: number; target: number; bursts: number };
    feed: { name: string; what: string; effect: string | null; test: boolean }[];
  };
  advance(n: number): void;
  advanceUntil(phase: string, maxSeconds?: number): Promise<boolean>;
  feed: { seconds: number };
  director: { manualId: number | null };
  session: { carForPlayer(id: string): { id: number } | undefined };
  sim: { combat: { projectiles: unknown[]; traps: unknown[]; has(car: unknown, e: string): boolean } };
}
const g = (p: Page) => p.evaluate(() => (window as unknown as { __game: G }).__game.status());

test('подарки: тест-подарок из панели даёт эффект машине дарителя, лента, лайки → общий нитро', async ({ page }) => {
  test.setTimeout(12 * 60_000);
  const errors = collectErrors(page);
  await page.goto('/?seed=42&bridge=off&fresh&quick');
  await waitReady(page);
  await page.evaluate(() => ((window as unknown as { __game: G }).__game.feed.seconds = 600));
  const control = await page.context().newPage();
  await control.goto('/control');
  await expect(control.getByText('Игра на связи')).toBeVisible({ timeout: 20_000 });
  await control.getByRole('button', { name: '+20 случайных игроков' }).click();
  await expect.poll(async () => (await g(page)).roster.length, { timeout: 20_000 }).toBe(12);
  expect(await page.evaluate(() => (window as unknown as { __game: G }).__game.advanceUntil('race', 60))).toBe(true);
  await page.evaluate(() => (window as unknown as { __game: G }).__game.advance(60 * 5));

  // Подарок от конкретного зрителя: щит (100 алмазов).
  const target = (await g(page)).roster[3]!;
  await expect(control.locator('#gf-who option', { hasText: target.name }).first()).toBeAttached({ timeout: 10_000 });
  await control.locator('#gf-who').selectOption(target.id);
  await control.locator('#gf-dia').fill('100');
  await control.getByRole('button', { name: 'Подарить' }).click();
  await expect.poll(async () => (await g(page)).feed.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.evaluate(() => (window as unknown as { __game: G }).__game.advance(3));
  const shielded = await page.evaluate((id) => {
    const gm = (window as unknown as { __game: G }).__game;
    const car = gm.session.carForPlayer(id);
    gm.director.manualId = car?.id ?? null;
    return !!car && gm.sim.combat.has(car, 'shield');
  }, target.id);
  expect(shielded).toBe(true);
  const feed = (await g(page)).feed;
  expect(feed.at(-1)).toMatchObject({ effect: 'shield', test: true });

  // Ракета (10 алмазов) от случайного участника и масло (60).
  await control.locator('#gf-who').selectOption('');
  await control.getByRole('button', { name: '10 💎' }).click();
  await control.getByRole('button', { name: '50 💎' }).click();
  await control.getByRole('button', { name: '1 💎', exact: true }).click();
  await expect.poll(async () => (await g(page)).feed.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
  await page.evaluate(() => (window as unknown as { __game: G }).__game.advance(4));
  await waitFrames(page, 3);
  await shot(page, '4-подарки-эффекты-и-лента');

  // Лайки ×50 десять раз — общий нитро.
  for (let i = 0; i < 10; i++) await control.getByRole('button', { name: 'Лайки ×50' }).click();
  await expect.poll(async () => (await g(page)).likes.bursts, { timeout: 10_000 }).toBe(1);
  expect((await g(page)).likes.bar).toBe(0);
  await expect(control.getByText('Bridge: выключен (мок-режим)')).toBeVisible();
  await control.locator('#mp-gifts').scrollIntoViewIfNeeded();
  await shot(control, '5-панель-подарки');
  expect(errors).toEqual([]);
});
