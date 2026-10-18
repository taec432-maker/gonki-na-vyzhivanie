// Soak в Node со смешанным ростером: npx tsx scripts/dev/soak-node.ts трасса [заездов] [машин]
// Где и почему респауны, кто не финишировал.
import { STEP_HZ } from '../../src/core/loop';
import { Session } from '../../src/race/session';
import { trackById } from '../../src/tracks';
import { VEHICLES } from '../../src/vehicles';
const [id = 'mountain', nRaces = '5', nCars = '8'] = process.argv.slice(2);
const ses = await Session.create({
  seed: 42,
  settings: { lobbySeconds: 5, podiumSeconds: 3, minCars: +nCars, maxCars: +nCars },
  trackFor: () => trackById(id),
  vehiclesFor: () => VEHICLES,
});
const spots = new Map<string, number>();
const dnf = new Map<string, number>();
const t0 = Date.now();
for (let r = 0; r < +nRaces; r++) {
  const sim = ses.sim;
  const lastPos = new Map<number, string>();
  sim.events.on('respawn', (e) => {
    if (process.env.WHERE) console.info('  респаун', e.car.spec.id, e.reason, 'было:', lastPos.get(e.car.id));
    const key = `${e.reason} ${sim.track.fracFromStart(e.car.s).toFixed(2)} ${e.car.spec.id}`;
    spots.set(key, (spots.get(key) ?? 0) + 1);
  });
  const start = ses.raceIndex;
  let g = 0;
  while (ses.phase !== 'podium' && g++ < 420 * STEP_HZ) {
    ses.step();
    if (g % 30 === 0)
      for (const c of sim.cars)
        lastPos.set(
          c.id,
          `f ${sim.track.fracFromStart(c.s).toFixed(3)} d ${c.d.toFixed(1)} y ${c.cur.p.y.toFixed(1)} v ${c.phys.forwardSpeed().toFixed(1)}`,
        );
  }
  const lead = sim.standings()[0];
  for (const c of sim.cars) if (!c.race.finished) dnf.set(c.spec.id, (dnf.get(c.spec.id) ?? 0) + 1);
  console.info(
    `заезд ${r + 1}: ${sim.cars.filter((c) => c.race.finished).length}/${sim.cars.length} финиш, ${sim.raceTime.toFixed(0)} с, победил ${lead?.spec.id}`,
  );
  while (ses.raceIndex === start && g++ < 440 * STEP_HZ) ses.step();
}
console.info('респауны (причина, доля круга, машина):', [...spots].sort((a, b) => b[1] - a[1]).slice(0, 15));
console.info('не финишировали:', [...dnf]);
console.info(`${((Date.now() - t0) / 1000).toFixed(0)} с`);
