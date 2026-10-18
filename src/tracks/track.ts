import type { Vector3 } from 'three';
import { Rng, hashString } from '../core/rng';
import { TrackPath, type ControlPoint } from './spline';
import { SURFACES, type SurfaceType, type TrackDef } from './types';

export interface Gate {
  index: number;
  s: number;
  /** Концы линии ворот в плоскости XZ. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  center: Vector3;
  heading: number;
}

export interface GridSlot {
  pos: Vector3;
  heading: number;
  s: number;
}

/** Курс (рад) из направления: 0 — по −Z, π/2 — по +X. */
export function headingOf(dir: { x: number; z: number }): number {
  return Math.atan2(dir.x, -dir.z);
}

/** Шорткат в метрах трассы. */
export interface Shortcut {
  index: number;
  fromS: number;
  toS: number;
  side: 1 | -1;
  offset: number;
  width: number;
  surface: SurfaceType;
  chance: number;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Track {
  readonly def: TrackDef;
  readonly path: TrackPath;
  readonly gates: Gate[];
  readonly startS: number;
  readonly rng: Rng;
  readonly shortcuts: Shortcut[];

  constructor(def: TrackDef) {
    this.def = def;
    this.rng = new Rng(hashString(def.id));
    const pts: ControlPoint[] = def.points.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : p));
    this.path = new TrackPath(pts, def.width, 1);
    this.startS = this.path.wrapS(def.startAt * this.path.length);
    this.shortcuts = (def.shortcuts ?? []).map((sc, index) => ({
      index,
      fromS: this.sFromFrac(sc.from),
      toS: this.sFromFrac(sc.to),
      side: sc.side,
      offset: sc.offset,
      width: sc.width,
      surface: sc.surface ?? 'dirt',
      chance: sc.chance ?? 0.4,
    }));
    const cps = def.checkpoints;
    // Равномерные ворота сдвигаются на самый прямой участок рядом (±3 % круга): на остром
    // повороте машины срезают угол и линию ворот не пересекают. Старт (0) — на месте.
    const straightest = (f: number): number => {
      let best = f;
      let bestK = Infinity;
      for (let k = -30; k <= 30; k++) {
        const g = f + k * 0.001;
        const curv = Math.abs(this.path.curvatureAt(this.sFromFrac(g)));
        if (curv < bestK - 1e-4) {
          bestK = curv;
          best = g;
        }
      }
      return best;
    };
    const fractions =
      typeof cps === 'number'
        ? Array.from({ length: cps }, (_, i) => (i === 0 ? 0 : straightest(i / cps)))
        : [0, ...cps.filter((f) => f > 0 && f < 1)];
    this.gates = fractions.map((f, index) => this.makeGate(index, this.path.wrapS(this.startS + f * this.path.length)));
  }

  get length(): number {
    return this.path.length;
  }

  /** Полуширина проезжей части + обочины. */
  halfDrivable(s: number): number {
    return this.path.widthAt(s) / 2 + this.def.shoulder.width;
  }

  /** Расстояние от центра до стены (без знака). */
  wallOffset(s: number): number {
    return this.path.widthAt(s) / 2 + this.def.shoulder.width + this.def.walls.offset;
  }

  /** Доля пройденного шортката 0..1 в точке s или null вне его. */
  shortcutU(sc: Shortcut, s: number): number | null {
    const len = this.path.deltaS(sc.fromS, sc.toS);
    const u = this.path.deltaS(sc.fromS, s);
    return u < 0 || u > len ? null : u / len;
  }

  /** Центр объезда в точке s (со знаком стороны) или null, если s вне шортката. */
  shortcutD(sc: Shortcut, s: number): number | null {
    const len = this.path.deltaS(sc.fromS, sc.toS);
    const u = this.path.deltaS(sc.fromS, s);
    if (u < 0 || u > len) return null;
    const t = u / len;
    return sc.side * sc.offset * smooth(0, 0.36, t) * (1 - smooth(0.64, 1, t));
  }

  /** Объезд в точке (s, d), если машина на нём. */
  shortcutAt(s: number, d: number): Shortcut | null {
    for (const sc of this.shortcuts) {
      const dc = this.shortcutD(sc, s);
      if (dc !== null && Math.abs(d - dc) < sc.width / 2 && Math.abs(dc) > this.path.widthAt(s) / 2) return sc;
    }
    return null;
  }

  private makeGate(index: number, s: number): Gate {
    let half = this.path.widthAt(s) / 2 + this.def.shoulder.width + this.def.walls.offset + 2;
    // Ворота на участке шортката — шире, чтобы засчитать и объезд.
    for (const sc of this.shortcuts) {
      const dc = this.shortcutD(sc, s);
      if (dc !== null) half = Math.max(half, Math.abs(dc) + sc.width / 2 + 2);
    }
    const a = this.path.pointAt(s, -half);
    const b = this.path.pointAt(s, half);
    return {
      index,
      s,
      ax: a.x,
      az: a.z,
      bx: b.x,
      bz: b.z,
      center: this.path.pointAt(s, 0),
      heading: headingOf(this.path.tangentAt(s)),
    };
  }

  /** Доля круга (0..1) от линии старта до прогресса s. */
  fracFromStart(s: number): number {
    return this.path.wrapS(s - this.startS) / this.path.length;
  }

  /** Прогресс s для доли круга от старта. */
  sFromFrac(f: number): number {
    return this.path.wrapS(this.startS + f * this.path.length);
  }

  inSpan(frac: number, from: number, to: number): boolean {
    return from <= to ? frac >= from && frac < to : frac >= from || frac < to;
  }

  /** Покрытие в точке (s, d): дорога, зоны, обочина. */
  surfaceAt(s: number, d: number): SurfaceType {
    const half = this.path.widthAt(s) / 2;
    if (Math.abs(d) > half + 0.25) return this.shortcutAt(s, d)?.surface ?? this.def.shoulder.surface;
    const frac = this.fracFromStart(s);
    for (const z of this.def.zones ?? []) if (this.inSpan(frac, z.from, z.to)) return z.surface;
    return this.def.surface;
  }

  gripAt(s: number, d: number): number {
    return SURFACES[this.surfaceAt(s, d)].grip;
  }

  /**
   * Стартовая решётка: по два в ряд, шахматкой, за линией старта.
   * Первое место — справа впереди.
   */
  gridSlots(count: number): GridSlot[] {
    const slots: GridSlot[] = [];
    const lane = Math.min(this.def.width / 4, 3.4);
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2 === 0 ? 1 : -1;
      const s = this.path.wrapS(this.startS - 6 - row * 8 - (i % 2) * 3);
      const pos = this.path.pointAt(s, col * lane);
      slots.push({ pos, heading: headingOf(this.path.tangentAt(s)), s });
    }
    return slots;
  }
}

/** Пересекает ли отрезок движения (p→q) линию ворот. */
export function crossesGate(g: Gate, px: number, pz: number, qx: number, qz: number): boolean {
  const d = (g.bx - g.ax) * (qz - pz) - (g.bz - g.az) * (qx - px);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((px - g.ax) * (qz - pz) - (pz - g.az) * (qx - px)) / d;
  const u = ((px - g.ax) * (g.bz - g.az) - (pz - g.az) * (g.bx - g.ax)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
