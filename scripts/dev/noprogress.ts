import { Simulation } from '../../src/core/sim';
import { hashString } from '../../src/core/rng';
import { trackById } from '../../src/tracks';
import { VEHICLES } from '../../src/vehicles';
for (let r = 0; r < 10; r++) {
  const seed = (hashString(`42:${r}`) ^ 42) >>> 0;
  const sim = await Simulation.create({ seed, track: trackById('port') });
  for (let i = 0; i < 8; i++)
    sim.addCar({ name: `B${i + 1}`, color: '#fff', spec: VEHICLES[(i + r) % VEHICLES.length]!, playerId: null });
  sim.startCountdown();
  const last = new Map<number, { p: number; t: number }>();
  let worst = { dt: 0, car: '', t: 0, frac: 0, gates: 0 };
  while (sim.phase !== 'finished') {
    sim.step();
    if (sim.phase !== 'race') continue;
    for (const c of sim.cars) {
      const m = last.get(c.id);
      if (!m || c.race.progress > m.p + 5 || c.race.finished) last.set(c.id, { p: c.race.progress, t: sim.tick });
      else if ((sim.tick - m.t) / 60 > worst.dt)
        worst = {
          dt: (sim.tick - m.t) / 60,
          car: c.name,
          t: sim.raceTime,
          frac: sim.track.fracFromStart(c.s),
          gates: c.race.gatesPassed,
        };
    }
  }
  console.info(r, JSON.stringify(worst));
}
