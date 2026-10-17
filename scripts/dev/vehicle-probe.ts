import { Vector3 } from 'three';
import { initPhysics, createWorld, RAPIER } from '../../src/physics/world';
import { PhysVehicle } from '../../src/physics/vehicle';
import spec from '../../src/vehicles/sports.json';
import type { VehicleSpec } from '../../src/vehicles/types';

await initPhysics();
const world = createWorld();
world.createCollider(
  RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000)
    .setTranslation(0, -0.5, 0)
    .setCollisionGroups((1 << 16) | 0xffff),
);
const car = new PhysVehicle(world, spec as VehicleSpec, new Vector3(0, 0, 0), 0);
for (let i = 0; i < 60 * 12; i++) {
  const t = i / 60;
  car.update(1 / 60, { throttle: 1, brake: 0, steer: t > 8 ? 0.5 : 0 });
  world.step();
  if (i % 60 === 0) {
    const p = car.body.translation();
    console.info(
      t.toFixed(0),
      'v',
      (car.forwardSpeed() * 3.6).toFixed(1),
      'pos',
      p.x.toFixed(1),
      p.y.toFixed(2),
      p.z.toFixed(1),
      'hdg',
      car.heading().toFixed(2),
      'contact',
      car.wheels.map((w) => +w.contact).join(''),
    );
  }
}
