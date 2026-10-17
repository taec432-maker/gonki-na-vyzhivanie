import type RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { VehicleSpec } from '../vehicles/types';
import { RAPIER as R, CAR_GROUPS, GHOST_CAR_GROUPS, WHEEL_RAY_GROUPS } from './world';

/** Управление на один шаг физики. */
export interface Controls {
  /** −1..1, отрицательное — задний ход. */
  throttle: number;
  /** 0..1. */
  brake: number;
  /** −1..1, + — вправо. */
  steer: number;
}

export interface WheelState {
  /** Положение центра колеса в системе машины (с учётом хода подвески). */
  x: number;
  y: number;
  z: number;
  steer: number;
  spin: number;
  contact: boolean;
  /** Боковое проскальзывание 0..1 (для следов и дыма). */
  slip: number;
}

const tmpV = new Vector3();
const tmpQ = new Quaternion();
const fwd = new Vector3();
const upV = new Vector3();

/**
 * Машина на raycast-vehicle контроллере Rapier поверх rigid body.
 * Система координат машины: вперёд — −Z, вверх — +Y, вправо — +X (как в моделях, раздел 8 ТЗ).
 */
export class PhysVehicle {
  readonly spec: VehicleSpec;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly wheels: WheelState[] = [];
  private readonly world: RAPIER.World;
  /** Множители, которые выставляют эффекты и покрытие. */
  powerMul = 1;
  gripMul = 1;
  maxSpeedMul = 1;
  rollingDrag = 0;
  /** Масштаб машины (эффект «Монстр»). */
  scale = 1;
  ghost = false;
  /** Сила стабилизации рыскания, 1/с (0 — выключена; «масло» её снижает). */
  stability = 5;
  /** Двигатель заглушен (ЭМИ). */
  stalled = false;
  readonly maxForce: number;
  readonly power: number;
  readonly vmax: number;
  readonly dragK: number;
  private readonly restLength: number;
  private readonly halfExtents: { x: number; y: number; z: number };
  readonly wheelPos: { x: number; y: number; z: number; r: number }[];

  constructor(world: RAPIER.World, spec: VehicleSpec, pos: Vector3, heading: number) {
    this.world = world;
    this.spec = spec;
    this.power = spec.powerKw * 1000;
    this.vmax = spec.maxSpeedKmh / 3.6;
    // Тяга на низкой скорости ограничена сцеплением (~1 g у спорткара), дальше — мощностью.
    this.maxForce = spec.mass * 9.81 * 0.95 * spec.grip;
    // Квадратичное сопротивление: на макс. скорости мощность уходит в воздух.
    this.dragK = this.power / Math.pow(this.vmax, 3);

    const { length, width, height } = spec.dims;
    this.halfExtents = { x: width / 2, y: Math.max(0.25, height * 0.32), z: length / 2 };
    const q = tmpQ.setFromAxisAngle(new Vector3(0, 1, 0), -heading);
    const rideY = spec.wheelRadius + 0.35;
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y + rideY + 0.1, pos.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.02)
      .setAngularDamping(0.8)
      .setCcdEnabled(true)
      .setCanSleep(false);
    this.body = world.createRigidBody(bodyDesc);
    const colDesc = R.ColliderDesc.cuboid(this.halfExtents.x, this.halfExtents.y, this.halfExtents.z)
      .setTranslation(0, this.halfExtents.y * 0.6, 0)
      .setDensity(0)
      // Низкое трение кузова: при касании бортами машины скользят, а не закручивают друг друга.
      .setFriction(0.04)
      .setRestitution(0.1)
      .setCollisionGroups(CAR_GROUPS)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    this.collider = world.createCollider(colDesc, this.body);
    // Масса и низкий центр тяжести задаём явно: так машина не переворачивается от каждого удара.
    const m = spec.mass;
    const ix = (m / 12) * (width * width + height * height) * 1.6;
    const iy = (m / 12) * (width * width + length * length) * 1.3;
    const iz = (m / 12) * (length * length + height * height) * 1.6;
    this.body.setAdditionalMassProperties(
      m,
      { x: 0, y: -0.25, z: 0 },
      { x: ix, y: iy, z: iz },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );

    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    this.restLength = 0.35;
    const hw = spec.track / 2;
    const hb = spec.wheelbase / 2;
    const rr = spec.rearWheelRadius ?? spec.wheelRadius;
    // Порядок: FL, FR, RL, RR (имена wheel_FL… как в моделях).
    this.wheelPos = [
      { x: -hw, y: 0, z: -hb, r: spec.wheelRadius },
      { x: hw, y: 0, z: -hb, r: spec.wheelRadius },
      { x: -hw, y: 0, z: hb, r: rr },
      { x: hw, y: 0, z: hb, r: rr },
    ];
    for (let i = 0; i < 4; i++) {
      const w = this.wheelPos[i] as { x: number; y: number; z: number; r: number };
      this.controller.addWheel(
        { x: w.x, y: w.y, z: w.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        this.restLength,
        w.r,
      );
      this.controller.setWheelSuspensionStiffness(i, 32);
      this.controller.setWheelSuspensionCompression(i, 4.2);
      this.controller.setWheelSuspensionRelaxation(i, 3.4);
      this.controller.setWheelMaxSuspensionTravel(i, 0.3);
      this.controller.setWheelMaxSuspensionForce(i, m * 9.81 * 6);
      this.controller.setWheelFrictionSlip(i, 2.4 * spec.grip);
      this.controller.setWheelSideFrictionStiffness(i, 1);
      this.wheels.push({ x: w.x, y: -this.restLength, z: w.z, steer: 0, spin: 0, contact: false, slip: 0 });
    }
  }

  /** Скорость вдоль направления машины, м/с (+ — вперёд). */
  forwardSpeed(): number {
    const v = this.body.linvel();
    this.forward(fwd);
    return v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;
  }

  speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  /** Единичный вектор «вперёд» в мире. */
  forward(out: Vector3): Vector3 {
    const r = this.body.rotation();
    tmpQ.set(r.x, r.y, r.z, r.w);
    return out.set(0, 0, -1).applyQuaternion(tmpQ);
  }

  up(out: Vector3): Vector3 {
    const r = this.body.rotation();
    tmpQ.set(r.x, r.y, r.z, r.w);
    return out.set(0, 1, 0).applyQuaternion(tmpQ);
  }

  /** Курс в плоскости XZ: 0 — по −Z. */
  heading(): number {
    this.forward(fwd);
    return Math.atan2(fwd.x, -fwd.z);
  }

  setGhost(on: boolean): void {
    if (this.ghost === on) return;
    this.ghost = on;
    this.collider.setCollisionGroups(on ? GHOST_CAR_GROUPS : CAR_GROUPS);
  }

  /** Применить управление и обновить контроллер на шаг dt. */
  update(dt: number, c: Controls): void {
    const v = this.forwardSpeed();
    const speed = Math.abs(v);
    const ctl = this.controller;
    const driven = this.spec.drive === 'awd' ? [0, 1, 2, 3] : this.spec.drive === 'fwd' ? [0, 1] : [2, 3];
    let throttle = this.stalled ? 0 : Math.max(-1, Math.min(1, c.throttle));
    const vmax = this.vmax * this.maxSpeedMul;
    if (throttle > 0 && v > vmax) throttle = 0;
    if (throttle < 0 && v < -8) throttle = 0;
    const power = this.power * this.powerMul;
    const force = Math.min(this.maxForce * this.powerMul, power / Math.max(speed, 3)) * throttle;
    for (let i = 0; i < 4; i++) ctl.setWheelEngineForce(i, 0);
    // Вперёд машины — −Z, а ось контроллера — +Z, поэтому знак силы обратный.
    for (const i of driven) ctl.setWheelEngineForce(i, -force / driven.length);
    const brakeF = Math.max(0, Math.min(1, c.brake)) * this.spec.mass * this.massMul * 0.0105;
    const idleBrake = throttle === 0 && c.brake === 0 ? 0.6 : 0;
    for (let i = 0; i < 4; i++) ctl.setWheelBrake(i, brakeF + idleBrake);
    // Руль: меньше угол на скорости, чтобы машина не срывалась в занос от каждого движения.
    const maxSteer = (0.6 * this.spec.steer) / (1 + speed / 22);
    const steer = -Math.max(-1, Math.min(1, c.steer)) * maxSteer;
    ctl.setWheelSteering(0, steer);
    ctl.setWheelSteering(1, steer);
    const slipBase = 2.4 * this.spec.grip * this.gripMul;
    for (let i = 0; i < 4; i++) ctl.setWheelFrictionSlip(i, slipBase);

    // Аэродинамика: сопротивление и прижим; сопротивление качению по покрытию.
    const lv = this.body.linvel();
    const m = this.spec.mass * this.massMul;
    const dragF = this.dragK * speed * speed;
    const rollF = this.rollingDrag * m * 9.81 * Math.min(1, speed / 3);
    if (speed > 0.1) {
      const inv = 1 / Math.hypot(lv.x, lv.y, lv.z);
      const f = (dragF + rollF) * dt;
      this.body.applyImpulse({ x: -lv.x * inv * f, y: -lv.y * inv * f, z: -lv.z * inv * f }, true);
    }
    this.up(upV);
    const down = 0.9 * speed * speed * dt * (m / 1200);
    this.body.applyImpulse({ x: -upV.x * down, y: -upV.y * down, z: -upV.z * down }, true);

    ctl.updateVehicle(dt, undefined, WHEEL_RAY_GROUPS);

    // Стабилизация (аркадная «ESP»): гасим вращение кузова сверх того, что задаёт руль.
    // Без неё касание соседа на 130 км/ч разворачивает машину поперёк трассы.
    let grounded = 0;
    for (let i = 0; i < 4; i++) if (ctl.wheelIsInContact(i)) grounded++;
    if (grounded >= 2 && speed > 4) {
      const av = this.body.angvel();
      const angle = Math.max(-1, Math.min(1, c.steer)) * maxSteer;
      const yawDes = (-v * Math.tan(angle)) / (this.spec.wheelbase * this.scale);
      const excess = av.y - yawDes;
      const k = Math.min(1, this.stability * dt);
      // Крен и тангаж тоже чуть гасим — меньше переворотов от ударов.
      this.body.setAngvel({ x: av.x * (1 - k * 0.3), y: av.y - excess * k, z: av.z * (1 - k * 0.3) }, true);
    }

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i] as WheelState;
      const wp = this.wheelPos[i] as { x: number; y: number; z: number; r: number };
      const susp = ctl.wheelSuspensionLength(i) ?? this.restLength;
      w.x = wp.x;
      w.y = wp.y - susp;
      w.z = wp.z;
      w.steer = -(ctl.wheelSteering(i) ?? 0);
      w.spin = ctl.wheelRotation(i) ?? 0;
      w.contact = ctl.wheelIsInContact(i);
      const side = Math.abs(ctl.wheelSideImpulse(i) ?? 0);
      w.slip = w.contact ? Math.min(1, side / (m * 0.02)) : 0;
    }
  }

  /** Перевернулась (крыша смотрит вниз или машина лежит на боку). */
  isFlipped(): boolean {
    this.up(upV);
    return upV.y < 0.35;
  }

  /** Поставить машину в точку (респаун, телепорт). */
  teleport(pos: Vector3, heading: number, speed = 0): void {
    const q = tmpQ.setFromAxisAngle(tmpV.set(0, 1, 0), -heading);
    this.body.setTranslation({ x: pos.x, y: pos.y + this.spec.wheelRadius + 0.45, z: pos.z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    const fx = Math.sin(heading) * speed;
    const fz = -Math.cos(heading) * speed;
    this.body.setLinvel({ x: fx, y: 0, z: fz }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  private massMul = 1;

  /** Множитель массы (Монстр — тяжелее, расталкивает остальных). */
  setMassMul(k: number): void {
    if (Math.abs(this.massMul - k) < 1e-3) return;
    this.massMul = k;
    const { length, width, height } = this.spec.dims;
    const m = this.spec.mass * k;
    const s2 = this.scale * this.scale;
    const ix = (m / 12) * (width * width + height * height) * 1.6 * s2;
    const iy = (m / 12) * (width * width + length * length) * 1.3 * s2;
    const iz = (m / 12) * (length * length + height * height) * 1.6 * s2;
    this.body.setAdditionalMassProperties(
      m,
      { x: 0, y: -0.25 * this.scale, z: 0 },
      { x: ix, y: iy, z: iz },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
    for (let i = 0; i < 4; i++) this.controller.setWheelMaxSuspensionForce(i, m * 9.81 * 6);
  }

  /** Изменить масштаб машины (Монстр): пересоздаёт коллайдер и колёса. */
  setScale(k: number): void {
    if (Math.abs(this.scale - k) < 1e-3) return;
    this.scale = k;
    this.collider.setHalfExtents({ x: this.halfExtents.x * k, y: this.halfExtents.y * k, z: this.halfExtents.z * k });
    this.collider.setTranslationWrtParent({ x: 0, y: this.halfExtents.y * 0.6 * k, z: 0 });
    for (let i = 0; i < 4; i++) {
      const wp = this.wheelPos[i] as { x: number; y: number; z: number; r: number };
      this.controller.setWheelChassisConnectionPointCs(i, { x: wp.x * k, y: wp.y, z: wp.z * k });
      this.controller.setWheelRadius(i, wp.r * k);
      this.controller.setWheelSuspensionRestLength(i, this.restLength * k);
    }
  }

  destroy(): void {
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
