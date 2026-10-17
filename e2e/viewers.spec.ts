import { expect, test, type Page } from '@playwright/test';
import { collectErrors, shot, waitFrames, waitReady } from './helpers';

interface Status {
  phase: string;
  race: number;
  cars: number;
  roster: { id: string; name: string }[];
  queue: { id: string; name: string }[];
  standings: { playerId: string | null }[];
}
interface G {
  status(): Status;
  advance(n: number): void;
  advanceUntil(phase: string, maxSeconds?: number): Promise<boolean>;
  nameTags: { measure(): { name: string; height: number; fontPx: number; visible: boolean }[] };
}
const status = (p: Page): Promise<Status> => p.evaluate(() => (window as unknown as { __game: G }).__game.status());

test('зрители: +20 игроков из панели — 12 едут, 8 в очереди, после заезда очередь заходит; ники читаются', async ({
  page,
}) => {
  test.setTimeout(15 * 60_000);
  const errors = collectErrors(page);
  await page.goto('/?seed=42&bridge=off&fresh&laps=1');
  await waitReady(page);
  const control = await page.context().newPage();
  await control.goto('/control');
  await expect(control.getByText('Игра на связи')).toBeVisible({ timeout: 20_000 });
  await control.getByRole('button', { name: '+20 случайных игроков' }).click();
  await expect.poll(async () => (await status(page)).roster.length, { timeout: 20_000 }).toBe(12);
  let st = await status(page);
  expect(st.phase).toBe('lobby');
  expect(st.cars).toBe(12);
  expect(st.queue.length).toBe(8);
  expect(st.standings.every((c) => c.playerId !== null)).toBe(true);
  await expect(control.getByText('В заезде: 12 · в очереди: 8')).toBeVisible({ timeout: 10_000 });

  // 1080p: ники над 12 машинами в лобби (облёт решётки).
  await page.evaluate(() => (window as unknown as { __game: G }).__game.advance(60 * 6));
  await waitFrames(page, 4);
  const tags = await page.evaluate(() => (window as unknown as { __game: G }).__game.nameTags.measure());
  const visible = tags.filter((t) => t.visible);
  console.info(
    `видимых ников: ${visible.length}; шрифт ${Math.min(...visible.map((t) => t.fontPx)).toFixed(1)}–${Math.max(...visible.map((t) => t.fontPx)).toFixed(1)} px`,
  );
  expect(tags.length).toBe(12);
  expect(visible.length).toBeGreaterThanOrEqual(9);
  for (const t of visible) expect(t.fontPx).toBeGreaterThanOrEqual(18);
  await shot(page, '4-лобби-12-ников-1080p');

  const queued = st.queue.map((q) => q.id);
  const firstRoster = st.roster.map((q) => q.id);
  expect(await page.evaluate(() => (window as unknown as { __game: G }).__game.advanceUntil('race', 120))).toBe(true);
  await page.evaluate(() => (window as unknown as { __game: G }).__game.advance(60 * 8));
  expect(await page.evaluate(() => (window as unknown as { __game: G }).__game.advanceUntil('podium', 200))).toBe(true);
  await page.evaluate(() => (window as unknown as { __game: G }).__game.advance(30));
  await waitFrames(page, 3);
  await shot(page, '5-подиум');
  expect(await page.evaluate(() => (window as unknown as { __game: G }).__game.advanceUntil('lobby', 60))).toBe(true);
  st = await status(page);
  expect(st.race).toBe(1);
  const now = st.roster.map((q) => q.id);
  for (const id of queued) expect(now).toContain(id);
  expect(now.length).toBe(12);
  expect(st.queue.every((q) => firstRoster.includes(q.id))).toBe(true);
  expect(errors).toEqual([]);
});
