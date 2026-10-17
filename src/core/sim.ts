import type RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { AiPilot, rollTraits, type Character, type Hazard, type Neighbor } from '../ai/pilot';
import { computeRacingLine } from '../ai/racingLine';
import { buildSpeedProfile } from '../ai/speedProfile';
import { Combat } from '../combat/combat';
import { buildTrackColliders, floorHeight, type TrackColliders } from '../physics/trackCollider';
import { PhysVehicle, type Controls } from '../physics/vehicle';
import { RAPIER as R, createWorld, initPhysics } from '../physics/world';
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
}

export interface RaceConfig {
  seed: number;
  track: TrackDef;
  laps: number;
  /** Лимит времени гонки, с (после — побеждает лидер). */
  timeLimit: number;
  /** Сколько ждать остальных после первого финиша, с. */
  grace: number;
  /** Длительность отсчёта 3-2-1, с. */
  countdown: number;
}

export const DEFAULT_RACE: Omit<RaceConfig, 'seed' | 'track'> = { laps: 3, timeLimit: 240, grace: 30, countdown: 3 };

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
    };
    const pr = this.track.path.project(t.x, t.y, t.z);
    car.s = pr.s;
    car.d = pr.d;
    car.hint = pr.index;
    car.race.progress = this.tracker.progressOf(car.race, car.s);
    this.cars.push(car);
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
      if (racing && this.running) {
        const sf = SURFACES[this.track.surfaceAt(car.s, car.d)];
        ph.gripMul = sf.grip;
        ph.rollingDrag = sf.drag;
        this.combat.applyModifiers(car);
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
      if (car.ghostUntil > 0 && this.tick >= car.ghostUntil) {
        car.ghostUntil = 0;
        ph.setGhost(false);
      }
      ph.update(STEP, car.controls);
    }
    this.world.step(this.eventQueue);
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      for (const car of this.cars) if (car.phys.collider.handle === h1 || car.phys.collider.handle === h2) car.hits++;
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
    if (racing) this.combat.postStep();
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
