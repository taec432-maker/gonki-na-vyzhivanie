import { Color, Vector3, type Scene } from 'three';
import type { Track } from '../tracks/track';
import { SURFACES } from '../tracks/types';
import type { CarView } from './carView';
import type { ParticleSystem } from './particles';
import { SkidMarks } from './skids';

const tmpP = new Vector3();
const tmpR = new Vector3();
const tmpB = new Vector3();
const dustCol = new Color();

/**
 * Эффекты колёс (раздел 2 ТЗ): пыль из-под колёс по типу покрытия, следы шин
 * на асфальте при заносе и резком старте, брызги на мокром, выхлоп при разгоне.
 * Только картинка: на гонку не влияет, поэтому Math.random допустим.
 */
export class WheelFx {
  readonly skids: SkidMarks;
  private readonly smoke: ParticleSystem;
  private track: Track | null = null;
  /** Мокрый асфальт: брызги вместо пыли. */
  wet = false;
  enabled = true;

  constructor(scene: Scene, smoke: ParticleSystem) {
    this.skids = new SkidMarks(scene);
    this.smoke = smoke;
  }

  setTrack(track: Track): void {
    this.track = track;
    this.skids.clear();
  }

  update(dt: number, views: ReadonlyMap<number, CarView>): void {
    const track = this.track;
    if (!track || !this.enabled) return;
    for (const v of views.values()) {
      const car = v.car;
      if (car.race.out || !v.model.root.visible) continue;
      const ph = car.phys;
      const speed = Math.abs(ph.forwardSpeed());
      const k = ph.scale;
      const surf = track.surfaceAt(car.s, car.d);
      const props = SURFACES[surf];
      const paved = props.dust === null;
      const right = tmpR.set(1, 0, 0).applyQuaternion(v.quat);
      const throttle = car.controls.throttle;
      for (let i = 0; i < 4; i++) {
        const w = ph.wheels[i];
        const wp = ph.wheelPos[i];
        if (!w || !wp) continue;
        const key = `${car.id}:${i}`;
        if (!w.contact) {
          this.skids.lift(key);
          continue;
        }
        const p = tmpP
          .set(w.x * k, w.y - wp.r * k + 0.02, w.z * k)
          .applyQuaternion(v.quat)
          .add(v.pos);
        // Резкий старт: задние (ведущие) колёса буксуют на малой скорости.
        const launch = i >= 2 && throttle > 0.8 && speed < 9 ? 0.6 : 0;
        const slip = Math.max(w.slip, launch, car.controls.brake > 0.8 && speed > 12 ? 0.7 : 0);
        if (paved && slip > 0.8 && speed > 3) {
          this.skids.add(key, p, right, 0.24 * k, slip);
          if (Math.random() < dt * 5 * slip) this.puff(p, 0.75, 0.75, 0.76, 0.28, 1.4);
        } else this.skids.lift(key);
        if (!paved && speed > 5) {
          dustCol.set(props.dust as string);
          const rate = Math.min(1, speed / 30) * (i >= 2 ? 26 : 10);
          for (let n = this.smoke.n(rate * dt + Math.random() * 0.5); n > 0; n--)
            this.puff(p, dustCol.r, dustCol.g, dustCol.b, 0.4, 2.6 + speed * 0.04);
        } else if (this.wet && speed > 8 && i >= 2 && Math.random() < dt * 30) {
          this.puff(p, 0.55, 0.58, 0.62, 0.12, 0.9);
        }
      }
      // Выхлоп: лёгкий дымок при разгоне с малой скорости.
      if (throttle > 0.5 && speed < 14 && Math.random() < dt * 10) {
        const back = tmpB
          .set(0.3 * k, (car.spec.wheelRadius - 0.33) * k, (car.spec.dims.length / 2 + 0.05) * k)
          .applyQuaternion(v.quat)
          .add(v.pos);
        this.smoke.emit({
          x: back.x,
          y: back.y,
          z: back.z,
          vx: (Math.random() - 0.5) * 0.4,
          vy: 0.35,
          vz: (Math.random() - 0.5) * 0.4,
          life: 0.9,
          size0: 0.25,
          size1: 1.1,
          r0: 0.55,
          g0: 0.56,
          b0: 0.58,
          a0: 0.22,
          a1: 0,
          drag: 1.2,
        });
      }
    }
  }

  private puff(p: Vector3, r: number, g: number, b: number, a: number, size: number): void {
    this.smoke.emit({
      x: p.x + (Math.random() - 0.5) * 0.3,
      y: p.y + 0.1,
      z: p.z + (Math.random() - 0.5) * 0.3,
      vx: (Math.random() - 0.5) * 1.6,
      vy: 0.6 + Math.random() * 0.8,
      vz: (Math.random() - 0.5) * 1.6,
      life: 1.1 + Math.random() * 0.6,
      size0: 0.5,
      size1: size,
      r0: r,
      g0: g,
      b0: b,
      a0: a,
      a1: 0,
      drag: 1.4,
      gravity: 0.2,
    });
  }
}
