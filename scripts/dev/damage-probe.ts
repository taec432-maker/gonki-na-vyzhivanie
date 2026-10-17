import { Simulation } from '../../src/core/sim';
import { trackById } from '../../src/tracks';
import { VEHICLES } from '../../src/vehicles';
const mode = (process.argv[2] ?? 'race') as 'race' | 'survival';
for (const seed of [1, 2, 3]) {
  const sim = await Simulation.create({ seed, track: trackById('port'), mode, vehicles: VEHICLES });
  for (let i = 0; i < 12; i++) sim.addCar({ name: `B${i}`, color: '#fff', spec: VEHICLES[i % 2]!, playerId: null });
  let explodes = 0,
    crashes = 0,
    dmg = 0,
    wallD = 0;
  sim.events.on('explode', () => explodes++);
  sim.events.on('crash', (e) => {
    crashes++;
    dmg += e.amount;
    if (!e.other) wallD += e.amount;
  });
  sim.startCountdown();
  let g = 0;
  while (sim.phase !== 'finished' && g++ < 60 * 300) sim.step();
  const res = sim.results();
  console.info(
    mode,
    seed,
    'time',
    sim.raceTime.toFixed(0),
    'crashes',
    crashes,
    'dmg',
    dmg.toFixed(0),
    'wall',
    wallD.toFixed(0),
    'explodes',
    explodes,
    'finished',
    res.filter((r) => r.finished).length,
    'out',
    res.filter((r) => r.out).length,
    'minHP',
    Math.min(...sim.cars.map((c) => c.hp)).toFixed(0),
  );
}
