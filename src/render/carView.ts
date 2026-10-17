import { Quaternion, Vector3, type Scene } from 'three';
import type { SimCar } from '../core/sim';
import { buildCarModel, type CarModel } from './carModel';
import type { WheelRenderer } from './wheels';

const TIRE_WIDTH = 0.26;

/** Визуал одной машины: интерполированная поза, кузов, колёса через WheelRenderer. */
export class CarView {
  readonly car: SimCar;
  readonly model: CarModel;
  readonly pos = new Vector3();
  readonly quat = new Quaternion();

  constructor(scene: Scene, car: SimCar) {
    this.car = car;
    this.model = buildCarModel(car.spec, car.color);
    scene.add(this.model.root);
  }

  update(alpha: number, wheels: WheelRenderer): void {
    const c = this.car;
    this.pos.lerpVectors(c.prev.p, c.cur.p, alpha);
    this.quat.slerpQuaternions(c.prev.q, c.cur.q, alpha);
    const root = this.model.root;
    root.position.copy(this.pos);
    root.quaternion.copy(this.quat);
    const k = c.phys.scale;
    root.scale.setScalar(k);
    for (let i = 0; i < 4; i++) {
      const w = c.phys.wheels[i];
      const wp = c.phys.wheelPos[i];
      if (!w || !wp) continue;
      const width =
        c.spec.body === 'formula'
          ? TIRE_WIDTH * 1.5
          : c.spec.body === 'tractor' && i >= 2
            ? TIRE_WIDTH * 1.8
            : TIRE_WIDTH;
      wheels.push(this.pos, this.quat, k, w.x, w.y, w.z, w.steer, w.spin, wp.r, width, w.x < 0);
    }
  }

  dispose(scene: Scene): void {
    scene.remove(this.model.root);
    this.model.root.traverse((o) => {
      const m = o as { geometry?: { dispose(): void } };
      m.geometry?.dispose();
    });
    this.model.paint.dispose();
  }
}
