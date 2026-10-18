import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, shotDir, waitFrames, waitReady } from './helpers';

/** Этап 6: все трассы днём и ночью, выбор машины из чата, все 16 машин. */
interface Status {
  drawCalls: number;
  track: string;
  phase: string;
  standings: { id: number; name: string; playerId: string | null; vehicle: string }[];
}
interface GameHandle {
  status(): Status;
  advanceUntil(phase: string, maxSeconds?: number): Promise<boolean>;
  advance(n: number): void;
  vehicles: { id: string; number: number; name: string }[];
  sim: { cars: { id: number }[]; swapVehicle(car: unknown, spec: unknown): void };
  director: { manualId: number | null; closeUp: boolean };
  stepper: { timeScale: number };
}

const TRACKS: [string, string, string][] = [
  ['port', 'Порт', 'port-night'],
  ['city', 'Ночной город', 'city-night'],
  ['desert', 'Каньон', 'desert-night'],
  ['mountain', 'Серпантин', 'mountain-night'],
  ['forest', 'Зимний лес', 'forest-night'],
];

async function jpeg(page: Page): Promise<string> {
  return (await page.screenshot({ type: 'jpeg', quality: 82, timeout: 180_000 })).toString('base64');
}

/** Склейка снимков сеткой с подписями (в браузере). */
async function sheet(page: Page, images: string[], labels: string[], cols: number, file: string): Promise<void> {
  const data = await page.evaluate(
    async ({ images, labels, cols }) => {
      const W = 640;
      const H = 360;
      const c = document.createElement('canvas');
      c.width = W * cols;
      c.height = H * Math.ceil(images.length / cols);
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < images.length; i++) {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${images[i]}`;
        await img.decode();
        const x = (i % cols) * W;
        const y = Math.floor(i / cols) * H;
        ctx.drawImage(img, x, y, W, H);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(x, y + H - 38, W, 38);
        ctx.fillStyle = '#ffcc00';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText(labels[i] as string, x + 12, y + H - 11);
      }
      return c.toDataURL('image/jpeg', 0.86).split(',')[1] as string;
    },
    { images, labels, cols },
  );
  fs.writeFileSync(`${shotDir()}/${file}`, Buffer.from(data, 'base64'));
}

test('трассы: все пять днём и ночью — гонка идёт, ≤ 300 draw calls', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  const errors = collectErrors(page);
  const day: string[] = [];
  const night: string[] = [];
  for (const [id, , nightPreset] of TRACKS)
    for (const light of ['', nightPreset]) {
      await page.goto(
        `/?seed=42&bridge=off&fresh&quick&bots=10&quality=broadcast&track=${id}${light ? `&light=${light}` : ''}`,
      );
      await waitReady(page);
      await page.evaluate(async () => {
        const g = (window as unknown as { __game: GameHandle }).__game;
        await g.advanceUntil('race', 60);
        g.advance(60 * 22);
      });
      await waitFrames(page, 6);
      const st = await page.evaluate(() => (window as unknown as { __game: GameHandle }).__game.status());
      expect(st.track).toBe(id);
      expect(st.phase).toBe('race');
      expect(st.drawCalls).toBeLessThanOrEqual(300);
      (light ? night : day).push(await jpeg(page));
    }
  await sheet(
    page,
    day,
    TRACKS.map((t) => `${t[1]} — день`),
    3,
    '1-трассы-день.jpg',
  );
  await sheet(
    page,
    night,
    TRACKS.map((t) => `${t[1]} — ночь`),
    3,
    '2-трассы-ночь.jpg',
  );
  expect(errors).toEqual([]);
});

test('выбор машины из чата: «машина 6» в лобби — пикап сразу; список машин на экране лобби', async ({
  page,
  context,
}) => {
  test.setTimeout(10 * 60_000);
  const errors = collectErrors(page);
  await page.goto('/?seed=42&bridge=off&fresh&quality=broadcast');
  await waitReady(page);
  const control = await context.newPage();
  await control.goto('/control');
  await control.locator('#chat-name').fill('Пикапыч');
  await control.locator('#chat-text').fill('машина 6');
  await control.getByRole('button', { name: 'Написать в чат' }).click();
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as unknown as { __game: GameHandle }).__game
              .status()
              .standings.find((c) => c.playerId === 'manual-Пикапыч')?.vehicle,
        ),
      { timeout: 60_000 },
    )
    .toBe('pickup');
  // Редкая без подарка — отказ, машина прежняя.
  await control.locator('#chat-text').fill('машина 1');
  await control.getByRole('button', { name: 'Написать в чат' }).click();
  await expect(page.locator('#feed')).toContainText('нужен подарок', { timeout: 60_000 });
  await expect(page.locator('#lobby')).toContainText('машина 7');
  await expect(page.locator('#lobby')).toContainText('Мусоровоз');
  await waitFrames(page, 3);
  fs.writeFileSync(`${shotDir()}/4-лобби-выбор-машины-из-чата.jpg`, Buffer.from(await jpeg(page), 'base64'));
  expect(errors).toEqual([]);
});

test('витрина: все 16 машин ростера', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto('/?seed=42&bridge=off&fresh&quick&bots=16&quality=broadcast');
  await waitReady(page);
  await page.evaluate(async () => {
    const g = (window as unknown as { __game: GameHandle }).__game;
    await g.advanceUntil('race', 60);
    g.advance(60 * 3);
  });
  const labels = await page.evaluate(() =>
    (window as unknown as { __game: GameHandle }).__game.vehicles.map((v) => `${v.number}. ${v.name}`),
  );
  expect(labels.length).toBe(16);
  const shots: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    await page.evaluate((i) => {
      const g = (window as unknown as { __game: GameHandle }).__game;
      const car = g.sim.cars[i] as { id: number };
      g.sim.swapVehicle(car, g.vehicles[i]);
      g.stepper.timeScale = 0;
      g.director.manualId = car.id;
      g.director.closeUp = true;
    }, i);
    await waitFrames(page, 4);
    shots.push(await jpeg(page));
  }
  await sheet(page, shots, labels, 4, '3-все-16-машин.jpg');
});
