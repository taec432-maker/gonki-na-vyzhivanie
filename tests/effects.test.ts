import { describe, expect, it } from 'vitest';
import { Simulation, type SimCar } from '../src/core/sim';
import { Session } from '../src/race/session';
import { EventNormalizer } from '../src/bridge/normalize';
import { MockViewers } from '../src/bridge/mock';
import { DEFAULT_MAPPING, resolveGift, sanitizeMapping } from '../src/gifts/mapping';
import { trackById } from '../src/tracks';
import { VEHICLES, vehicleById } from '../src/vehicles';

/** Гонка с n машинами, перемотанная на `seconds` после старта. */
export async function raceWith(n: number, seconds = 4, seed = 11): Promise<Simulation> {
  const sim = await Simulation.create({ seed, track: trackById('port') });
  for (let i = 0; i < n; i++)
    sim.addCar({ name: `C${i}`, color: '#fff', spec: vehicleById('sports'), playerId: `p${i}` });
  sim.startCountdown();
  while (sim.phase !== 'race') sim.step();
  for (let i = 0; i < seconds * 60; i++) sim.step();
  return sim;
}

const steps = (sim: Simulation, n: number) => {
  for (let i = 0; i < n; i++) sim.step();
};

describe('Маппинг подарков (раздел 7 ТЗ)', () => {
  const m = DEFAULT_MAPPING;
  const r = (total: number, giftName = 'X', giftId = '') => resolveGift(m, { total, giftName, giftId })?.effect;
  it('тиры по стоимости одного сообщения', () => {
    expect(r(1)).toBe('nitro');
    expect(r(9)).toBe('nitro');
    expect(r(10)).toBe('rocket');
    expect(r(50)).toBe('repairOrOil');
    expect(r(100)).toBe('shield');
    expect(r(300)).toBe('mines');
    expect(r(500)).toBe('emp');
    expect(r(1000)).toBe('monster');
    expect(r(5000)).toBe('armageddon');
    expect(r(0)).toBeUndefined();
  });
  it('переопределение по имени и по ID важнее тира', () => {
    const mm = sanitizeMapping({
      ...DEFAULT_MAPPING,
      overrides: [
        { giftName: 'rose', effect: 'teleport', power: 1 },
        { giftId: '777', effect: 'ghost', power: 2 },
      ],
    });
    expect(resolveGift(mm, { total: 1, giftName: 'Rose', giftId: '5655' })?.effect).toBe('teleport');
    expect(resolveGift(mm, { total: 9999, giftName: 'Lion', giftId: '777' })).toMatchObject({
      effect: 'ghost',
      power: 2,
      via: 'override',
    });
  });
  it('испорченный JSON маппинга не ломает игру', () => {
    const mm = sanitizeMapping({ tiers: [{ min: 'a', effect: 'unknown' }], overrides: 'x', likes: { target: -5 } });
    expect(mm.tiers.length).toBeGreaterThan(0);
    expect(mm.likes.target).toBeGreaterThanOrEqual(10);
  });
});

describe('Эффекты первой очереди', () => {
  it('Нитро: +40 % мощности на 2 с, стак по времени', async () => {
    const sim = await raceWith(2);
    const a = sim.cars[0] as SimCar;
    sim.combat.enqueue(a.id, 'nitro', 1);
    steps(sim, 1);
    expect(sim.combat.has(a, 'nitro')).toBe(true);
    expect(a.phys.powerMul).toBeCloseTo(1.4);
    sim.combat.enqueue(a.id, 'nitro', 1);
    steps(sim, 1);
    expect(sim.combat.remaining(a, 'nitro')).toBeGreaterThan(3.9);
    steps(sim, 60 * 4);
    expect(sim.combat.has(a, 'nitro')).toBe(false);
    expect(a.phys.powerMul).toBe(1);
  });

  it('Нитро разгоняет машину быстрее, чем без него', async () => {
    const run = async (nitro: boolean) => {
      const sim = await raceWith(1, 0.1);
      const a = sim.cars[0] as SimCar;
      if (nitro) sim.combat.enqueue(a.id, 'nitro', 1);
      steps(sim, 90);
      return a.phys.forwardSpeed();
    };
    expect(await run(true)).toBeGreaterThan((await run(false)) + 1);
  });

  it('Ракета летит в ближайшего впереди и попадает (толчок + 25 урона)', async () => {
    const sim = await raceWith(4, 6);
    const order = sim.standings();
    const shooter = order[2] as SimCar;
    const victim = order[1] as SimCar;
    const hits: number[] = [];
    sim.combat.events.on('impact', (e) => e.targetId !== null && hits.push(e.targetId));
    sim.combat.enqueue(shooter.id, 'rocket', 1);
    steps(sim, 1);
    expect(sim.combat.projectiles[0]?.targetId).toBe(victim.id);
    steps(sim, 240);
    expect(hits).toContain(victim.id);
    expect(victim.hp).toBeLessThanOrEqual(victim.maxHp - 20);
  });

  it('Щит: урон не проходит 8 с', async () => {
    const sim = await raceWith(2);
    const a = sim.cars[0] as SimCar;
    sim.combat.enqueue(a.id, 'shield', 1);
    steps(sim, 1);
    expect(sim.combat.damage(a, 30, 'test')).toBe(0);
    expect(a.hp).toBe(a.maxHp);
    steps(sim, 60 * 8 + 5);
    expect(sim.combat.damage(a, 30, 'test')).toBe(30);
  });

  it('Ремонт: +40 HP, не выше максимума', async () => {
    const sim = await raceWith(1);
    const a = sim.cars[0] as SimCar;
    a.hp = 30;
    sim.combat.enqueue(a.id, 'repair', 1);
    steps(sim, 1);
    expect(a.hp).toBe(70);
    sim.combat.enqueue(a.id, 'repair', 1);
    steps(sim, 1);
    expect(a.hp).toBe(a.maxHp);
  });

  it('Масло: пятно позади на 20 с; наехавший теряет сцепление на 1,5 с', async () => {
    const sim = await raceWith(2, 6);
    const [lead, chaser] = sim.standings() as [SimCar, SimCar];
    sim.combat.enqueue(lead.id, 'oil', 1);
    steps(sim, 1);
    const trap = sim.combat.traps[0];
    expect(trap?.kind).toBe('oil');
    expect(sim.track.path.deltaS(trap!.s, lead.s)).toBeGreaterThan(2);
    // Ставим преследователя прямо на пятно.
    chaser.phys.teleport(trap!.pos, chaser.phys.heading(), 20);
    steps(sim, 2);
    expect(sim.combat.has(chaser, 'oiled')).toBe(true);
    expect(chaser.phys.gripMul).toBeLessThan(0.5);
    steps(sim, 60 * 20);
    expect(sim.combat.traps.length).toBe(0);
  });

  it('Ремонт/масло (50–99 алмазов): побитому — ремонт, целому — масло', async () => {
    const sim = await raceWith(1);
    const a = sim.cars[0] as SimCar;
    sim.combat.enqueue(a.id, 'repairOrOil', 1);
    steps(sim, 1);
    expect(sim.combat.traps.length).toBe(1);
    a.hp = 40;
    sim.combat.enqueue(a.id, 'repairOrOil', 1);
    steps(sim, 1);
    expect(a.hp).toBe(80);
  });

  it('Очередь: 20 подарков за шаг активируются по 3 за шаг', async () => {
    const sim = await raceWith(1);
    const a = sim.cars[0] as SimCar;
    const applied: number[] = [];
    sim.combat.events.on('applied', () => applied.push(sim.tick));
    for (let i = 0; i < 20; i++) sim.combat.enqueue(a.id, 'nitro', 1);
    steps(sim, 1);
    expect(applied.length).toBe(3);
    steps(sim, 10);
    expect(applied.length).toBe(20);
    // Стак по времени упирается в потолок 40 с.
    expect(sim.combat.remaining(a, 'nitro')).toBeLessThanOrEqual(40);
  });
});

describe('Подарок зрителя → эффект его машине', () => {
  it('подарок зрителя A даёт эффект машине A; комбо — один раз', async () => {
    const s = await Session.create({
      seed: 5,
      settings: { lobbySeconds: 5 },
      trackFor: () => trackById('port'),
      vehiclesFor: () => VEHICLES,
    });
    const norm = new EventNormalizer();
    const mock = new MockViewers(9);
    s.handle(norm.normalize(mock.chat('A', 'Alex'))!);
    s.handle(norm.normalize(mock.chat('B', 'Bob'))!);
    while (s.phase !== 'race') s.step();
    const carA = s.carForPlayer('A')!;
    const carB = s.carForPlayer('B')!;
    const applied: { car: number; effect: string }[] = [];
    s.sim.combat.events.on('applied', (e) => applied.push({ car: e.car.id, effect: e.effect }));
    // Серия комбо из 5 роз (1 алмаз) = 5 алмазов → Нитро, ровно один раз.
    for (const m of mock.gift('A', 'Alex', 'Rose', 1, 5)) {
      const ev = norm.normalize(m);
      if (ev) s.handle(ev);
    }
    s.step();
    expect(applied).toEqual([{ car: carA.id, effect: 'nitro' }]);
    expect(s.sim.combat.has(carA, 'nitro')).toBe(true);
    expect(s.sim.combat.has(carB, 'nitro')).toBe(false);
  });

  it('подарок в лобби «заряжается» и срабатывает на старте', async () => {
    const s = await Session.create({
      seed: 6,
      settings: { lobbySeconds: 5 },
      trackFor: () => trackById('port'),
      vehiclesFor: () => VEHICLES,
    });
    const norm = new EventNormalizer();
    const mock = new MockViewers(10);
    s.handle(norm.normalize(mock.chat('A', 'Alex'))!);
    for (const m of mock.gift('A', 'Alex', 'Hand Hearts', 100, 1)) s.handle(norm.normalize(m)!);
    while (s.phase !== 'race') s.step();
    s.step();
    expect(s.sim.combat.has(s.carForPlayer('A')!, 'shield')).toBe(true);
  });

  it('лайки: 500 — всем нитро, бар обнуляется, счётчик растёт', async () => {
    const s = await Session.create({
      seed: 7,
      settings: { lobbySeconds: 5 },
      trackFor: () => trackById('port'),
      vehiclesFor: () => VEHICLES,
    });
    while (s.phase !== 'race') s.step();
    const norm = new EventNormalizer();
    const mock = new MockViewers(11);
    for (let i = 0; i < 9; i++) s.handle(norm.normalize(mock.like('u', 'U', 50))!);
    expect(s.likeBar).toBe(450);
    s.handle(norm.normalize(mock.like('u', 'U', 50))!);
    expect(s.likeBar).toBe(0);
    expect(s.likeBursts).toBe(1);
    for (let i = 0; i < 6; i++) s.step();
    expect(s.sim.cars.every((c) => s.sim.combat.has(c, 'nitro'))).toBe(true);
  });
});
