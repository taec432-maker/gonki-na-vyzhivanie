// Одна машина на трассе: где медленно / стоит. npx tsx scripts/dev/solo.ts трасса машина
import { Simulation } from '../../src/core/sim';
import { trackById } from '../../src/tracks';
import { vehicleById } from '../../src/vehicles';
const [id = 'city', car = 'buggy'] = process.argv.slice(2);
const sim = await Simulation.create({ seed: 1, track: trackById(id), laps: 1 });
const c = sim.addCar({ name: car, color: '#fff', spec: vehicleById(car), playerId: null });
sim.events.on('respawn', (e) => console.info('respawn', e.reason, sim.track.fracFromStart(e.car.s).toFixed(3)));
sim.startCountdown();
for (let k = 0; k < 60 * 120 && sim.phase !== 'finished'; k++) {
  sim.step();
  const f = sim.track.fracFromStart(c.s);
  if (k % 20 === 0 && f > +(process.argv[4] ?? 0.15) && f < +(process.argv[5] ?? 0.25))
    console.info(
      `t ${(k / 60).toFixed(1)} f ${f.toFixed(3)} d ${c.d.toFixed(1)} v ${c.phys.forwardSpeed().toFixed(1)} thr ${c.controls.throttle.toFixed(2)} br ${c.controls.brake.toFixed(2)} st ${c.controls.steer.toFixed(2)} y ${c.cur.p.y.toFixed(2)}`,
    );
}
console.info('phase', sim.phase, 'time', sim.raceTime.toFixed(1));
