// Разбор «пробки»: кто и что рядом с машиной, когда она стоит. npx tsx scripts/dev/jam.ts трасса заезд машина
import { STEP_HZ } from '../../src/core/loop';
import { Session } from '../../src/race/session';
import { trackById } from '../../src/tracks';
import { VEHICLES } from '../../src/vehicles';
const [id = 'city', raceNo = '2', who = 'buggy'] = process.argv.slice(2);
const ses = await Session.create({
  seed: 42,
  settings: { lobbySeconds: 5, podiumSeconds: 3, minCars: 8, maxCars: 8 },
  trackFor: () => trackById(id),
  vehiclesFor: () => VEHICLES,
});
for (let r = 1; r < +raceNo; r++) {
  const start = ses.raceIndex;
  while (ses.raceIndex === start) ses.step();
}
const sim = ses.sim;
let printed = 0;
for (let g = 0; g < 400 * STEP_HZ && ses.phase !== 'podium' && printed < 14; g++) {
  ses.step();
  if (sim.phase !== 'race' || sim.raceTime < 6 || g % 30) continue;
  for (const c of sim.cars) {
    if ((who !== 'any' && c.spec.id !== who) || Math.abs(c.phys.forwardSpeed()) > 1.5 || c.race.finished || c.wrecked)
      continue;
    printed++;
    console.info(
      `t ${sim.raceTime.toFixed(1)} ${c.spec.id} hd ${(c.phys.heading() - Math.atan2(sim.track.path.tangentAt(c.s).x, -sim.track.path.tangentAt(c.s).z)).toFixed(2)} f ${sim.track.fracFromStart(c.s).toFixed(3)} d ${c.d.toFixed(1)} y ${c.cur.p.y.toFixed(2)} up ${c.phys.up(c.cur.p.clone()).y.toFixed(2)}`,
    );
    for (const o of sim.cars)
      if (o !== c && o.cur.p.distanceTo(c.cur.p) < 12)
        console.info(
          `   машина ${o.spec.id} dist ${o.cur.p.distanceTo(c.cur.p).toFixed(1)} v ${o.phys.forwardSpeed().toFixed(1)} wrecked ${o.wrecked}`,
        );
    for (const b of sim.features.breakables) {
      const t = b.body.translation();
      const dd = Math.hypot(t.x - c.cur.p.x, t.z - c.cur.p.z);
      if (dd < 8) console.info(`   предмет ${b.type} dist ${dd.toFixed(1)} harmless ${b.harmless}`);
    }
    for (const d of sim.debris) console.info(`   обломок ${d.part}`);
  }
}
