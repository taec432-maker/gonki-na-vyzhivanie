// Кто медленно едет на участке трассы: npx tsx scripts/dev/shortcut-probe.ts трасса от до
import { Simulation } from '../../src/core/sim';
import { trackById } from '../../src/tracks';
import { vehicleById } from '../../src/vehicles';
const sim = await Simulation.create({ seed: 42, track: trackById(process.argv[2] ?? 'port') });
for (let i = 0; i < 8; i++)
  sim.addCar({ name: `B${i}`, color: '#fff', spec: vehicleById(process.argv[5] ?? 'sports'), playerId: null });
sim.startCountdown();
const tr = sim.track;
const sc = tr.shortcuts[0];
let last = -1;
for (let k = 0; k < 60 * 120; k++) {
  sim.step();
  if (k % 15 !== 0) continue;
  for (const c of sim.cars) {
    const f = tr.fracFromStart(c.s);
    if (f > +(process.argv[3] ?? 0.7) && f < +(process.argv[4] ?? 0.84) && Math.abs(c.phys.forwardSpeed()) < 6) {
      const dc = sc ? tr.shortcutD(sc, c.s) : null;
      console.info(
        `t ${(k / 60).toFixed(1)} ${c.name} f ${f.toFixed(3)} d ${c.d.toFixed(1)} dc ${dc?.toFixed(1)} v ${c.phys.forwardSpeed().toFixed(1)} y ${c.cur.p.y.toFixed(1)} prog ${c.race.progress.toFixed(0)}`,
      );
      last = k;
    }
  }
  if (last > 0 && k - last > 600) break;
}
