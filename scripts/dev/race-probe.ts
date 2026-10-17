import { Simulation } from '../../src/core/sim';
import { trackById } from '../../src/tracks';
import { vehicleById } from '../../src/vehicles';

const n = Number(process.argv[3] ?? 8);
const sim = await Simulation.create({
  seed: Number(process.argv[4] ?? 42),
  track: trackById(process.argv[2] ?? 'port'),
});
const colors = [
  '#c8102e',
  '#1b3a8a',
  '#f5b800',
  '#2e8b57',
  '#f2f2f2',
  '#1f1f22',
  '#ff7a00',
  '#7b2cbf',
  '#00a3c4',
  '#a0a0a0',
  '#e04f9f',
  '#6b4423',
];
for (let i = 0; i < n; i++)
  sim.addCar({
    name: `Бот ${i + 1}`,
    color: colors[i % colors.length] as string,
    spec: vehicleById('sports'),
    playerId: null,
  });
let respawns = 0;
sim.events.on('respawn', (e) => {
  respawns++;
  console.info(
    'respawn',
    e.car.name,
    e.reason,
    'gate',
    e.car.race.gatesPassed,
    't',
    sim.raceTime.toFixed(1),
    'frac',
    sim.track.fracFromStart(e.car.s).toFixed(3),
  );
});
sim.events.on('finish', (e) => console.info('finish', e.place, e.car.name, e.time.toFixed(1)));
sim.events.on('lap', (e) => {
  if (e.car.id === 1) console.info('lap', e.lap, sim.raceTime.toFixed(1));
});
sim.startCountdown();
const t0 = performance.now();
let steps = 0;
while (sim.phase !== 'finished' && steps < 60 * 300) {
  sim.step();
  steps++;
}
console.info(
  'phase',
  sim.phase,
  'raceTime',
  sim.raceTime.toFixed(1),
  'respawns',
  respawns,
  'ms/step',
  ((performance.now() - t0) / steps).toFixed(3),
);
console.info(
  sim.results().map((r) => ({ place: r.place, name: r.name, fin: r.finished, time: r.time?.toFixed(1), laps: r.laps })),
);
