import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/core/sim';
import { trackById } from '../src/tracks';
import { vehicleById } from '../src/vehicles';

async function run(seed: number, steps: number) {
  const sim = await Simulation.create({ seed, track: trackById('port') });
  for (let i = 0; i < 4; i++) sim.addCar({ name: `A${i}`, color: '#f00', spec: vehicleById('sports'), playerId: null });
  sim.startCountdown();
  for (let i = 0; i < steps; i++) sim.step();
  const out = sim.cars.map((c) => {
    const p = c.phys.body.translation();
    return [p.x, p.y, p.z, c.s];
  });
  sim.dispose();
  return out;
}

describe('Simulation', () => {
  it('детерминизм: один seed — одинаковый результат (4 машины, 20 с)', async () => {
    const a = await run(42, 1200);
    const b = await run(42, 1200);
    expect(a).toEqual(b);
  });

  it('отсчёт 3 с, затем гонка; до старта машины стоят', async () => {
    const sim = await Simulation.create({ seed: 1, track: trackById('port') });
    const car = sim.addCar({ name: 'A', color: '#f00', spec: vehicleById('sports'), playerId: null });
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.phase).toBe('grid');
    expect(Math.abs(car.phys.forwardSpeed())).toBeLessThan(0.5);
    sim.startCountdown();
    for (let i = 0; i < 179; i++) sim.step();
    expect(sim.phase).toBe('countdown');
    sim.step();
    expect(sim.phase).toBe('race');
    for (let i = 0; i < 120; i++) sim.step();
    expect(car.phys.forwardSpeed()).toBeGreaterThan(10);
    sim.dispose();
  });

  it('8 ботов честно проезжают 3 круга, все финишируют, порядок финиша = таблица', async () => {
    const sim = await Simulation.create({ seed: 42, track: trackById('port') });
    for (let i = 0; i < 8; i++)
      sim.addCar({ name: `B${i}`, color: '#fff', spec: vehicleById(i % 2 ? 'muscle' : 'sports'), playerId: null });
    const finishOrder: number[] = [];
    sim.events.on('finish', (e) => finishOrder.push(e.car.id));
    sim.startCountdown();
    let guard = 0;
    while (sim.phase !== 'finished' && guard++ < 60 * 300) sim.step();
    expect(sim.phase).toBe('finished');
    const res = sim.results();
    expect(res.every((r) => r.finished && r.laps === 3)).toBe(true);
    expect(res.map((r) => r.id)).toEqual(finishOrder);
    // Время круга в пределах ТЗ (40–70 с для средней машины).
    const winner = res[0]!;
    expect(winner.time! / 3).toBeGreaterThan(40);
    expect(winner.time! / 3).toBeLessThan(70);
    sim.dispose();
  });

  it('лимит времени: гонка заканчивается, побеждает лидер', async () => {
    const sim = await Simulation.create({ seed: 3, track: trackById('port'), timeLimit: 20 });
    for (let i = 0; i < 3; i++)
      sim.addCar({ name: `B${i}`, color: '#fff', spec: vehicleById('sports'), playerId: null });
    sim.startCountdown();
    let guard = 0;
    while (sim.phase !== 'finished' && guard++ < 60 * 40) sim.step();
    expect(sim.phase).toBe('finished');
    expect(sim.raceTime).toBeLessThan(21);
    expect(sim.results()[0]!.place).toBe(1);
    sim.dispose();
  });

  it('застрявшую машину мягко возвращают на трассу', async () => {
    const sim = await Simulation.create({ seed: 5, track: trackById('port') });
    const car = sim.addCar({ name: 'A', color: '#f00', spec: vehicleById('sports'), playerId: null });
    let respawned = false;
    sim.events.on('respawn', () => (respawned = true));
    sim.startCountdown();
    for (let i = 0; i < 240; i++) sim.step();
    // Глушим двигатель — машина встаёт; через 3 с без прогресса — респаун.
    car.phys.maxSpeedMul = 0;
    for (let i = 0; i < 900 && !respawned; i++) sim.step();
    expect(respawned).toBe(true);
    expect(car.phys.ghost).toBe(true);
    sim.dispose();
  });
});
