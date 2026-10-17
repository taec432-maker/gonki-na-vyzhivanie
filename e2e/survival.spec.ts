import { expect, test } from '@playwright/test';
import { collectErrors, shot, waitFrames, waitReady } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('выживание: режим из панели, взрывы и выбывание, HP под никами, очки сессии', async ({ page }) => {
  test.setTimeout(12 * 60_000);
  const errors = collectErrors(page);
  await page.goto('/?seed=11&bridge=off&fresh&quick');
  await waitReady(page);
  const control = await page.context().newPage();
  await control.goto('/control');
  await expect(control.getByText('Игра на связи')).toBeVisible({ timeout: 20_000 });
  await control.locator('#set-mode').selectOption('survival');
  await control.locator('#set-laps').fill('1');
  await control.getByRole('button', { name: 'Применить' }).first().click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__game.session.settings.mode), { timeout: 10_000 })
    .toBe('survival');
  await control.getByRole('button', { name: 'Следующий заезд' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__game.sim.config.mode), { timeout: 10_000 })
    .toBe('survival');
  await page.evaluate(async () => {
    const g = (window as any).__game;
    g.feed.seconds = 120;
    g.mockViewers(8);
    await g.advanceUntil('race', 60);
    g.advance(60 * 6);
    // Армагеддон от лидера дважды: остальные теряют по 100 HP и взрываются.
    const lead = g.sim.standings()[0];
    g.sim.combat.enqueue(lead.id, 'armageddon', 1, { from: lead.name, giftName: 'Universe', via: 'gift' });
    g.advance(60 * 3);
    // Добиваем двоих: взрыв, горящий остов, через 2,5 с — выбывание.
    const st = g.sim.standings();
    st[5].lastHitBy = st[4].id;
    st[5].lastHitTick = g.sim.tick;
    g.sim.combat.damage(st[5], 999, 'ram', st[4].id);
    g.advance(60 * 3);
    g.sim.combat.damage(st[3], 999, 'rocket', st[2].id);
    g.director.manualId = st[3].id;
    g.advance(40);
  });
  await waitFrames(page, 3);
  await shot(page, '5-выживание-hp-и-взрывы');
  const st = await page.evaluate(() => {
    const g = (window as any).__game;
    return {
      hpMin: Math.min(...g.sim.cars.map((c: any) => c.hp)),
      anyWrecked: g.sim.cars.some((c: any) => c.wrecked || c.race.out),
    };
  });
  expect(st.anyWrecked || st.hpMin < 60).toBe(true);
  expect(await page.evaluate(() => (window as any).__game.advanceUntil('podium', 400))).toBe(true);
  const lb = await page.evaluate(() => (window as any).__game.status().leaderboard);
  expect(lb.length).toBeGreaterThan(0);
  expect(lb[0].points).toBeGreaterThanOrEqual(11);
  await expect(control.locator('#lb')).toContainText('очки', { timeout: 10_000 });
  expect(errors).toEqual([]);
});
