import { expect, test, type Page } from '@playwright/test';
import { collectErrors, shotDir, waitFrames, waitReady } from './helpers';

/** Этап 7: звук, церемония на подиуме, оверлей, настройки файлом, сброс сессии. */
interface Status {
  phase: string;
  race: number;
  roster: { id: string }[];
  queue: { id: string }[];
  leaderboard: { name: string; points: number }[];
  audio: { state: string; engines: number };
  settings: { session: { laps: number }; audio: { master: number; music: number; sfx: number } };
}
interface View {
  car: { id: number };
  pose: unknown;
  hidden: boolean;
}
interface GameHandle {
  status(): Status;
  advanceUntil(phase: string, maxSeconds?: number): Promise<boolean>;
  advance(n: number): void;
  mockViewers(n: number): void;
  mockGift(id: string | null, diamonds: number, count: number): void;
  session: { lastResults: { id: number }[] };
  views: Map<number, View>;
}
const st = (page: Page): Promise<Status> =>
  page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.status());

test('звук играет, моторы слышны, отсчёт и подарки без ошибок', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?seed=7&bridge=off&fresh&quick&bots=8&laps=1&quality=broadcast');
  await waitReady(page);
  await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.advanceUntil('race', 90));
  await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.advance(240));
  await waitFrames(page, 6);
  const s = await st(page);
  expect(s.audio.state).toBe('running');
  expect(s.audio.engines).toBeGreaterThan(0);
  await page.evaluate(() => {
    const g = (window as unknown as { __game: GameHandle }).__game;
    for (const d of [1, 10, 100, 1000, 5000]) g.mockGift(null, d, 1);
  });
  await waitFrames(page, 4);
  expect(errors).toEqual([]);
});

test('церемония: тройка на подиуме, остальные скрыты, очки на табло', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?seed=11&bridge=off&fresh&quick&bots=8&laps=1&track=port&quality=high');
  await waitReady(page);
  await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.mockViewers(4));
  expect(
    await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.advanceUntil('podium', 400)),
  ).toBe(true);
  await waitFrames(page, 8);
  const poses = await page.evaluate(() => {
    const g = (window as unknown as { __game: GameHandle }).__game;
    const top = g.session.lastResults.slice(0, 3).map((r) => r.id);
    return [...g.views.values()].map((v) => ({ top: top.includes(v.car.id), posed: !!v.pose, hidden: v.hidden }));
  });
  expect(poses.filter((p) => p.top).every((p) => p.posed && !p.hidden)).toBe(true);
  expect(poses.filter((p) => !p.top).every((p) => p.hidden)).toBe(true);
  await expect(page.locator('#podium .pd-title')).toContainText('Победитель');
  await expect(page.locator('#podium .pd-points').first()).toBeVisible();
  await page.screenshot({ path: `${shotDir()}/1-церемония-подиум.jpg`, type: 'jpeg', quality: 86, timeout: 180_000 });
  expect(errors).toEqual([]);
});

test('оверлей: прозрачный, лидерборд и лента из игры', async ({ page, context }) => {
  const errors = collectErrors(page);
  await page.goto('/?seed=5&bridge=off&fresh&quick&bots=8&laps=1&quality=broadcast');
  await waitReady(page);
  await page.evaluate(async () => {
    const g = (window as unknown as { __game: GameHandle }).__game;
    g.mockViewers(6);
    await g.advanceUntil('podium', 400);
    g.mockGift(null, 100, 1);
  });
  const overlay = await context.newPage();
  const oErrors = collectErrors(overlay);
  await overlay.goto('/overlay/');
  await expect(overlay.locator('#ov-lb li').first()).not.toHaveClass(/empty/, { timeout: 30_000 });
  await expect(overlay.locator('.ov-card').first()).toBeVisible();
  const bg = await overlay.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgba(0, 0, 0, 0)');
  // Как в OBS: оверлей поверх кадра игры (снимок игры + прозрачный оверлей сверху).
  await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.advanceUntil('race', 120));
  await waitFrames(page, 4);
  const game = (await page.screenshot({ type: 'png', timeout: 180_000 })).toString('base64');
  const over = (await overlay.screenshot({ type: 'png', omitBackground: true })).toString('base64');
  const data = await overlay.evaluate(
    async ({ game, over }) => {
      const c = document.createElement('canvas');
      c.width = 1920;
      c.height = 1080;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      for (const src of [game, over]) {
        const img = new Image();
        img.src = `data:image/png;base64,${src}`;
        await img.decode();
        ctx.drawImage(img, 0, 0, 1920, 1080);
      }
      return c.toDataURL('image/jpeg', 0.86).split(',')[1] as string;
    },
    { game, over },
  );
  const fs = await import('node:fs');
  fs.writeFileSync(`${shotDir()}/2-оверлей-поверх-игры.jpg`, Buffer.from(data, 'base64'));
  expect(errors).toEqual([]);
  expect(oErrors).toEqual([]);
});

test('панель: звук, настройки файлом туда и обратно, сброс сессии', async ({ page, context }) => {
  const errors = collectErrors(page);
  await page.goto('/?seed=9&bridge=off&fresh&bots=8&quality=broadcast');
  await waitReady(page);
  await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.mockViewers(5));
  const panel = await context.newPage();
  await panel.goto('/control/');
  await expect(panel.locator('#link')).toHaveText('Игра на связи');
  // Громкость музыки.
  await panel.locator('#vol-music').fill('0.2');
  await expect.poll(async () => (await st(page)).settings.audio.music).toBe(0.2);
  // Сохранить в файл → поменять круги → загрузить файл: круги вернулись.
  const [dl] = await Promise.all([panel.waitForEvent('download'), panel.click('#settings-save')]);
  const file = await dl.path();
  const before = (await st(page)).settings.session.laps;
  await panel.locator('#set-laps').fill(String(before === 5 ? 4 : 5));
  await panel.click('#set-apply');
  await expect.poll(async () => (await st(page)).settings.session.laps).not.toBe(before);
  await panel.setInputFiles('#settings-load', file);
  await expect(panel.locator('#settings-msg')).toContainText('загружены');
  await expect.poll(async () => (await st(page)).settings.session.laps).toBe(before);
  // Чужой файл — понятный отказ.
  await panel.setInputFiles('#settings-load', {
    name: 'x.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"a":1}'),
  });
  await expect(panel.locator('#settings-msg')).toContainText('не файл настроек');
  await panel.screenshot({
    path: `${shotDir()}/3-панель-звук-и-настройки.jpg`,
    type: 'jpeg',
    quality: 86,
    fullPage: true,
  });
  // Сброс сессии.
  expect((await st(page)).roster.length).toBeGreaterThan(0);
  panel.once('dialog', (d) => void d.accept());
  await panel.click('#session-reset');
  await expect.poll(async () => (await st(page)).roster.length + (await st(page)).queue.length).toBe(0);
  const after = await st(page);
  expect(after.race).toBe(0);
  expect(after.leaderboard).toEqual([]);
  expect(errors).toEqual([]);
});
