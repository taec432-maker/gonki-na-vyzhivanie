// Время круга каждой машины в одиночку на трассе — для баланса ростера (±5 %).
import { Simulation } from '../../src/core/sim';
import { trackById } from '../../src/tracks';
import { VEHICLES } from '../../src/vehicles';
const track = trackById(process.argv[2] ?? 'port');
const rows: { id: string; lap: number }[] = [];
for (const spec of VEHICLES) {
  const sim = await Simulation.create({ seed: 1, track, laps: 3, vehicles: VEHICLES });
  const car = sim.addCar({ name: spec.id, color: '#fff', spec, playerId: null });
  let lapStart = 0;
  let lap = 0;
  sim.events.on('lap', (e) => {
    if (e.lap === 1) lapStart = sim.tick;
    if (e.lap === 2) lap = (sim.tick - lapStart) / 60;
  });
  sim.startCountdown();
  let g = 0;
  while (sim.phase !== 'finished' && g++ < 60 * 400) sim.step();
  rows.push({ id: spec.id, lap: lap || NaN });
  void car;
}
const avg = rows.reduce((a, r) => a + r.lap, 0) / rows.length;
for (const r of rows) console.info(r.id.padEnd(12), r.lap.toFixed(1), `${(((r.lap - avg) / avg) * 100).toFixed(1)}%`);
