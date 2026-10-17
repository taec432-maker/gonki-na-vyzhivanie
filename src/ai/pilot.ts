import type { Rng } from '../core/rng';
import type { Controls } from '../physics/vehicle';
import type { Track } from '../tracks/track';
import { followLine, type DriverInput } from './driver';

/** «Характер» ИИ-пилота (раздел 6 ТЗ). */
export type Character = 'aggressive' | 'cautious' | 'steady';

export interface PilotTraits {
  character: Character;
  /** Доля от допустимой скорости в поворотах (мастерство). */
  pace: number;
  /** Постоянное смещение от гоночной линии, м. */
  bias: number;
  /** Желание обгонять: 0..1. */
  overtake: number;
  /** Вероятность заметить препятствие и объехать (масло, мины). */
  awareness: number;
  /** Склонность таранить соперника. */
  ram: number;
}

export function rollTraits(rng: Rng, character?: Character): PilotTraits {
  const ch: Character = character ?? rng.pick<Character>(['aggressive', 'cautious', 'steady', 'steady']);
  const base: Record<Character, Omit<PilotTraits, 'character' | 'bias'>> = {
    aggressive: { pace: 1.0, overtake: 0.9, awareness: 0.55, ram: 0.6 },
    cautious: { pace: 0.92, overtake: 0.35, awareness: 0.9, ram: 0 },
    steady: { pace: 0.96, overtake: 0.6, awareness: 0.75, ram: 0.1 },
  };
  const b = base[ch];
  return {
    character: ch,
    pace: b.pace * rng.range(0.96, 1.03),
    bias: rng.range(-1.6, 1.6),
    overtake: b.overtake,
    awareness: b.awareness,
    ram: b.ram,
  };
}

/** Что пилот знает о соседе. */
export interface Neighbor {
  id: number;
  s: number;
  d: number;
  speed: number;
  /** Не участвует в столкновениях (призрак, респаун). */
  ghost: boolean;
}

/** Препятствие на трассе (масло, мина) — для уклонения. */
export interface Hazard {
  s: number;
  d: number;
  radius: number;
  id: number;
}

/**
 * ИИ-пилот: едет по гоночной линии со своим смещением, обгоняет,
 * объезжает препятствия, выбирается из завалов (анти-застревание).
 */
export class AiPilot {
  readonly traits: PilotTraits;
  /** Текущее целевое смещение для обгона (м) и до какого шага держать. */
  private passOffset = 0;
  private passUntil = 0;
  private dodgeOffset = 0;
  private dodgeUntil = 0;
  /** Решения по препятствиям (заметил / не заметил) — один бросок на препятствие. */
  private readonly hazardSeen = new Map<number, boolean>();
  /** Анти-застревание. */
  private stuckTicks = 0;
  private reverseUntil = 0;
  /** Лучший прогресс и когда он был достигнут. */
  private lastProgress = -Infinity;
  private progressCheckTick = 0;
  /** Целевая жертва тарана и до какого шага охотимся. */
  ramTarget: number | null = null;
  ramUntil = 0;
  private readonly rng: Rng;
  readonly out: Controls = { throttle: 0, brake: 0, steer: 0 };

  constructor(traits: PilotTraits, rng: Rng) {
    this.traits = traits;
    this.rng = rng;
  }

  /**
   * Один шаг решения.
   * @returns 'respawn', если машина застряла и её надо мягко вернуть на трассу.
   */
  drive(
    tick: number,
    track: Track,
    me: DriverInput & { progress: number; flipped: boolean },
    line: Float32Array,
    speedAt: (s: number) => number,
    neighbors: readonly Neighbor[],
    hazards: readonly Hazard[],
  ): 'respawn' | null {
    const path = track.path;
    const half = path.widthAt(me.s) / 2;

    // --- Анти-застревание: 3 с без продвижения на 5 м → респаун; с 1,5 с — попытка сдать назад.
    if (me.progress > this.lastProgress + 5) {
      this.lastProgress = me.progress;
      this.progressCheckTick = tick;
    }
    this.stuckTicks = tick - this.progressCheckTick;
    if (me.flipped) this.progressCheckTick -= 1;
    if (this.stuckTicks >= 180) {
      this.stuckTicks = 0;
      this.reverseUntil = 0;
      return 'respawn';
    }
    if (this.stuckTicks >= 90 && this.reverseUntil < tick && !me.flipped) this.reverseUntil = tick + 70;
    if (tick < this.reverseUntil) {
      // Сдаём назад, выкручивая руль от стены.
      this.out.throttle = -0.8;
      this.out.brake = 0;
      this.out.steer = me.d > 0 ? 0.8 : -0.8;
      return null;
    }

    // --- Кто мешает впереди на моей линии.
    const myLine = (s: number): number => (line[path.indexAt(s)] as number) + this.traits.bias * 0.6;
    const plannedAt = (s: number): number => (tick < this.passUntil ? this.passOffset : myLine(s));
    let blocker: Neighbor | null = null;
    let blockDist = Infinity;
    for (const n of neighbors) {
      if (n.ghost) continue;
      const ds = path.deltaS(me.s, n.s);
      if (ds <= 1 || ds > 34) continue;
      if (Math.abs(n.d - plannedAt(n.s)) > 2.5 && Math.abs(n.d - me.d) > 2.5) continue;
      if (ds < blockDist) {
        blockDist = ds;
        blocker = n;
      }
    }
    // Полоса свободна, если рядом (от 9 м сзади до 26 м впереди) никого на этом смещении.
    const laneFree = (d: number): boolean =>
      Math.abs(d) < half - 1.5 &&
      !neighbors.some((n) => {
        if (n.ghost) return false;
        const ds = path.deltaS(me.s, n.s);
        return ds > -9 && ds < 26 && Math.abs(n.d - d) < 2.3;
      });
    // --- Обгон: впереди медленнее — уходим на свободную полосу.
    if (
      blocker &&
      blocker.speed < me.speed + 1 &&
      tick >= this.passUntil &&
      this.rng.chance(0.06 + this.traits.overtake * 0.2)
    ) {
      const left = blocker.d - 3.3;
      const right = blocker.d + 3.3;
      const lf = laneFree(left);
      const rf = laneFree(right);
      if (lf || rf) {
        const preferRight = Math.abs(right - me.d) < Math.abs(left - me.d);
        this.passOffset = rf && (preferRight || !lf) ? right : left;
        this.passUntil = tick + 150;
      }
    }
    // Если полоса обгона закрылась — отменить манёвр.
    if (tick < this.passUntil && !laneFree(this.passOffset) && Math.abs(me.d - this.passOffset) > 1) this.passUntil = 0;

    // --- Не тереться бортами: соседа сбоку «отталкиваем» смещением цели.
    let sideShift = 0;
    for (const n of neighbors) {
      if (n.ghost) continue;
      const ds = path.deltaS(me.s, n.s);
      if (Math.abs(ds) > 8) continue;
      const dd = me.d - n.d;
      if (Math.abs(dd) > 3.6) continue;
      // Перекрытие по длине (машины ~4.5 м) важнее, чем просто близость.
      const wl = Math.abs(ds) < 5 ? 1 : 1 - (Math.abs(ds) - 5) / 3;
      const wd = 1 - Math.abs(dd) / 3.6;
      const dir = Math.abs(dd) > 0.05 ? Math.sign(dd) : n.id > 0 && me.d < 0 ? -1 : 1;
      sideShift += dir * wl * wd * 4;
    }
    sideShift = Math.max(-3, Math.min(3, sideShift));

    // --- Таран (агрессивные): прицелиться в соседа впереди.
    let ramD: number | null = null;
    if (this.ramTarget !== null && tick > this.ramUntil) this.ramTarget = null;
    if (this.ramTarget !== null) {
      const t = neighbors.find((n) => n.id === this.ramTarget);
      const ds = t ? path.deltaS(me.s, t.s) : 99;
      if (t && ds > 0 && ds < 30) ramD = t.d;
      else this.ramTarget = null;
    }

    // --- Уклонение от препятствий (с вероятностью — «не идеально»).
    for (const h of hazards) {
      const ds = path.deltaS(me.s, h.s);
      if (ds < 4 || ds > 40) continue;
      let seen = this.hazardSeen.get(h.id);
      if (seen === undefined) {
        seen = this.rng.chance(this.traits.awareness);
        this.hazardSeen.set(h.id, seen);
        if (this.hazardSeen.size > 64) this.hazardSeen.delete(this.hazardSeen.keys().next().value as number);
      }
      if (!seen) continue;
      const plannedD = tick < this.dodgeUntil ? this.dodgeOffset : myLine(h.s);
      if (Math.abs(plannedD - h.d) < h.radius + 1.6) {
        const side = h.d > 0 ? -1 : 1;
        this.dodgeOffset = Math.max(-half + 1.4, Math.min(half - 1.4, h.d + side * (h.radius + 2.2)));
        this.dodgeUntil = tick + 90;
      }
    }

    const lim = half - 1.3;
    const offsetAt = (s: number): number => {
      let base: number;
      if (tick < this.dodgeUntil) base = this.dodgeOffset;
      else if (ramD !== null) base = ramD;
      else base = plannedAt(s);
      return Math.max(-lim, Math.min(lim, base + sideShift));
    };
    followLine(path, me, offsetAt, speedAt, this.out, this.traits.pace);

    // Не въезжать в зад: тормозим, если не успеваем по дистанции до впереди идущего.
    if (blocker && ramD === null && me.speed > blocker.speed) {
      const gap = Math.max(0.5, blockDist - 6.5);
      const closing = me.speed - blocker.speed;
      const need = (closing * closing) / (2 * gap);
      if (need > 2) {
        this.out.throttle = 0;
        this.out.brake = Math.max(this.out.brake, Math.min(blockDist < 8 ? 1 : 0.6, need / 9));
      } else if (blockDist < 8) {
        this.out.throttle = Math.min(this.out.throttle, 0.3);
      }
    }
    return null;
  }

  /**
   * Агрессивный пилот иногда выбирает жертву впереди (4–25 м) и идёт на таран 3 с (раздел 6 ТЗ).
   * Вызывается симуляцией раз в 3 с.
   */
  considerRam(tick: number, meS: number, track: Track, neighbors: readonly Neighbor[]): void {
    if (this.traits.ram <= 0 || this.ramTarget !== null) return;
    if (!this.rng.chance(this.traits.ram)) return;
    let best: Neighbor | null = null;
    let bestDs = Infinity;
    for (const n of neighbors) {
      if (n.ghost) continue;
      const ds = track.path.deltaS(meS, n.s);
      if (ds > 4 && ds < 25 && ds < bestDs) {
        bestDs = ds;
        best = n;
      }
    }
    if (best) {
      this.ramTarget = best.id;
      this.ramUntil = tick + 180;
    }
  }

  /** Сброс после респауна. */
  resetStuck(tick: number, progress: number): void {
    this.stuckTicks = 0;
    this.reverseUntil = 0;
    this.lastProgress = progress;
    this.progressCheckTick = tick;
    this.passUntil = 0;
    this.dodgeUntil = 0;
  }
}
