import { Simulation } from '../../src/core/sim';
import { trackById } from '../../src/tracks';
import { vehicleById } from '../../src/vehicles';
const sim = await Simulation.create({ seed: 1, track: trackById('port') });
for (let i = 0; i < 12; i++)
  sim.addCar({ name: `B${i + 1}`, color: '#fff', spec: vehicleById('sports'), playerId: null });
sim.startCountdown();
while (sim.raceTime < 12.2) {
  sim.step();
  const t = sim.raceTime;
  if (t > 5 && Math.abs(t * 2 - Math.round(t * 2)) < 0.009) {
    console.info(
      't',
      t.toFixed(1),
      sim
        .standings()
        .map(
          (c) =>
            `${c.name}:s${c.s.toFixed(0)} d${c.d.toFixed(1)} v${(c.phys.forwardSpeed() * 3.6).toFixed(0)} up${c.phys.isFlipped() ? 'F' : ''}`,
        )
        .join(' | '),
    );
  }
}
