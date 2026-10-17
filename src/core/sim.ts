import type RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { buildSpeedProfile } from '../ai/speedProfile';
import { followLine } from '../ai/driver';
import { buildTrackColliders, type TrackColliders } from '../physics/trackCollider';
import { PhysVehicle, type Controls } from '../physics/vehicle';
import { createWorld, initPhysics } from '../physics/world';
import { Track } from '../tracks/track';
import type { TrackDef } from '../tracks/types';
import type { VehicleSpec } from '../vehicles/types';
import { STEP } from './loop';
import { Rng } from './rng';

/** Поза для интерполяции рендера: позиция + кватернион. */
export interface Pose {
  p: Vector3;
  q: Quaternion;
}

export interface SimCar {
  id: number;
  name: string;
  color: string;
  spec: VehicleSpec;
  phys: PhysVehicle;
  controls: Controls;
  prev: Pose;
  cur: Pose;
  /** Прогресс по трассе. */
  s: number;
  d: number;
  hint: number;
}

export interface SimOptions {
  seed: number;
  track: TrackDef;
}

/**
 * Детерминированная симуляция: Rapier-мир, трасса, машины, ИИ.
 * Шагает только на фиксированный STEP; ничего не знает о рендере.
 */
export class Simulation {
  readonly rng: Rng;
  readonly world: RAPIER.World;
  readonly track: Track;
  readonly colliders: TrackColliders;
  readonly cars: SimCar[] = [];
  tick = 0;
  running = true;
  private readonly speedProfile: Float32Array;
  private nextId = 1;

  private constructor(opts: SimOptions) {
    this.rng = new Rng(opts.seed);
    this.world = createWorld();
    this.track = new Track(opts.track);
    this.colliders = buildTrackColliders(this.world, this.track);
    this.speedProfile = buildSpeedProfile(this.track.path, null, 8.5, 7, 80);
  }

  static async create(opts: SimOptions): Promise<Simulation> {
    await initPhysics();
    return new Simulation(opts);
  }

  get time(): number {
    return this.tick * STEP;
  }

  addCar(spec: VehicleSpec, name: string, color: string, slotIndex: number): SimCar {
    const slot = this.track.gridSlots(slotIndex + 1)[slotIndex];
    if (!slot) throw new Error('Нет места на стартовой решётке');
    const phys = new PhysVehicle(this.world, spec, slot.pos, slot.heading);
    const t = phys.body.translation();
    const r = phys.body.rotation();
    const pose = (): Pose => ({ p: new Vector3(t.x, t.y, t.z), q: new Quaternion(r.x, r.y, r.z, r.w) });
    const car: SimCar = {
      id: this.nextId++,
      name,
      color,
      spec,
      phys,
      controls: { throttle: 0, brake: 0, steer: 0 },
      prev: pose(),
      cur: pose(),
      s: slot.s,
      d: 0,
      hint: -1,
    };
    this.cars.push(car);
    return car;
  }

  removeCar(car: SimCar): void {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    car.phys.destroy();
  }

  /** Один шаг 1/60 с. */
  step(): void {
    const path = this.track.path;
    for (const car of this.cars) {
      car.prev.p.copy(car.cur.p);
      car.prev.q.copy(car.cur.q);
      if (this.running) {
        followLine(
          path,
          {
            x: car.cur.p.x,
            z: car.cur.p.z,
            heading: car.phys.heading(),
            speed: car.phys.forwardSpeed(),
            s: car.s,
            d: car.d,
          },
          () => 0,
          (s) => this.speedProfile[path.indexAt(s)] as number,
          car.controls,
        );
      } else {
        car.controls.throttle = 0;
        car.controls.brake = 1;
        car.controls.steer = 0;
      }
      car.phys.update(STEP, car.controls);
    }
    this.world.step();
    for (const car of this.cars) {
      const t = car.phys.body.translation();
      const r = car.phys.body.rotation();
      car.cur.p.set(t.x, t.y, t.z);
      car.cur.q.set(r.x, r.y, r.z, r.w);
      const pr = path.project(t.x, t.y, t.z, car.hint);
      car.s = pr.s;
      car.d = pr.d;
      car.hint = pr.index;
    }
    this.tick++;
  }

  dispose(): void {
    this.world.free();
  }
}
