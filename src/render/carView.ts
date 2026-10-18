import {
  CanvasTexture,
  Color,
  Quaternion,
  RepeatWrapping,
  Vector3,
  type Mesh,
  type MeshPhysicalMaterial,
  type Scene,
} from 'three';
import type { Combat } from '../combat/combat';
import type { SimCar } from '../core/sim';
import type { VehicleSpec } from '../vehicles/types';
import { buildCarModel, NOMINAL_WHEEL_Y, type CarModel, type PartName } from './carModel';
import { buildGlbCarModel } from './glbCar';
import type { WheelRenderer } from './wheels';

const TIRE_WIDTH = 0.26;

/** Состояние кузова по HP (раздел 2 ТЗ: 2–3 состояния материала). */
export type DamageState = 'clean' | 'dented' | 'sooty' | 'burnt';

export function damageState(hpFrac: number, wrecked: boolean): DamageState {
  if (wrecked) return 'burnt';
  if (hpFrac < 0.33) return 'sooty';
  if (hpFrac < 0.66) return 'dented';
  return 'clean';
}

let dentTex: CanvasTexture | null = null;
/** Нормал-карта «вмятин» — общая на все машины. */
function dentNormal(): CanvasTexture {
  if (dentTex) return dentTex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = 'rgb(128,128,255)';
  ctx.fillRect(0, 0, size, size);
  // Несколько «вмятин»: радиальные градиенты наклона нормали.
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 10 + rnd() * 36;
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    g.addColorStop(0, 'rgba(90,90,255,0.9)');
    g.addColorStop(0.6, 'rgba(165,165,255,0.6)');
    g.addColorStop(1, 'rgba(128,128,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  dentTex = new CanvasTexture(c);
  dentTex.wrapS = dentTex.wrapT = RepeatWrapping;
  return dentTex;
}

/** Настоящая модель (GLB), если загружена; иначе — процедурная. */
function makeModel(spec: VehicleSpec, color: string): CarModel {
  return buildGlbCarModel(spec, color) ?? buildCarModel(spec, color);
}

/** Визуал одной машины: интерполированная поза, кузов, повреждения, колёса через WheelRenderer. */
export class CarView {
  readonly car: SimCar;
  model: CarModel;
  readonly pos = new Vector3();
  readonly quat = new Quaternion();
  private readonly scene: Scene;
  private specShown: VehicleSpec;
  private disguised = false;
  private near = true;
  private state: DamageState = 'clean';
  private readonly baseColor: Color;
  /** Оторванные части-обломки (меш следует за телом обломка в симуляции). */
  readonly debris = new Map<number, Mesh>();
  /** Церемония: машина стоит на ступени подиума (только картинка, физика не трогается). */
  pose: { pos: Vector3; quat: Quaternion } | null = null;
  /** Церемония: машины не из тройки скрыты. */
  hidden = false;

  constructor(scene: Scene, car: SimCar) {
    this.scene = scene;
    this.car = car;
    this.specShown = car.spec;
    this.model = makeModel(car.spec, car.color);
    this.baseColor = this.model.paint.color.clone();
    scene.add(this.model.root);
  }

  private rebuild(spec: VehicleSpec): void {
    const visible = this.model.root.visible;
    this.disposeModel();
    this.model = makeModel(spec, this.car.color);
    this.model.root.visible = visible;
    this.specShown = spec;
    this.state = 'clean';
    this.near = true;
    this.scene.add(this.model.root);
    // Уже оторванные части у новой модели тоже убираем.
    for (const p of this.car.lostParts) this.model.detach(p as PartName)?.geometry.dispose();
  }

  /** LOD: вдали мелкие детали модели скрываются (меньше draw calls). */
  setNear(near: boolean): void {
    if (near === this.near) return;
    this.near = near;
    for (const d of this.model.details ?? []) d.visible = near;
  }

  /** Оторвать часть кузова: возвращает меш для обломка. */
  detachPart(part: string): Mesh | null {
    return this.model.detach(part as PartName);
  }

  private applyDamage(state: DamageState): void {
    if (state === this.state) return;
    this.state = state;
    for (const m of this.model.paints ?? [this.model.paint]) this.paintDamage(m, state);
  }

  private paintDamage(m: MeshPhysicalMaterial, state: DamageState): void {
    switch (state) {
      case 'clean':
        m.color.copy(this.baseColor);
        m.roughness = 0.32;
        m.clearcoat = 1;
        m.normalMap = null;
        break;
      case 'dented':
        m.color.copy(this.baseColor).multiplyScalar(0.88);
        m.roughness = 0.5;
        m.clearcoat = 0.45;
        m.normalMap = dentNormal();
        m.normalScale.set(0.9, 0.9);
        break;
      case 'sooty':
        m.color.copy(this.baseColor).lerp(new Color('#1b1a18'), 0.5);
        m.roughness = 0.8;
        m.clearcoat = 0.1;
        m.normalMap = dentNormal();
        m.normalScale.set(1.6, 1.6);
        break;
      case 'burnt':
        m.color.set('#141312');
        m.roughness = 0.95;
        m.clearcoat = 0;
        m.metalness = 0.2;
        m.normalMap = dentNormal();
        m.normalScale.set(2, 2);
        break;
    }
    m.needsUpdate = true;
  }

  update(alpha: number, wheels: WheelRenderer, combat: Combat | null): void {
    const c = this.car;
    // Смена машины (подарок) или «Шутка» (газонокосилка на время).
    const mower = !!combat && combat.has(c, 'mower');
    const wantSpec = mower ? (c.jokeSpec ?? c.spec) : c.spec;
    if (wantSpec !== this.specShown || mower !== this.disguised) {
      this.disguised = mower;
      this.rebuild(wantSpec);
    }
    this.model.root.visible = !c.race.out && !this.hidden;
    if (c.race.out || this.hidden) return;
    if (this.pose) {
      // На ступени: кузов на высоте подвески над ступенью (как стоял бы на асфальте).
      const w = c.phys.wheels[0];
      const r = c.phys.wheelPos[0]?.r ?? 0.35;
      this.pos.copy(this.pose.pos);
      this.pos.y += (r - (w?.y ?? NOMINAL_WHEEL_Y)) * c.phys.scale;
      this.quat.copy(this.pose.quat);
    } else {
      this.pos.lerpVectors(c.prev.p, c.cur.p, alpha);
      this.quat.slerpQuaternions(c.prev.q, c.cur.q, alpha);
    }
    const root = this.model.root;
    root.position.copy(this.pos);
    root.quaternion.copy(this.quat);
    const k = c.phys.scale;
    root.scale.setScalar(k);
    this.applyDamage(damageState(c.hp / c.maxHp, c.wrecked));
    const shown = this.specShown;
    const own = this.model.wheels;
    if (own) {
      // У GLB свои колёса: ось — по модели, ход подвески, руль и вращение — из физики.
      for (const gw of own) {
        let y = 0;
        for (const i of gw.phys) y += c.phys.wheels[i]?.y ?? NOMINAL_WHEEL_Y;
        const w = c.phys.wheels[gw.phys[0] ?? 0];
        if (!w) continue;
        gw.group.position.set(gw.x, y / gw.phys.length / k, gw.z);
        gw.group.rotation.set(-w.spin, gw.steer ? w.steer : 0, 0, 'YXZ');
      }
      return;
    }
    for (let i = 0; i < 4; i++) {
      const w = c.phys.wheels[i];
      const wp = c.phys.wheelPos[i];
      if (!w || !wp) continue;
      const width =
        shown.body === 'formula'
          ? TIRE_WIDTH * 1.5
          : shown.body === 'tractor' && i >= 2
            ? TIRE_WIDTH * 1.8
            : TIRE_WIDTH;
      // При маскировке колёса берём из показанной модели, а ход подвески — из физики.
      const x = mower ? Math.sign(w.x) * (shown.track / 2) : w.x;
      const z = mower ? Math.sign(w.z) * (shown.wheelbase / 2) : w.z;
      const r = mower ? (i >= 2 ? (shown.rearWheelRadius ?? shown.wheelRadius) : shown.wheelRadius) : wp.r;
      wheels.push(this.pos, this.quat, k, x, w.y + (r - wp.r), z, w.steer, w.spin, r, width, w.x < 0);
    }
  }

  private disposeModel(): void {
    this.scene.remove(this.model.root);
    // Геометрия GLB общая для всех копий модели — её не освобождаем.
    if (!this.model.wheels)
      this.model.root.traverse((o) => {
        const m = o as { geometry?: { dispose(): void } };
        m.geometry?.dispose();
      });
    for (const p of this.model.paints ?? [this.model.paint]) p.dispose();
  }

  dispose(scene: Scene): void {
    void scene;
    this.disposeModel();
    for (const d of this.debris.values()) {
      this.scene.remove(d);
      d.geometry.dispose();
    }
    this.debris.clear();
  }
}
