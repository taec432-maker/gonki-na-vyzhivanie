import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/core/sim';
import { TRACKS } from '../src/tracks';
import { VEHICLES } from '../src/vehicles';

/** Время второго круга машины в одиночку. */
async function lapTime(specId: string, trackId: string): Promise<number> {
  const spec = VEHICLES.find((v) => v.id === specId)!;
  const sim = await Simulation.create({
    seed: 1,
    track: TRACKS.find((t) => t.id === trackId)!,
    laps: 3,
    vehicles: VEHICLES,
  });
  sim.addCar({ name: spec.id, color: '#fff', spec, playerId: null });
  let start = 0;
  let lap = 0;
  sim.events.on('lap', (e) => {
    if (e.lap === 1) start = sim.tick;
    if (e.lap === 2) lap = (sim.tick - start) / 60;
  });
  sim.startCountdown();
  let g = 0;
  while (lap === 0 && g++ < 60 * 300) sim.step();
  sim.dispose();
  return lap;
}

describe('Баланс ростера', () => {
  for (const track of TRACKS)
    it(`обычные машины проходят круг «${track.name}» в пределах ±7 % от среднего (все успевают финишировать)`, async () => {
      const common = VEHICLES.filter((v) => v.rarity === 'common');
      const laps = await Promise.all(common.map((v) => lapTime(v.id, track.id)));
      const avg = laps.reduce((a, b) => a + b, 0) / laps.length;
      for (const [i, t] of laps.entries()) {
        expect(t, common[i]!.id).toBeGreaterThan(avg * 0.93);
        expect(t, common[i]!.id).toBeLessThan(avg * 1.07);
      }
    }, 300_000);
});
