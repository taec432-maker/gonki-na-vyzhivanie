import { describe, expect, it } from 'vitest';
import { Simulation, type SimCar } from '../src/core/sim';
import { Leaderboard, POINTS } from '../src/race/scores';
import { trackById } from '../src/tracks';
import { VEHICLES, vehicleById } from '../src/vehicles';

async function race(
  n: number,
  opts: { mode?: 'race' | 'survival'; seconds?: number; seed?: number } = {},
): Promise<Simulation> {
  const sim = await Simulation.create({
    seed: opts.seed ?? 21,
    track: trackById('port'),
    mode: opts.mode ?? 'race',
    vehicles: VEHICLES,
  });
  for (let i = 0; i < n; i++)
    sim.addCar({ name: `C${i}`, color: '#fff', spec: vehicleById('sports'), playerId: `p${i}` });
  sim.startCountdown();
  while (sim.phase !== 'race') sim.step();
  for (let i = 0; i < (opts.seconds ?? 6) * 60; i++) sim.step();
  return sim;
}
const steps = (sim: Simulation, n: number) => {
  for (let i = 0; i < n; i++) sim.step();
};
const order = (sim: Simulation) => sim.standings();

describe('HP, взрыв, режимы', () => {
  it('«Гонка»: 0 HP — взрыв, через 3 с возрождение на чекпойнте с 50 HP', async () => {
    const sim = await race(3);
    const a = sim.cars[0] as SimCar;
    const events: string[] = [];
    sim.events.on('explode', () => events.push('explode'));
    sim.events.on('revive', () => events.push('revive'));
    sim.combat.damage(a, 999, 'test');
    steps(sim, 2);
    expect(a.wrecked).toBe(true);
    steps(sim, 3 * 60 + 2);
    expect(events).toEqual(['explode', 'revive']);
    expect(a.wrecked).toBe(false);
    expect(a.hp).toBe(Math.round(a.maxHp * 0.5));
    expect(a.race.out).toBe(false);
  });

  it('«Выживание»: взрыв и выбывание; выбывшие — в конце таблицы; последний выживший побеждает', async () => {
    const sim = await race(3, { mode: 'survival' });
    const [a, b, c] = sim.cars as [SimCar, SimCar, SimCar];
    sim.combat.damage(a, 999, 'test');
    steps(sim, 2);
    steps(sim, 3 * 60);
    expect(a.race.out).toBe(true);
    sim.combat.damage(b, 999, 'test');
    steps(sim, 3 * 60 + 2);
    expect(b.race.out).toBe(true);
    expect(order(sim).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
    sim.combat.damage(c, 999, 'test');
    steps(sim, 3 * 60 + 2);
    expect(sim.phase).toBe('finished');
    // Все выбыли — побеждает последний выживший.
    expect(sim.results()[0]!.id).toBe(c.id);
  });

  it('части кузова отлетают при потере HP и исчезают через 5 с', async () => {
    const sim = await race(1);
    const a = sim.cars[0] as SimCar;
    a.hp = a.maxHp * 0.3;
    steps(sim, 2);
    expect(a.lostParts.size).toBeGreaterThanOrEqual(2);
    expect(sim.debris.length).toBeGreaterThanOrEqual(2);
    steps(sim, 5 * 60 + 5);
    expect(sim.debris.length).toBe(0);
  });

  it('уничтожение засчитывается тому, кто последним бил', async () => {
    const sim = await race(2, { mode: 'survival' });
    const [a, b] = sim.cars as [SimCar, SimCar];
    let killer: SimCar | null = null;
    sim.events.on('explode', (e) => (killer = e.killer));
    b.lastHitBy = a.id;
    b.lastHitTick = sim.tick;
    sim.combat.damage(b, 999, 'ram', a.id);
    steps(sim, 2);
    expect(killer).toBe(a);
    expect(a.kills).toBe(1);
  });
});

describe('Эффекты этапа 4', () => {
  it('Мины: три штуки позади, наехавший получает 35 урона', async () => {
    const sim = await race(2);
    const [lead, chaser] = order(sim) as [SimCar, SimCar];
    sim.combat.enqueue(lead.id, 'mines', 1);
    steps(sim, 70);
    const mines = sim.combat.traps.filter((t) => t.kind === 'mine');
    expect(mines.length).toBe(3);
    const hp = chaser.hp;
    chaser.phys.teleport(mines[0]!.pos, chaser.phys.heading(), 10);
    steps(sim, 3);
    expect(hp - chaser.hp).toBeGreaterThanOrEqual(35);
  });

  it('ЭМИ: все соперники глохнут на 2,5 с, даритель — нет', async () => {
    const sim = await race(3);
    const a = sim.cars[0] as SimCar;
    sim.combat.enqueue(a.id, 'emp', 1);
    steps(sim, 2);
    for (const c of sim.cars) expect(c.phys.stalled).toBe(c !== a);
    steps(sim, 160);
    expect(sim.cars.every((c) => !c.phys.stalled)).toBe(true);
  });

  it('Монстр: ×2 размер, неуязвим, таран соперника = 60 урона', async () => {
    const sim = await race(2);
    const [a, b] = sim.cars as [SimCar, SimCar];
    sim.combat.enqueue(a.id, 'monster', 1);
    steps(sim, 2);
    expect(a.phys.scale).toBe(2);
    expect(sim.combat.damage(a, 50, 'test')).toBe(0);
    // Таран: ставим жертву прямо перед монстром.
    const fwd = a.phys.forward(a.cur.p.clone().set(0, 0, 0));
    b.phys.teleport(a.cur.p.clone().addScaledVector(fwd, 14), a.phys.heading(), 0);
    a.phys.body.setLinvel({ x: fwd.x * 25, y: 0, z: fwd.z * 25 }, true);
    const hp = b.hp;
    steps(sim, 60);
    expect(hp - b.hp).toBeGreaterThanOrEqual(60);
    steps(sim, 10 * 60);
    expect(a.phys.scale).toBe(1);
  });

  it('Армагеддон: всем, кроме дарителя, 50 урона; даритель +1 позиция', async () => {
    const sim = await race(4, { seconds: 8 });
    const st = order(sim);
    const giver = st[2] as SimCar;
    const ahead = st[1] as SimCar;
    sim.combat.enqueue(giver.id, 'armageddon', 1);
    steps(sim, 4 * 60);
    for (const c of sim.cars) {
      if (c === giver) expect(c.hp).toBe(c.maxHp);
      else expect(c.maxHp - c.hp).toBeGreaterThanOrEqual(50);
    }
    expect(giver.race.progress).toBeGreaterThan(ahead.race.progress);
  });

  it('Телепорт: +1 позиция', async () => {
    const sim = await race(4, { seconds: 8 });
    const st = order(sim);
    const me = st[3] as SimCar;
    sim.combat.enqueue(me.id, 'teleport', 1);
    steps(sim, 3);
    const after = order(sim);
    expect(after.indexOf(me)).toBe(2);
  });

  it('Гвозди: у всех позади −30 % скорости на 6 с, у тех, кто впереди, — нет', async () => {
    const sim = await race(4, { seconds: 8 });
    const st = order(sim);
    const me = st[1] as SimCar;
    sim.combat.enqueue(me.id, 'nails', 1);
    steps(sim, 2);
    expect(sim.combat.has(st[0] as SimCar, 'punctured')).toBe(false);
    expect(sim.combat.has(me, 'punctured')).toBe(false);
    expect(sim.combat.has(st[2] as SimCar, 'punctured')).toBe(true);
    expect((st[3] as SimCar).phys.maxSpeedMul).toBeCloseTo(0.7);
  });

  it('Призрак: 5 с проезд сквозь машины', async () => {
    const sim = await race(2);
    const a = sim.cars[0] as SimCar;
    sim.combat.enqueue(a.id, 'ghost', 1);
    steps(sim, 2);
    expect(a.phys.ghost).toBe(true);
    steps(sim, 5 * 60 + 5);
    expect(a.phys.ghost).toBe(false);
  });

  it('Магнит: соперник рядом подтягивается к владельцу', async () => {
    const sim = await race(2);
    const [a, b] = sim.cars as [SimCar, SimCar];
    // Оба стоят; соперник в 20 м сбоку от владельца.
    for (const c of [a, b]) c.phys.maxSpeedMul = 0;
    sim.combat.modifierHook = null;
    const right = a.phys
      .forward(a.cur.p.clone())
      .cross(a.cur.p.clone().set(0, 1, 0))
      .normalize();
    b.phys.teleport(a.cur.p.clone().addScaledVector(right, 6), a.phys.heading(), 0);
    a.phys.teleport(a.cur.p.clone().addScaledVector(right, -6), a.phys.heading(), 0);
    steps(sim, 5);
    const before = a.cur.p.distanceTo(b.cur.p);
    sim.combat.enqueue(a.id, 'magnet', 1);
    steps(sim, 60);
    expect(a.cur.p.distanceTo(b.cur.p)).toBeLessThan(before - 1);
  });

  it('Шутка: соперники на газонокосилках 8 с (медленнее)', async () => {
    const sim = await race(3);
    const a = sim.cars[0] as SimCar;
    sim.combat.enqueue(a.id, 'joke', 1);
    steps(sim, 2);
    for (const c of sim.cars) expect(sim.combat.has(c, 'mower')).toBe(c !== a);
    expect((sim.cars[1] as SimCar).jokeSpec?.body).toBe('mower');
    expect((sim.cars[1] as SimCar).phys.maxSpeedMul).toBeLessThan(0.5);
    steps(sim, 8 * 60 + 5);
    expect(sim.combat.has(sim.cars[1] as SimCar, 'mower')).toBe(false);
  });

  it('Смена машины: своя → случайная редкая, на ходу', async () => {
    const sim = await race(1);
    const a = sim.cars[0] as SimCar;
    const v = a.phys.forwardSpeed();
    sim.combat.enqueue(a.id, 'swapcar', 1);
    steps(sim, 2);
    expect(a.spec.rarity).toBe('rare');
    expect(Math.abs(a.phys.forwardSpeed() - v)).toBeLessThan(8);
    steps(sim, 120);
    expect(a.phys.forwardSpeed()).toBeGreaterThan(10);
  });

  it('Воскрешение: в «Выживании» возвращает выбывшего; живому — запасная жизнь', async () => {
    const sim = await race(2, { mode: 'survival' });
    const [a, b] = sim.cars as [SimCar, SimCar];
    sim.combat.damage(a, 999, 'test');
    steps(sim, 3 * 60 + 2);
    expect(a.race.out).toBe(true);
    sim.combat.enqueue(a.id, 'revive', 1);
    steps(sim, 2);
    expect(a.race.out).toBe(false);
    expect(a.hp).toBe(Math.round(a.maxHp * 0.5));
    sim.combat.enqueue(b.id, 'revive', 1);
    steps(sim, 2);
    expect(b.spareLife).toBe(true);
    sim.combat.damage(b, 999, 'test');
    steps(sim, 2);
    expect(b.wrecked).toBe(false);
    expect(b.hp).toBeGreaterThan(0);
  });
});

describe('Очки сессии', () => {
  it('победа 10, 2-е 6, 3-е 3, участие 1, уничтожение +2; боты не считаются', () => {
    const lb = new Leaderboard();
    const r = (id: string | null, place: number) => ({
      id: place,
      name: id ?? 'bot',
      playerId: id,
      place,
      finished: true,
      time: 60,
      laps: 3,
      out: false,
    });
    lb.addRace([r('a', 1), r('b', 2), r(null, 3), r('c', 4)], (id) => id.toUpperCase());
    lb.addKill('c', 'C');
    const get = (id: string) => lb.rows.get(id)!;
    expect(get('a').points).toBe(POINTS.first + POINTS.participation);
    expect(get('b').points).toBe(POINTS.second + POINTS.participation);
    expect(get('c').points).toBe(POINTS.participation + POINTS.kill);
    expect(lb.rows.size).toBe(3);
    const copy = new Leaderboard();
    copy.load(JSON.parse(JSON.stringify(lb.toJSON())));
    expect(copy.top().map((x) => x.id)).toEqual(lb.top().map((x) => x.id));
  });
});
