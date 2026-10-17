import { test, expect } from '@playwright/test';
import { collectErrors, shotDir, waitFrames, waitReady } from './helpers';

/** Каждый эффект раздела 7 — на одном общем снимке-сетке (docs/screenshots/этап-4/4-все-эффекты.jpg). */
const EFFECTS: { id: string; label: string; steps: number; cam: 'self' | 'ahead' | 'behind' }[] = [
  { id: 'nitro', label: 'Нитро', steps: 12, cam: 'self' },
  { id: 'rocket', label: 'Ракета', steps: 7, cam: 'self' },
  { id: 'repair', label: 'Ремонт', steps: 3, cam: 'self' },
  { id: 'oil', label: 'Масло', steps: 30, cam: 'behind' },
  { id: 'shield', label: 'Щит', steps: 5, cam: 'self' },
  { id: 'mines', label: 'Мины', steps: 65, cam: 'behind' },
  { id: 'emp', label: 'ЭМИ', steps: 10, cam: 'ahead' },
  { id: 'monster', label: 'Монстр', steps: 40, cam: 'self' },
  { id: 'armageddon', label: 'Армагеддон', steps: 62, cam: 'ahead' },
  { id: 'teleport', label: 'Телепорт', steps: 4, cam: 'self' },
  { id: 'nails', label: 'Гвозди', steps: 20, cam: 'behind' },
  { id: 'ghost', label: 'Призрак', steps: 10, cam: 'self' },
  { id: 'magnet', label: 'Магнит', steps: 40, cam: 'self' },
  { id: 'joke', label: 'Шутка', steps: 10, cam: 'ahead' },
  { id: 'swapcar', label: 'Смена машины', steps: 10, cam: 'self' },
  { id: 'revive', label: 'Воскрешение', steps: 20, cam: 'self' },
];

test('витрина: все 16 эффектов на одном снимке', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto('/?seed=7&bridge=off&fresh&quick&quality=broadcast');
  await waitReady(page);
  await page.evaluate(async () => {
    const g = (
      window as unknown as {
        __game: {
          mockViewers(n: number): void;
          advanceUntil(p: string, s: number): Promise<boolean>;
          advance(n: number): void;
          feed: { seconds: number };
        };
      }
    ).__game;
    g.feed.seconds = 20;
    g.mockViewers(8);
    await g.advanceUntil('race', 60);
    g.advance(60 * 8);
  });
  const shots: string[] = [];
  for (const e of EFFECTS) {
    await page.evaluate(
      ({ id, steps, cam }) => {
        const g = (window as unknown as { __game: any }).__game; // eslint-disable-line @typescript-eslint/no-explicit-any
        // Чистый кадр для каждого эффекта: снять прошлые эффекты, ловушки, снаряды, починить машины.
        g.sim.combat.active.clear();
        g.sim.combat.traps.length = 0;
        g.sim.combat.projectiles.length = 0;
        for (const c of g.sim.cars) if (!c.race.out && !c.wrecked) c.hp = c.maxHp;
        const st = g.sim.standings().filter((c: { race: { out: boolean } }) => !c.race.out);
        const i = Math.min(2, st.length - 2);
        const car = st[i];
        const target = cam === 'ahead' ? st[i - 1] : cam === 'behind' ? st[i + 1] : car;
        if (id === 'repair') car.hp = car.maxHp * 0.4;
        if (id === 'revive') {
          // Воскрешение показываем в «Выживании»: машина выбыла и вернулась.
          g.sim.config.mode = 'survival';
          g.sim.combat.damage(car, 999, 'test');
          g.advance(200);
        }
        g.director.manualId = target.id;
        g.sim.combat.enqueue(car.id, id, 1, { from: car.name, giftName: 'Подарок', via: 'gift' });
        g.advance(steps);
        if (id === 'revive') g.sim.config.mode = 'race';
      },
      { id: e.id, steps: e.steps, cam: e.cam },
    );
    await waitFrames(page, 3);
    shots.push((await page.screenshot({ type: 'jpeg', quality: 80 })).toString('base64'));
  }
  // Склеиваем 4×4 с подписями прямо в браузере.
  const sheet = await page.evaluate(
    async ({ images, labels }) => {
      const W = 480;
      const H = 270;
      const c = document.createElement('canvas');
      c.width = W * 4;
      c.height = H * 4;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      for (let i = 0; i < images.length; i++) {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${images[i]}`;
        await img.decode();
        const x = (i % 4) * W;
        const y = Math.floor(i / 4) * H;
        ctx.drawImage(img, x, y, W, H);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(x, y + H - 34, W, 34);
        ctx.fillStyle = '#ffcc00';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText(`${i + 1}. ${labels[i]}`, x + 10, y + H - 10);
      }
      return c.toDataURL('image/jpeg', 0.85).split(',')[1] as string;
    },
    { images: shots, labels: EFFECTS.map((e) => e.label) },
  );
  const fs = await import('node:fs');
  fs.writeFileSync(`${shotDir()}/4-все-эффекты.jpg`, Buffer.from(sheet, 'base64'));
  expect(shots.length).toBe(16);
  expect(errors).toEqual([]);
});
