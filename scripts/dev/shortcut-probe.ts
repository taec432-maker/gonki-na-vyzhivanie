// Как машины проходят участок трассы (шорткат): npx tsx scripts/dev/shortcut-probe.ts
import { Simulation } from '../../src/core/sim';
import { trackById } from '../../src/tracks';
import { vehicleById } from '../../src/vehicles';
const sim = await Simulation.create({ seed: 42, track: trackById('port') });
for (let i = 0; i < 8; i++) sim.addCar({ name: `B${i}`, color: '#fff', spec: vehicleById('sports'), playerId: null });
sim.startCountdown();
const tr = sim.track;
const sc = tr.shortcuts[0]!;
let last = -1;
for (let k = 0; k < 60 * 120; k++) {
  sim.step();
  if (k % 15 !== 0) continue;
  for (const c of sim.cars) {
    const f = tr.fracFromStart(c.s);
    if (f > 0.7 && f < 0.84 && Math.abs(c.phys.forwardSpeed()) < 6) {
      const dc = tr.shortcutD(sc, c.s);
      console.info(
        `t ${(k / 60).toFixed(1)} ${c.name} f ${f.toFixed(3)} d ${c.d.toFixed(1)} dc ${dc?.toFixed(1)} v ${c.phys.forwardSpeed().toFixed(1)} y ${c.cur.p.y.toFixed(1)} prog ${c.race.progress.toFixed(0)}`,
      );
      last = k;
    }
  }
  if (last > 0 && k - last > 600) break;
}
