import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/core/sim';
import { trackById } from '../src/tracks';
import { vehicleById } from '../src/vehicles';

async function run(seed: number, steps: number) {
  const sim = await Simulation.create({ seed, track: trackById('test-oval') });
  const car = sim.addCar(vehicleById('sports'), 'A', '#f00', 0);
  for (let i = 0; i < steps; i++) sim.step();
  const p = car.phys.body.translation();
  const out = { x: p.x, y: p.y, z: p.z, s: car.s };
  sim.dispose();
  return out;
}

describe('Simulation', () => {
  it('детерминизм: один seed — одинаковый результат', async () => {
    const a = await run(42, 900);
    const b = await run(42, 900);
    expect(a).toEqual(b);
  });
  it('машина едет сама и не вылетает с трассы за 60 с', async () => {
    const sim = await Simulation.create({ seed: 1, track: trackById('test-oval') });
    const car = sim.addCar(vehicleById('sports'), 'A', '#f00', 0);
    let dist = 0;
    let last = car.s;
    let maxD = 0;
    for (let i = 0; i < 3600; i++) {
      sim.step();
      dist += sim.track.path.deltaS(last, car.s);
      last = car.s;
      if (i > 120) maxD = Math.max(maxD, Math.abs(car.d));
    }
    expect(dist / sim.track.length).toBeGreaterThan(1.5);
    expect(maxD).toBeLessThan(sim.track.def.width / 2 + sim.track.def.shoulder.width);
    expect(car.phys.isFlipped()).toBe(false);
    sim.dispose();
  });
});
