import type RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { AiPilot, rollTraits, type Character, type Hazard, type Neighbor } from '../ai/pilot';
import { computeRacingLine } from '../ai/racingLine';
import { buildSpeedProfile } from '../ai/speedProfile';
import { Combat } from '../combat/combat';
import { installArsenal } from '../combat/arsenal';
import { RAM, hitZone, ramDamage, wallDamage } from '../combat/damage';
import { buildTrackColliders, floorHeight, type TrackColliders } from '../physics/trackCollider';
import { PhysVehicle, type Controls } from '../physics/vehicle';
import { RAPIER as R, DEBRIS_GROUPS, createWorld, initPhysics } from '../physics/world';
import { RaceTracker, type RacerProgress } from '../race/progress';
import { Track, headingOf } from '../tracks/track';
import { SURFACES, type TrackDef } from '../tracks/types';
import type { VehicleSpec } from '../vehicles/types';
import { EventBus } from './events';
import { STEP, STEP_HZ } from './loop';
import { Rng } from './rng';

/** Поза для интерполяции рендера: позиция + кватернион. */
export interface Pose {
  p: Vector3;
  q: Quaternion;
}

export type Phase = 'grid' | 'countdown' | 'race' | 'finished';

export interface CarEntry {
  name: string;
  color: string;
  spec: VehicleSpec;
  /** Ключ зрителя (userId) или null для бота. */
  playerId: string | null;
  character?: Character;
}

export interface SimCar {
  id: number;
  name: string;
  color: string;
  spec: VehicleSpec;
  playerId: string | null;
  phys: PhysVehicle;
  pilot: AiPilot;
  controls: Controls;
  prev: Pose;
  cur: Pose;
  /** Прогресс по трассе. */
  s: number;
  d: number;
  hint: number;
  race: RacerProgress;
  respawns: number;
  /** Место на стартовой решётке. */
  slot: number;
  /** До какого шага машина «призрак» после респауна. */
  ghostUntil: number;
  /** Счётчик столкновений (для статистики и камеры). */
  hits: number;
  /** Очки здоровья (раздел 6 ТЗ): из JSON машины. */
  hp: number;
  maxHp: number;
  /** Скорость до шага физики (для урона от столкновений). */
  vel: Vector3;
  /** Взорвана и ждёт возрождения/удаления. */
  wrecked: boolean;
  /** Шаг взрыва. */
  wreckTick: number;
  /** Когда возродится (режим «Гонка»), −1 — никогда. */
  reviveTick: number;
  /** Кто последним бил (для очков за уничтожение). */
  lastHitBy: number | null;
  lastHitTick: number;
  kills: number;
  /** Запасная жизнь (подарок «Воскрешение», пока машина в гонке). */
  spareLife: boolean;
  /** Оторванные части (капот, бамперы). */
  lostParts: Set<string>;
  /** Во что превращает «Шутка» (газонокосилка) — только внешний вид и скорость. */
  jokeSpec: VehicleSpec | null;
}

export interface Debris {
  id: number;
  carId: number;
  part: string;
  body: RAPIER.RigidBody;
  until: number;
  prev: Pose;
  cur: Pose;
}

export interface RaceResult {
  id: number;
  name: string;
  playerId: string | null;
  place: number;
  finished: boolean;
  /** Время финиша, с от старта (или null). */
  time: number | null;
  laps: number;
  out: boolean;
}

export interface SimEvents {
  phase: { phase: Phase };
  gate: { car: SimCar };
  lap: { car: SimCar; lap: number };
  finish: { car: SimCar; place: number; time: number };
  respawn: { car: SimCar; reason: 'stuck' | 'fall' | 'flip' };
  leader: { car: SimCar };
  /** Машина взорвалась (HP кончились). */
  explode: { car: SimCar; killer: SimCar | null };
  /** Возродилась (режим «Гонка» через 3 с или «Воскрешение»). */
  revive: { car: SimCar };
  /** Выбыла окончательно (режим «Выживание»). */
  out: { car: SimCar };
  /** Оторвалась часть кузова. */
  part: { car: SimCar; debris: Debris };
  /** Машина сменила модель (подарок «Смена машины»). */
  swap: { car: SimCar };
  /** Столкновение с уроном (для искр и камеры). */
  crash: { car: SimCar; other: SimCar | null; amount: number; pos: Vector3 };
}

export interface RaceConfig {
  seed: number;
  track: TrackDef;
  /** Все машины, из которых выбирают «Смена машины» и «Шутка». */
  vehicles?: VehicleSpec[];
  laps: number;
  /** Лимит времени гонки, с (после — побеждает лидер). */
  timeLimit: number;
  /** Сколько ждать остальных после первого финиша, с. */
  grace: number;
  /** Длительность отсчёта 3-2-1, с. */
  countdown: number;
  /** «Гонка» — возрождение через 3 с с 50 HP; «Выживание» — взрыв и выбывание. */
  mode: 'race' | 'survival';
}

export const DEFAULT_RACE: Omit<RaceConfig, 'seed' | 'track' | 'vehicles'> = {
  laps: 3,
  timeLimit: 240,
  grace: 30,
  countdown: 3,
  mode: 'race',
};

/**
 * Детерминированная симуляция одного заезда: Rapier-мир, трасса, машины, ИИ, круги.
 * Шагает только на фиксированный STEP; ничего не знает о рендере.
 */
export class Simulation {
  readonly rng: Rng;
  readonly world: RAPIER.World;
  readonly track: Track;
  readonly colliders: TrackColliders;
  readonly cars: SimCar[] = [];
  readonly tracker: RaceTracker;
  readonly events = new EventBus<SimEvents>();
  readonly config: RaceConfig;
  readonly racingLine: Float32Array;
  private readonly speedProfile: Float32Array;
  readonly hazards: Hazard[] = [];
  readonly combat: Combat;
  readonly debris: Debris[] = [];
  /** Пул машин для эффекта «Смена машины». */
  readonly vehiclePool: VehicleSpec[];
  private readonly colliderCar = new Map<number, SimCar>();
  tick = 0;
  phase: Phase = 'grid';
  phaseTick = 0;
  /** Шаг старта гонки (после отсчёта). */
  raceStartTick = 0;
  firstFinishTick = -1;
  /** Пауза из панели: машины стоят на тормозе. */
  running = true;
  private nextId = 1;
  private leaderId = -1;
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly minY: number;

  private constructor(config: RaceConfig) {
    this.config = config;
    this.rng = new Rng(config.seed);
    this.world = createWorld();
    this.track = new Track(config.track);
    this.colliders = buildTrackColliders(this.world, this.track);
    this.tracker = new RaceTracker(this.track, config.laps);
    this.racingLine = computeRacingLine(this.track);
    this.speedProfile = buildSpeedProfile(this.track.path, this.racingLine, 9.5, 7.5, 90);
    this.eventQueue = new R.EventQueue(true);
    this.combat = new Combat(this, this.rng.fork('combat'));
    this.vehiclePool = config.vehicles ?? [];
    installArsenal(this.combat, this);
    let minY = Infinity;
    for (const sm of this.track.path.samples) minY = Math.min(minY, sm.pos.y);
    this.minY = minY;
  }

  static async create(config: Partial<RaceConfig> & { seed: number; track: TrackDef }): Promise<Simulation> {
    await initPhysics();
    return new Simulation({ ...DEFAULT_RACE, ...config });
  }

  /** Синхронное создание — когда физика уже инициализирована (initPhysics). */
  static createSync(config: Partial<RaceConfig> & { seed: number; track: TrackDef }): Simulation {
    return new Simulation({ ...DEFAULT_RACE, ...config });
  }

  get time(): number {
    return this.tick * STEP;
  }

  /** Время гонки от старта, с (во время отсчёта — отрицательное). */
  get raceTime(): number {
    if (this.phase === 'grid') return 0;
    if (this.phase === 'countdown') return -(this.config.countdown - this.phaseTick * STEP);
    return (this.tick - this.raceStartTick) * STEP;
  }

  /** Первое свободное место на решётке. */
  private freeSlot(): number {
    const used = new Set(this.cars.map((c) => c.slot));
    let i = 0;
    while (used.has(i)) i++;
    return i;
  }

  addCar(entry: CarEntry): SimCar {
    const index = this.freeSlot();
    const slot = this.track.gridSlots(index + 1)[index];
    if (!slot) throw new Error('Нет места на стартовой решётке');
    const phys = new PhysVehicle(this.world, entry.spec, slot.pos, slot.heading);
    const t = phys.body.translation();
    const r = phys.body.rotation();
    const pose = (): Pose => ({ p: new Vector3(t.x, t.y, t.z), q: new Quaternion(r.x, r.y, r.z, r.w) });
    const id = this.nextId++;
    const pilotRng = this.rng.fork(`pilot-${id}`);
    const car: SimCar = {
      id,
      name: entry.name,
      color: entry.color,
      spec: entry.spec,
      playerId: entry.playerId,
      phys,
      pilot: new AiPilot(rollTraits(pilotRng, entry.character), pilotRng),
      controls: { throttle: 0, brake: 1, steer: 0 },
      prev: pose(),
      cur: pose(),
      s: slot.s,
      d: 0,
      hint: -1,
      race: this.tracker.add(id),
      respawns: 0,
      slot: index,
      ghostUntil: 0,
      hits: 0,
      hp: entry.spec.hp,
      maxHp: entry.spec.hp,
      vel: new Vector3(),
      wrecked: false,
      wreckTick: 0,
      reviveTick: -1,
      lastHitBy: null,
      lastHitTick: -9999,
      kills: 0,
      spareLife: false,
      lostParts: new Set(),
      jokeSpec: null,
    };
    const pr = this.track.path.project(t.x, t.y, t.z);
    car.s = pr.s;
    car.d = pr.d;
    car.hint = pr.index;
    car.race.progress = this.tracker.progressOf(car.race, car.s);
    this.cars.push(car);
    this.colliderCar.set(phys.collider.handle, car);
    return car;
  }

  carById(id: number): SimCar | undefined {
    return this.cars.find((c) => c.id === id);
  }

  removeCar(car: SimCar): void {
    this.combat?.forget(car.id);
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    this.tracker.remove(car.id);
    this.colliderCar.delete(car.phys.collider.handle);
    car.phys.destroy();
  }

  /** Расставить машины по местам решётки в заданном порядке (перед стартом). */
  arrangeGrid(order: readonly SimCar[]): void {
    const slots = this.track.gridSlots(order.length);
    order.forEach((car, i) => {
      const sl = slots[i];
      if (!sl) return;
      car.slot = i;
      const pos = sl.pos.clone();
      pos.y = floorHeight(this.track, sl.s, 0);
      car.phys.teleport(pos, sl.heading);
      const t = car.phys.body.translation();
      const r = car.phys.body.rotation();
      car.cur.p.set(t.x, t.y, t.z);
      car.prev.p.copy(car.cur.p);
      car.cur.q.set(r.x, r.y, r.z, r.w);
      car.prev.q.copy(car.cur.q);
      const pr = this.track.path.project(t.x, t.y, t.z);
      car.s = pr.s;
      car.d = pr.d;
      car.hint = pr.index;
      car.race.progress = this.tracker.progressOf(car.race, car.s);
    });
  }

  setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTick = 0;
    if (p === 'race') this.raceStartTick = this.tick;
    this.events.emit('phase', { phase: p });
  }

  /** Начать отсчёт 3-2-1 (из 'grid'). */
  startCountdown(): void {
    if (this.phase === 'grid') this.setPhase('countdown');
  }

  /** Допустимая скорость для машины в точке s: профиль линии × сцепление машины и покрытия. */
  private speedFor(car: SimCar): (s: number) => number {
    const path = this.track.path;
    const grip = car.spec.grip * car.phys.gripMul;
    const vmax = car.phys.vmax * car.phys.maxSpeedMul;
    return (s: number) => {
      const surf = SURFACES[this.track.surfaceAt(s, car.d)].grip;
      return Math.min(vmax, (this.speedProfile[path.indexAt(s)] as number) * Math.sqrt(grip * surf));
    };
  }

  standings(): SimCar[] {
    const order = this.tracker.standings();
    const byId = new Map(this.cars.map((c) => [c.id, c]));
    return order.map((p) => byId.get(p.id)).filter((c): c is SimCar => !!c);
  }

  /** Мягкий респаун на последнем пройденном чекпойнте: свободная полоса, 2 с «призраком». */
  respawn(car: SimCar, reason: 'stuck' | 'fall' | 'flip'): void {
    const gate = this.track.gates[this.tracker.lastGateIndex(car.race)];
    const baseS = car.race.gatesPassed === 0 ? (this.track.gridSlots(1)[0]?.s ?? 0) : (gate?.s ?? 0) + 3;
    const half = this.track.path.widthAt(baseS) / 2 - 2;
    const lanes = [0, -half * 0.6, half * 0.6, -half * 0.3, half * 0.3];
    let best = 0;
    let bestScore = -Infinity;
    for (const lane of lanes) {
      const p = this.track.path.pointAt(baseS, lane);
      let minDist = Infinity;
      for (const o of this.cars) if (o !== car) minDist = Math.min(minDist, o.cur.p.distanceTo(p));
      if (minDist > bestScore) {
        bestScore = minDist;
        best = lane;
      }
    }
    const pos = this.track.path.pointAt(baseS, best);
    pos.y = floorHeight(this.track, baseS, best);
    car.phys.teleport(pos, headingOf(this.track.path.tangentAt(baseS)), 4);
    car.phys.setGhost(true);
    car.ghostUntil = this.tick + 2 * STEP_HZ;
    car.respawns++;
    const t = car.phys.body.translation();
    car.cur.p.set(t.x, t.y, t.z);
    car.prev.p.copy(car.cur.p);
    const r = car.phys.body.rotation();
    car.cur.q.set(r.x, r.y, r.z, r.w);
    car.prev.q.copy(car.cur.q);
    const pr = this.track.path.project(t.x, t.y, t.z);
    car.s = pr.s;
    car.d = pr.d;
    car.hint = pr.index;
    // Прогресс после переноса меньше прежнего — иначе анти-застревание сработает снова и снова.
    car.race.progress = this.tracker.progressOf(car.race, car.s);
    car.pilot.resetStuck(this.tick, car.race.progress);
    this.events.emit('respawn', { car, reason });
  }

  // ───────────── Урон, взрывы, возрождение (этап 4) ─────────────

  private onCollision(h1: number, h2: number): void {
    const a = this.colliderCar.get(h1);
    const b = this.colliderCar.get(h2);
    if (a && b) {
      a.hits++;
      b.hits++;
      this.ram(a, b);
      return;
    }
    const car = a ?? b;
    const other = a ? h2 : h1;
    if (car && this.colliders.wallHandles.has(other)) {
      // Скорость по нормали к стене ≈ поперёк трассы.
      const right = this.track.path.sample(car.hint < 0 ? 0 : car.hint).right;
      const normal = Math.abs(car.vel.x * right.x + car.vel.z * right.z);
      const dmg = wallDamage(normal);
      if (dmg > 0) {
        const got = this.combat.damage(car, dmg, 'wall');
        if (got > 0) this.events.emit('crash', { car, other: null, amount: got, pos: car.cur.p.clone() });
      }
    }
  }

  /** Таран: урон обоим по формуле раздела 6 ТЗ. */
  private ram(a: SimCar, b: SimCar): void {
    const n = b.cur.p.clone().sub(a.cur.p);
    n.y = 0;
    const dist = n.length();
    if (dist < 1e-3) return;
    n.multiplyScalar(1 / dist);
    const closing = Math.max(0, (a.vel.x - b.vel.x) * n.x + (a.vel.z - b.vel.z) * n.z);
    const zone = (self: SimCar, toOther: Vector3): ReturnType<typeof hitZone> => {
      const q = new Quaternion(self.cur.q.x, self.cur.q.y, self.cur.q.z, self.cur.q.w).invert();
      const local = toOther.clone().applyQuaternion(q);
      return hitZone(local.x, local.z);
    };
    const zA = zone(a, n);
    const zB = zone(b, n.clone().multiplyScalar(-1));
    const monsterA = this.combat.has(a, 'monster');
    const monsterB = this.combat.has(b, 'monster');
    const dmgA =
      monsterB && !monsterA
        ? closing > 2
          ? RAM.monster
          : 0
        : monsterA
          ? 0
          : ramDamage({ closing, massSelf: a.spec.mass, massOther: b.spec.mass, zoneSelf: zA, zoneOther: zB });
    const dmgB =
      monsterA && !monsterB
        ? closing > 2
          ? RAM.monster
          : 0
        : monsterB
          ? 0
          : ramDamage({ closing, massSelf: b.spec.mass, massOther: a.spec.mass, zoneSelf: zB, zoneOther: zA });
    const pos = a.cur.p.clone().addScaledVector(n, dist / 2);
    if (dmgA > 0) {
      const got = this.combat.damage(a, dmgA, 'ram', b.id);
      if (got > 0) {
        a.lastHitBy = b.id;
        a.lastHitTick = this.tick;
        this.events.emit('crash', { car: a, other: b, amount: got, pos });
      }
    }
    if (dmgB > 0) {
      const got = this.combat.damage(b, dmgB, 'ram', a.id);
      if (got > 0) {
        b.lastHitBy = a.id;
        b.lastHitTick = this.tick;
        this.events.emit('crash', { car: b, other: a, amount: got, pos });
      }
    }
  }

  /** Части отваливаются по мере потери HP; при 0 HP — взрыв. */
  private updateDamage(): void {
    for (const car of this.cars) {
      if (car.race.out) continue;
      if (car.wrecked) {
        const since = this.tick - car.wreckTick;
        if (this.config.mode === 'survival') {
          if (since >= 2.5 * STEP_HZ) this.eliminate(car);
        } else if (car.reviveTick >= 0 && this.tick >= car.reviveTick) this.revive(car);
        continue;
      }
      const frac = car.hp / car.maxHp;
      if (frac < 0.6 && !car.lostParts.has('bumperF') && !car.lostParts.has('bumperR')) {
        this.spawnDebris(car, this.combat.rngNext() < 0.5 ? 'bumperF' : 'bumperR');
      }
      if (frac < 0.35 && !car.lostParts.has('hood')) this.spawnDebris(car, 'hood');
      if (car.hp <= 0) this.explode(car);
    }
  }

  /** Взрыв: машина подлетает; «Гонка» — возрождение через 3 с, «Выживание» — выбывание. */
  explode(car: SimCar): void {
    if (car.wrecked || car.race.out) return;
    if (car.spareLife) {
      // Запасная жизнь (подарок «Воскрешение»): вместо взрыва — ремонт.
      car.spareLife = false;
      car.hp = Math.round(car.maxHp * 0.5);
      this.events.emit('revive', { car });
      return;
    }
    car.wrecked = true;
    car.wreckTick = this.tick;
    car.hp = 0;
    const m = car.spec.mass;
    car.phys.body.applyImpulse({ x: 0, y: m * 6, z: 0 }, true);
    car.phys.body.applyTorqueImpulse(
      { x: m * (this.combat.rngNext() - 0.5) * 3, y: 0, z: m * (this.combat.rngNext() - 0.5) * 3 },
      true,
    );
    for (const part of ['hood', 'bumperF', 'bumperR']) if (!car.lostParts.has(part)) this.spawnDebris(car, part);
    let killer: SimCar | null = null;
    if (car.lastHitBy !== null && this.tick - car.lastHitTick < 6 * STEP_HZ) {
      killer = this.carById(car.lastHitBy) ?? null;
      if (killer && killer !== car) killer.kills++;
      else killer = null;
    }
    this.combat.forget(car.id);
    car.reviveTick = this.config.mode === 'race' ? this.tick + 3 * STEP_HZ : -1;
    this.events.emit('explode', { car, killer });
  }

  /** Окончательное выбывание («Выживание»): тело выключается из физики. */
  private eliminate(car: SimCar): void {
    car.race.out = true;
    car.race.outTick = this.tick;
    car.wrecked = false;
    car.phys.body.setEnabled(false);
    this.events.emit('out', { car });
  }

  /** Возрождение на последнем чекпойнте с 50 HP (режим «Гонка» или подарок «Воскрешение»). */
  revive(car: SimCar): void {
    if (car.race.out) {
      car.race.out = false;
      car.phys.body.setEnabled(true);
    }
    car.wrecked = false;
    car.reviveTick = -1;
    car.hp = Math.round(car.maxHp * 0.5);
    car.lostParts.clear();
    this.respawn(car, 'stuck');
    this.events.emit('revive', { car });
  }

  /** Оторвать часть кузова: отдельное тело-обломок, исчезает через 5 с. */
  private spawnDebris(car: SimCar, part: string): void {
    if (car.lostParts.has(part)) return;
    car.lostParts.add(part);
    const L = car.spec.dims.length * car.phys.scale;
    const W = car.spec.dims.width * car.phys.scale;
    const local =
      part === 'hood' ? new Vector3(0, 0.5, -L * 0.25) : new Vector3(0, -0.05, part === 'bumperF' ? -L / 2 : L / 2);
    const pos = local.clone().applyQuaternion(car.cur.q).add(car.cur.p);
    const half = part === 'hood' ? { x: W * 0.42, y: 0.04, z: L * 0.15 } : { x: W * 0.45, y: 0.1, z: 0.1 };
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: car.cur.q.x, y: car.cur.q.y, z: car.cur.q.z, w: car.cur.q.w })
        .setLinvel(car.vel.x * 0.8, car.vel.y + 3 + this.combat.rngNext() * 3, car.vel.z * 0.8)
        .setAngvel({
          x: this.combat.rngNext() * 8 - 4,
          y: this.combat.rngNext() * 8 - 4,
          z: this.combat.rngNext() * 8 - 4,
        })
        .setLinearDamping(0.3)
        .setAngularDamping(0.4),
    );
    this.world.createCollider(
      R.ColliderDesc.cuboid(half.x, half.y, half.z).setDensity(60).setCollisionGroups(DEBRIS_GROUPS).setFriction(0.8),
      body,
    );
    const t = body.translation();
    const r = body.rotation();
    const pose = (): Pose => ({ p: new Vector3(t.x, t.y, t.z), q: new Quaternion(r.x, r.y, r.z, r.w) });
    const d: Debris = {
      id: this.nextId++,
      carId: car.id,
      part,
      body,
      until: this.tick + 5 * STEP_HZ,
      prev: pose(),
      cur: pose(),
    };
    this.debris.push(d);
    this.events.emit('part', { car, debris: d });
  }

  private updateDebris(): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i] as Debris;
      d.prev.p.copy(d.cur.p);
      d.prev.q.copy(d.cur.q);
      if (this.tick >= d.until) {
        this.world.removeRigidBody(d.body);
        this.debris.splice(i, 1);
        continue;
      }
      const t = d.body.translation();
      const r = d.body.rotation();
      d.cur.p.set(t.x, t.y, t.z);
      d.cur.q.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Телепорт на позицию вперёд: за машину впереди (лидер — на 60 м вперёд). */
  teleportAhead(car: SimCar): void {
    if (car.race.finished || car.race.out) return;
    const order = this.standings().filter((c) => !c.race.out && !c.race.finished);
    const i = order.indexOf(car);
    const ahead = i > 0 ? order[i - 1] : undefined;
    const ahead2 = i > 1 ? order[i - 2] : undefined;
    // Ровно на одну позицию: сразу перед соседом впереди, но не дальше середины до следующего.
    const gap = ahead && ahead2 ? this.track.path.deltaS(ahead.s, ahead2.s) : 12;
    const targetS = ahead ? ahead.s + Math.max(2.5, Math.min(6, gap / 2)) : car.s + 60;
    // Не перепрыгиваем линию финиша последнего круга.
    const lead = this.tracker.gatesToFinish - car.race.gatesPassed;
    if (lead <= 1) return;
    const s = this.track.path.wrapS(targetS);
    const half = this.track.path.widthAt(s) / 2 - 2;
    const lanes = [0, half * 0.6, -half * 0.6];
    let best = 0;
    let bestScore = -Infinity;
    for (const lane of lanes) {
      const p = this.track.path.pointAt(s, lane);
      let minD = Infinity;
      for (const o of this.cars) if (o !== car) minD = Math.min(minD, o.cur.p.distanceTo(p));
      if (minD > bestScore) {
        bestScore = minD;
        best = lane;
      }
    }
    const pos = this.track.path.pointAt(s, best);
    pos.y = floorHeight(this.track, s, best);
    const speed = Math.max(12, car.phys.forwardSpeed());
    car.phys.teleport(pos, headingOf(this.track.path.tangentAt(s)), speed);
    this.tracker.skipTo(car.id, s, this.tick);
    const t = car.phys.body.translation();
    car.cur.p.set(t.x, t.y, t.z);
    car.prev.p.copy(car.cur.p);
    const pr = this.track.path.project(t.x, t.y, t.z);
    car.s = pr.s;
    car.d = pr.d;
    car.hint = pr.index;
    car.race.progress = this.tracker.progressOf(car.race, car.s);
    car.pilot.resetStuck(this.tick, car.race.progress);
    car.ghostUntil = this.tick + STEP_HZ;
  }

  /** Сменить машину на ходу: новое тело в той же позе и с той же скоростью. */
  swapVehicle(car: SimCar, spec: VehicleSpec): void {
    const old = car.phys;
    const heading = old.heading();
    const pos = car.cur.p.clone();
    pos.y = floorHeight(this.track, car.s, car.d);
    const speed = old.forwardSpeed();
    this.colliderCar.delete(old.collider.handle);
    old.destroy();
    const phys = new PhysVehicle(this.world, spec, pos, heading);
    phys.teleport(pos, heading, speed);
    car.phys = phys;
    const frac = car.hp / car.maxHp;
    car.spec = spec;
    car.maxHp = spec.hp;
    car.hp = Math.max(1, Math.round(spec.hp * frac));
    car.lostParts.clear();
    this.colliderCar.set(phys.collider.handle, car);
    car.ghostUntil = this.tick + STEP_HZ;
    this.events.emit('swap', { car });
  }

  /** Один шаг 1/60 с. */
  step(): void {
    const path = this.track.path;
    const racing = this.phase === 'race' || this.phase === 'finished';
    if (racing) this.combat.activateQueue();
    const neighbors: Neighbor[] = this.cars.map((c) => ({
      id: c.id,
      s: c.s,
      d: c.d,
      speed: c.phys.forwardSpeed(),
      ghost: c.phys.ghost,
    }));
    for (const car of this.cars) {
      car.prev.p.copy(car.cur.p);
      car.prev.q.copy(car.cur.q);
      const ph = car.phys;
      if (car.race.out) continue;
      if (car.wrecked) {
        car.controls.throttle = 0;
        car.controls.brake = 0.3;
        car.controls.steer = 0;
        ph.update(STEP, car.controls);
        continue;
      }
      if (racing && this.running) {
        const sf = SURFACES[this.track.surfaceAt(car.s, car.d)];
        ph.gripMul = sf.grip;
        ph.rollingDrag = sf.drag;
        this.combat.applyModifiers(car);
        if ((this.tick + car.id * 37) % 180 === 0)
          car.pilot.considerRam(
            this.tick,
            car.s,
            this.track,
            neighbors.filter((n) => n.id !== car.id),
          );
        const decision = car.pilot.drive(
          this.tick,
          this.track,
          {
            x: car.cur.p.x,
            z: car.cur.p.z,
            heading: ph.heading(),
            speed: ph.forwardSpeed(),
            s: car.s,
            d: car.d,
            progress: car.race.progress,
            flipped: ph.isFlipped(),
          },
          this.racingLine,
          this.speedFor(car),
          neighbors.filter((n) => n.id !== car.id),
          this.hazards,
        );
        Object.assign(car.controls, car.pilot.out);
        if (car.race.finished) {
          // Круг почёта: спокойно, не мешая остальным.
          car.controls.throttle = Math.min(car.controls.throttle, 0.45);
        }
        if (decision === 'respawn' && !car.race.finished) this.respawn(car, ph.isFlipped() ? 'flip' : 'stuck');
      } else {
        car.controls.throttle = 0;
        car.controls.brake = 1;
        car.controls.steer = 0;
      }
      ph.update(STEP, car.controls);
    }
    for (const car of this.cars) {
      const v = car.phys.body.linvel();
      car.vel.set(v.x, v.y, v.z);
    }
    this.world.step(this.eventQueue);
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started || !racing) return;
      this.onCollision(h1, h2);
    });
    for (const car of this.cars) {
      const t = car.phys.body.translation();
      const r = car.phys.body.rotation();
      const px = car.cur.p.x;
      const pz = car.cur.p.z;
      car.cur.p.set(t.x, t.y, t.z);
      car.cur.q.set(r.x, r.y, r.z, r.w);
      const pr = path.project(t.x, t.y, t.z, car.hint);
      car.s = pr.s;
      car.d = pr.d;
      car.hint = pr.index;
      if (racing) {
        const ev = this.tracker.update(car.id, px, pz, t.x, t.z, car.s, this.tick);
        if (ev === 'gate') this.events.emit('gate', { car });
        else if (ev === 'lap') this.events.emit('lap', { car, lap: car.race.lap });
        else if (ev === 'finish') {
          if (this.firstFinishTick < 0) this.firstFinishTick = this.tick;
          this.events.emit('finish', {
            car,
            place: this.tracker.finishedCount,
            time: (this.tick - this.raceStartTick) * STEP,
          });
        }
      } else {
        car.race.progress = this.tracker.progressOf(car.race, car.s);
      }
      // Улетел вниз (обрыв, за пределы) — вернуть на трассу.
      if (racing && t.y < Math.min(pr.y, this.minY) - (this.track.def.fallDepth ?? 12)) this.respawn(car, 'fall');
    }
    if (racing) {
      this.combat.postStep();
      this.updateDamage();
    }
    this.updateDebris();
    this.updatePhase();
    this.tick++;
    this.phaseTick++;
  }

  private updatePhase(): void {
    if (this.phase === 'countdown' && this.phaseTick + 1 >= this.config.countdown * STEP_HZ) this.setPhase('race');
    if (this.phase === 'race') {
      const lead = this.standings()[0];
      if (lead && lead.id !== this.leaderId) {
        this.leaderId = lead.id;
        this.events.emit('leader', { car: lead });
      }
      const active = this.cars.filter((c) => !c.race.out);
      const allDone = active.length > 0 && active.every((c) => c.race.finished);
      const timeUp = this.tick - this.raceStartTick >= this.config.timeLimit * STEP_HZ;
      const graceUp = this.firstFinishTick >= 0 && this.tick - this.firstFinishTick >= this.config.grace * STEP_HZ;
      if (allDone || timeUp || graceUp || active.length === 0) this.setPhase('finished');
    }
  }

  results(): RaceResult[] {
    return this.standings().map((c, i) => ({
      id: c.id,
      name: c.name,
      playerId: c.playerId,
      place: i + 1,
      finished: c.race.finished,
      time: c.race.finished ? (c.race.finishTick - this.raceStartTick) * STEP : null,
      laps: c.race.lap,
      out: c.race.out,
    }));
  }

  dispose(): void {
    this.combat.dispose();
    this.events.clear();
    this.eventQueue.free();
    this.world.free();
  }
}
