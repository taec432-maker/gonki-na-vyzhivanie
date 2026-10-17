import { Vector3 } from 'three';
import { EventBus } from '../core/events';
import { STEP, STEP_HZ } from '../core/loop';
import type { Rng } from '../core/rng';
import type { SimCar, Simulation } from '../core/sim';
import { EFFECTS, type EffectId, type StatusId } from './effects';

/**
 * Боевая система (разделы 6–7 ТЗ): эффекты подарков на машинах, снаряды, ловушки на трассе.
 * Детерминированна: случайность — из потока sim.rng, время — номер шага.
 */
export interface ActiveEffect {
  id: StatusId;
  /** До какого шага действует. */
  until: number;
  power: number;
  /** Кто наложил (для «соперники глохнут» и т. п.). */
  sourceId: number;
}

export interface Projectile {
  id: number;
  kind: 'rocket' | 'meteor';
  ownerId: number;
  targetId: number | null;
  pos: Vector3;
  prev: Vector3;
  vel: Vector3;
  /** Шагов до самоподрыва. */
  life: number;
  damage: number;
}

export interface TrapHazard {
  id: number;
  kind: 'oil' | 'mine';
  ownerId: number;
  pos: Vector3;
  s: number;
  d: number;
  radius: number;
  /** Шаг, до которого действует (масло) или Infinity (мина до срабатывания). */
  until: number;
  /** До этого шага владелец неуязвим к своей ловушке. */
  ownerSafeUntil: number;
  damage: number;
}

export interface EffectMeta {
  /** Кто подарил (для ленты). */
  from?: string;
  giftName?: string;
  /** Источник: подарок, лайки, панель. */
  via?: 'gift' | 'likes' | 'panel' | 'ai';
}

export interface CombatEvents {
  applied: { car: SimCar; effect: EffectId; power: number; meta: EffectMeta };
  'rocket-fired': { projectile: Projectile; owner: SimCar };
  impact: { pos: Vector3; kind: 'rocket' | 'meteor' | 'mine'; targetId: number | null };
  'oil-spill': { hazard: TrapHazard };
  'oil-hit': { car: SimCar };
  damage: { car: SimCar; amount: number; cause: string; byId: number | null };
}

interface Pending {
  carId: number;
  effect: EffectId;
  power: number;
  meta: EffectMeta;
}

/** Максимум длительности одного эффекта при стаке (с). */
const STACK_CAP = 40;
/** Сколько эффектов активируется за шаг — 20 подарков в секунду не ломают физику. */
const PER_STEP = 3;

export class Combat {
  readonly sim: Simulation;
  readonly events = new EventBus<CombatEvents>();
  readonly active = new Map<number, ActiveEffect[]>();
  readonly projectiles: Projectile[] = [];
  readonly traps: TrapHazard[] = [];
  readonly queue: Pending[] = [];
  private readonly rng: Rng;
  private nextId = 1;
  /** Обработчики эффектов (этап 4 добавляет остальные). */
  private readonly handlers = new Map<EffectId, (car: SimCar, power: number, meta: EffectMeta) => void>();

  constructor(sim: Simulation, rng: Rng) {
    this.sim = sim;
    this.rng = rng;
    this.registerBasics();
  }

  on(effect: EffectId, fn: (car: SimCar, power: number, meta: EffectMeta) => void): void {
    this.handlers.set(effect, fn);
  }

  /** Поставить эффект в очередь (подарок, лайки, панель). */
  enqueue(carId: number, effect: EffectId, power = 1, meta: EffectMeta = {}): void {
    this.queue.push({ carId, effect, power, meta });
    // Защита от лавины: не больше 400 ожидающих.
    if (this.queue.length > 400) this.queue.splice(0, this.queue.length - 400);
  }

  effects(car: SimCar): ActiveEffect[] {
    return this.active.get(car.id) ?? [];
  }

  has(car: SimCar, id: StatusId): boolean {
    const t = this.sim.tick;
    return this.effects(car).some((e) => e.id === id && e.until > t);
  }

  remaining(car: SimCar, id: StatusId): number {
    const e = this.effects(car).find((x) => x.id === id);
    return e ? Math.max(0, (e.until - this.sim.tick) * STEP) : 0;
  }

  /** Добавить/продлить эффект: одного типа стакаются по времени, не по силе. */
  addTimed(car: SimCar, id: StatusId, seconds: number, power: number, sourceId: number): ActiveEffect {
    const list = this.active.get(car.id) ?? [];
    this.active.set(car.id, list);
    const now = this.sim.tick;
    let e = list.find((x) => x.id === id && x.until > now);
    const add = Math.round(seconds * STEP_HZ);
    if (e) {
      e.until = Math.min(now + STACK_CAP * STEP_HZ, e.until + add);
      e.power = Math.max(e.power, power);
    } else {
      e = { id, until: now + add, power, sourceId };
      list.push(e);
    }
    return e;
  }

  clear(car: SimCar, id: StatusId): void {
    const list = this.active.get(car.id);
    if (list)
      this.active.set(
        car.id,
        list.filter((e) => e.id !== id),
      );
  }

  /** Неуязвим ли (щит, монстр, призрак-респаун не считается). */
  invulnerable(car: SimCar): boolean {
    return this.has(car, 'shield') || this.has(car, 'monster');
  }

  /** Нанести урон (этап 4 считает HP; щит и монстр защищают). */
  damage(car: SimCar, amount: number, cause: string, byId: number | null = null): number {
    if (amount <= 0 || car.race.out || car.race.finished) return 0;
    if (this.invulnerable(car)) return 0;
    const a = Math.min(car.hp, amount);
    car.hp -= a;
    this.events.emit('damage', { car, amount: a, cause, byId });
    return a;
  }

  private registerBasics(): void {
    this.on('nitro', (car, power) => this.addTimed(car, 'nitro', EFFECTS.nitro.duration * power, power, car.id));
    this.on('shield', (car, power) => this.addTimed(car, 'shield', EFFECTS.shield.duration * power, power, car.id));
    this.on('repair', (car, power) => {
      car.hp = Math.min(car.maxHp, car.hp + 40 * power);
    });
    this.on('repairOrOil', (car, power, meta) => {
      const fn = car.hp < car.maxHp * 0.7 ? this.handlers.get('repair') : this.handlers.get('oil');
      fn?.(car, power, meta);
    });
    this.on('oil', (car, power) => this.spillOil(car, power));
    this.on('rocket', (car, power) => {
      const n = Math.max(1, Math.round(power));
      for (let i = 0; i < n; i++) this.fireRocket(car, i * 0.6);
    });
  }

  /** Самый близкий соперник впереди по прогрессу (в пределах 250 м). */
  targetAhead(car: SimCar, maxAhead = 250): SimCar | null {
    let best: SimCar | null = null;
    let bestGap = Infinity;
    for (const o of this.sim.cars) {
      if (o === car || o.race.out || o.race.finished) continue;
      const gap = o.race.progress - car.race.progress;
      if (gap > 0 && gap < maxAhead && gap < bestGap) {
        bestGap = gap;
        best = o;
      }
    }
    return best;
  }

  fireRocket(car: SimCar, side = 0): Projectile {
    const fwd = car.phys.forward(new Vector3());
    const pos = car.cur.p.clone().addScaledVector(fwd, car.spec.dims.length / 2 + 1.2);
    pos.y += 0.9;
    const right = new Vector3(-fwd.z, 0, fwd.x);
    pos.addScaledVector(right, side);
    const speed = Math.max(55, car.phys.forwardSpeed() + 40);
    const target = this.targetAhead(car);
    const p: Projectile = {
      id: this.nextId++,
      kind: 'rocket',
      ownerId: car.id,
      targetId: target?.id ?? null,
      pos,
      prev: pos.clone(),
      vel: fwd.clone().multiplyScalar(speed),
      life: Math.round(4 * STEP_HZ),
      damage: 25,
    };
    this.projectiles.push(p);
    this.events.emit('rocket-fired', { projectile: p, owner: car });
    return p;
  }

  spillOil(car: SimCar, power = 1): TrapHazard {
    const fwd = car.phys.forward(new Vector3());
    const pos = car.cur.p.clone().addScaledVector(fwd, -(car.spec.dims.length / 2 + 3.5));
    const pr = this.sim.track.path.project(pos.x, pos.y, pos.z, car.hint);
    pos.y = this.sim.track.path.pointAt(pr.s, pr.d).y;
    const h: TrapHazard = {
      id: this.nextId++,
      kind: 'oil',
      ownerId: car.id,
      pos,
      s: pr.s,
      d: pr.d,
      radius: 3.2 * Math.sqrt(power),
      until: this.sim.tick + Math.round(EFFECTS.oil.duration * STEP_HZ),
      ownerSafeUntil: this.sim.tick + 3 * STEP_HZ,
      damage: 0,
    };
    this.traps.push(h);
    this.events.emit('oil-spill', { hazard: h });
    return h;
  }

  /** До шага физики: активировать эффекты из очереди (не больше PER_STEP за шаг). */
  activateQueue(): void {
    const now = this.sim.tick;
    for (let i = 0; i < PER_STEP && this.queue.length > 0; i++) {
      const p = this.queue.shift() as Pending;
      const car = this.sim.carById(p.carId);
      if (!car) continue;
      // Выбывший может только воскреснуть.
      if (car.race.out && p.effect !== 'revive') continue;
      const fn = this.handlers.get(p.effect);
      if (!fn) continue;
      fn(car, p.power, p.meta);
      this.events.emit('applied', { car, effect: p.effect, power: p.power, meta: p.meta });
    }
    for (const [id, list] of this.active)
      if (list.some((e) => e.until <= now))
        this.active.set(
          id,
          list.filter((e) => e.until > now),
        );
  }

  /** Множители физики от активных эффектов (поверх покрытия — gripMul уже выставлен симуляцией). */
  applyModifiers(car: SimCar): void {
    const ph = car.phys;
    ph.powerMul = 1;
    ph.maxSpeedMul = 1;
    ph.stability = 5;
    ph.stalled = false;
    if (this.has(car, 'nitro')) {
      ph.powerMul *= 1.4;
      ph.maxSpeedMul *= 1.15;
    }
    if (this.has(car, 'oiled')) {
      ph.gripMul *= 0.32;
      ph.stability = 0.6;
    }
    this.modifierHook?.(car);
  }

  /** Этап 4: дополнительные множители (ЭМИ, гвозди, монстр…). */
  modifierHook: ((car: SimCar) => void) | null = null;

  /** После шага физики: снаряды, ловушки, истечение. */
  postStep(): void {
    const now = this.sim.tick;
    // --- Снаряды.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i] as Projectile;
      p.prev.copy(p.pos);
      p.life--;
      if (p.kind === 'rocket') {
        const target = p.targetId !== null ? this.sim.carById(p.targetId) : undefined;
        if (target && !target.race.out) {
          // Самонаведение: поворот вектора скорости к цели, не больше 3,5 рад/с.
          const want = target.cur.p
            .clone()
            .add(new Vector3(0, 0.6, 0))
            .sub(p.pos)
            .normalize();
          const speed = p.vel.length();
          const cur = p.vel.clone().normalize();
          const ang = cur.angleTo(want);
          const maxTurn = 3.5 * STEP;
          const k = ang > 1e-4 ? Math.min(1, maxTurn / ang) : 1;
          cur.lerp(want, k).normalize();
          p.vel.copy(cur.multiplyScalar(Math.min(95, speed + 30 * STEP)));
        }
      } else {
        p.vel.y -= 9.81 * STEP;
      }
      p.pos.addScaledVector(p.vel, STEP);
      let hit: SimCar | null = null;
      for (const c of this.sim.cars) {
        if (c.id === p.ownerId && p.kind === 'rocket') continue;
        if (c.race.out) continue;
        const r = (p.kind === 'meteor' ? 4.5 : 2.4) * c.phys.scale;
        if (c.cur.p.distanceToSquared(p.pos) < r * r) {
          hit = c;
          break;
        }
      }
      const groundY = this.sim.track.path.pointAt(this.sim.track.path.project(p.pos.x, p.pos.y, p.pos.z).s, 0).y;
      const ground = p.pos.y < groundY - 0.2;
      if (hit || p.life <= 0 || ground) {
        this.explode(p, hit);
        this.projectiles.splice(i, 1);
      }
    }
    // --- Ловушки.
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const h = this.traps[i] as TrapHazard;
      if (h.until <= now) {
        this.traps.splice(i, 1);
        continue;
      }
      for (const c of this.sim.cars) {
        if (c.race.out) continue;
        if (c.id === h.ownerId && now < h.ownerSafeUntil) continue;
        const dx = c.cur.p.x - h.pos.x;
        const dz = c.cur.p.z - h.pos.z;
        if (dx * dx + dz * dz > h.radius * h.radius) continue;
        if (h.kind === 'oil') {
          if (!this.has(c, 'oiled') && !this.has(c, 'monster')) {
            this.addTimed(c, 'oiled', 1.5, 1, h.ownerId);
            // Толчок вбок — машину ведёт.
            const side = this.rng.chance(0.5) ? 1 : -1;
            const m = c.spec.mass;
            c.phys.body.applyTorqueImpulse({ x: 0, y: side * m * 1.6, z: 0 }, true);
            this.events.emit('oil-hit', { car: c });
          }
        } else if (h.kind === 'mine') {
          this.mineHook?.(h, c);
          this.traps.splice(i, 1);
          break;
        }
      }
    }
    // Ловушки — ИИ видит их как препятствия.
    this.sim.hazards.length = 0;
    for (const h of this.traps) this.sim.hazards.push({ id: h.id, s: h.s, d: h.d, radius: h.radius });
  }

  /** Этап 4: срабатывание мины. */
  mineHook: ((h: TrapHazard, car: SimCar) => void) | null = null;

  private explode(p: Projectile, hit: SimCar | null): void {
    this.events.emit('impact', { pos: p.pos.clone(), kind: p.kind, targetId: hit?.id ?? null });
    const radius = p.kind === 'meteor' ? 7 : 4;
    for (const c of this.sim.cars) {
      if (c.race.out) continue;
      const dist = c.cur.p.distanceTo(p.pos);
      if (dist > radius) continue;
      if (p.kind === 'rocket' && c.id === p.ownerId) continue;
      const k = 1 - dist / radius;
      // Толчок: вверх и от центра взрыва.
      const dir = c.cur.p.clone().sub(p.pos).setY(0).normalize();
      const m = c.spec.mass;
      if (!this.has(c, 'shield') && !this.has(c, 'monster')) {
        c.phys.body.applyImpulse({ x: dir.x * m * 4 * k, y: m * 5.5 * k, z: dir.z * m * 4 * k }, true);
        c.phys.body.applyTorqueImpulse(
          {
            x: this.rng.range(-1, 1) * m * 0.8 * k,
            y: this.rng.range(-1, 1) * m * 1.2 * k,
            z: this.rng.range(-1, 1) * m * 0.8 * k,
          },
          true,
        );
      }
      const dmg = c === hit ? p.damage : p.damage * 0.5 * k;
      this.damage(c, dmg, p.kind, p.ownerId);
    }
  }

  /** Убрать все следы машины (выбыла / удалена). */
  forget(carId: number): void {
    this.active.delete(carId);
    for (let i = this.queue.length - 1; i >= 0; i--)
      if ((this.queue[i] as Pending).carId === carId) this.queue.splice(i, 1);
  }

  dispose(): void {
    this.events.clear();
    this.active.clear();
    this.projectiles.length = 0;
    this.traps.length = 0;
    this.queue.length = 0;
  }
}
