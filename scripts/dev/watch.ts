// Слежение за одной машиной перед застреванием: tsx scripts/dev/watch.ts seed n carName fromT toT
import { Simulation } from '../../src/core/sim';
import { trackById } from '../../src/tracks';
import { vehicleById } from '../../src/vehicles';
const [seed, n, name, from, to] = process.argv.slice(2);
const sim = await Simulation.create({ seed: Number(seed), track: trackById('port') });
for (let i = 0; i < Number(n); i++)
  sim.addCar({ name: `Бот ${i + 1}`, color: '#fff', spec: vehicleById('sports'), playerId: null });
sim.startCountdown();
const car = sim.cars.find((c) => c.name === name)!;
while (sim.raceTime < Number(to)) {
  sim.step();
  const t = sim.raceTime;
  if (t > Number(from) && sim.tick % 15 === 0) {
    const near = sim.cars
      .filter((c) => c !== car && c.cur.p.distanceTo(car.cur.p) < 8)
      .map((c) => `${c.name}@${c.cur.p.distanceTo(car.cur.p).toFixed(1)}`);
    console.info(
      t.toFixed(2),
      `s${car.s.toFixed(1)} f${sim.track.fracFromStart(car.s).toFixed(3)} d${car.d.toFixed(2)} v${(car.phys.forwardSpeed() * 3.6).toFixed(0)} thr${car.controls.throttle.toFixed(2)} br${car.controls.brake.toFixed(2)} st${car.controls.steer.toFixed(2)} hdg${car.phys.heading().toFixed(2)} near:${near.join(',')}`,
    );
  }
}
