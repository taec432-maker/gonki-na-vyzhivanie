import { Simulation } from '../../src/core/sim';
import { trackById } from '../../src/tracks';
import { vehicleById } from '../../src/vehicles';

const sim = await Simulation.create({ seed: 42, track: trackById(process.argv[2] ?? 'test-oval') });
const car = sim.addCar(vehicleById('sports'), 'Тест', '#c00', 0);
let lastS = car.s;
let dist = 0;
const t0 = performance.now();
for (let i = 0; i < 60 * 90; i++) {
  sim.step();
  dist += sim.track.path.deltaS(lastS, car.s);
  lastS = car.s;
  if (i % 300 === 0)
    console.info(
      (i / 60).toFixed(0),
      's',
      car.s.toFixed(0),
      'd',
      car.d.toFixed(2),
      'v',
      (car.phys.forwardSpeed() * 3.6).toFixed(0),
      'dist',
      dist.toFixed(0),
    );
}
console.info(
  'track length',
  sim.track.length.toFixed(0),
  'laps',
  (dist / sim.track.length).toFixed(2),
  'ms/step',
  ((performance.now() - t0) / (60 * 90)).toFixed(3),
);
