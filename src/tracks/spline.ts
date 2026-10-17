import { Vector3 } from 'three';

/**
 * Центральная линия трассы: замкнутый центростремительный сплайн Catmull-Rom
 * через контрольные точки, пересэмплированный с равным шагом по длине дуги.
 * Все запросы «где я на трассе» (прогресс s, боковое смещение d) идут сюда.
 */
export interface PathSample {
  s: number;
  pos: Vector3;
  /** Единичный касательный вектор (направление движения). */
  tan: Vector3;
  /** Единичный горизонтальный вектор вправо от направления движения. */
  right: Vector3;
  /** Кривизна со знаком (1/м), + — поворот вправо. */
  curvature: number;
  width: number;
  bank: number;
}

export interface ControlPoint {
  x: number;
  y: number;
  z: number;
  /** Ширина дороги в этой точке (м), если отличается от общей. */
  w?: number;
  /** Крен (радианы), + — правый край ниже. */
  bank?: number;
}

export interface Projection {
  /** Прогресс вдоль линии, 0..length. */
  s: number;
  /** Боковое смещение от центра, + — вправо. */
  d: number;
  /** Индекс ближайшего сэмпла (подсказка для следующего поиска). */
  index: number;
  /** Высота центральной линии в этой точке. */
  y: number;
}

function catmullRom(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number, out: Vector3): Vector3 {
  // Центростремительная параметризация (alpha = 0.5) — без петель и «перехлёстов».
  const alpha = 0.5;
  const t0 = 0;
  const t1 = t0 + Math.pow(p0.distanceTo(p1), alpha) + 1e-6;
  const t2 = t1 + Math.pow(p1.distanceTo(p2), alpha) + 1e-6;
  const t3 = t2 + Math.pow(p2.distanceTo(p3), alpha) + 1e-6;
  const tt = t1 + (t2 - t1) * t;
  const a1 = p0
    .clone()
    .multiplyScalar((t1 - tt) / (t1 - t0))
    .add(p1.clone().multiplyScalar((tt - t0) / (t1 - t0)));
  const a2 = p1
    .clone()
    .multiplyScalar((t2 - tt) / (t2 - t1))
    .add(p2.clone().multiplyScalar((tt - t1) / (t2 - t1)));
  const a3 = p2
    .clone()
    .multiplyScalar((t3 - tt) / (t3 - t2))
    .add(p3.clone().multiplyScalar((tt - t2) / (t3 - t2)));
  const b1 = a1.multiplyScalar((t2 - tt) / (t2 - t0)).add(a2.clone().multiplyScalar((tt - t0) / (t2 - t0)));
  const b2 = a2.multiplyScalar((t3 - tt) / (t3 - t1)).add(a3.multiplyScalar((tt - t1) / (t3 - t1)));
  return out.copy(b1.multiplyScalar((t2 - tt) / (t2 - t1)).add(b2.multiplyScalar((tt - t1) / (t2 - t1))));
}

export class TrackPath {
  readonly samples: PathSample[];
  readonly length: number;
  readonly step: number;

  constructor(points: readonly ControlPoint[], defaultWidth: number, step = 1) {
    if (points.length < 4) throw new Error('Трассе нужно минимум 4 контрольные точки');
    const n = points.length;
    const vp = points.map((p) => new Vector3(p.x, p.y, p.z));
    // 1) Плотная выборка сплайна.
    const dense: { pos: Vector3; w: number; bank: number }[] = [];
    const perSeg = 64;
    for (let i = 0; i < n; i++) {
      const p0 = vp[(i - 1 + n) % n] as Vector3;
      const p1 = vp[i] as Vector3;
      const p2 = vp[(i + 1) % n] as Vector3;
      const p3 = vp[(i + 2) % n] as Vector3;
      const w1 = points[i]?.w ?? defaultWidth;
      const w2 = points[(i + 1) % n]?.w ?? defaultWidth;
      const b1 = points[i]?.bank ?? 0;
      const b2 = points[(i + 1) % n]?.bank ?? 0;
      for (let k = 0; k < perSeg; k++) {
        const t = k / perSeg;
        const sm = t * t * (3 - 2 * t);
        dense.push({
          pos: catmullRom(p0, p1, p2, p3, t, new Vector3()),
          w: w1 + (w2 - w1) * sm,
          bank: b1 + (b2 - b1) * sm,
        });
      }
    }
    // 2) Накопленная длина плотной выборки.
    const cum: number[] = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = (dense[i - 1] as { pos: Vector3 }).pos;
      const b = (dense[i % dense.length] as { pos: Vector3 }).pos;
      cum.push((cum[i - 1] as number) + a.distanceTo(b));
    }
    const total = cum[dense.length] as number;
    const count = Math.max(8, Math.round(total / step));
    this.step = total / count;
    this.length = total;
    // 3) Равномерное пересэмплирование по длине дуги.
    const samples: PathSample[] = [];
    let j = 0;
    for (let i = 0; i < count; i++) {
      const s = i * this.step;
      while (j < dense.length - 1 && (cum[j + 1] as number) < s) j++;
      const segLen = (cum[j + 1] as number) - (cum[j] as number);
      const t = segLen > 0 ? (s - (cum[j] as number)) / segLen : 0;
      const a = dense[j] as { pos: Vector3; w: number; bank: number };
      const b = dense[(j + 1) % dense.length] as { pos: Vector3; w: number; bank: number };
      samples.push({
        s,
        pos: a.pos.clone().lerp(b.pos, t),
        tan: new Vector3(),
        right: new Vector3(),
        curvature: 0,
        width: a.w + (b.w - a.w) * t,
        bank: a.bank + (b.bank - a.bank) * t,
      });
    }
    // 4) Касательные, правые векторы, кривизна.
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const prev = (samples[(i - 1 + count) % count] as PathSample).pos;
      const next = (samples[(i + 1) % count] as PathSample).pos;
      const sm = samples[i] as PathSample;
      sm.tan.subVectors(next, prev).normalize();
      sm.right.crossVectors(sm.tan, up);
      sm.right.y = 0;
      sm.right.normalize();
    }
    for (let i = 0; i < count; i++) {
      const a = samples[(i - 2 + count) % count] as PathSample;
      const b = samples[(i + 2) % count] as PathSample;
      const ha = Math.atan2(a.tan.x, -a.tan.z);
      const hb = Math.atan2(b.tan.x, -b.tan.z);
      let dh = hb - ha;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      (samples[i] as PathSample).curvature = dh / (4 * this.step);
    }
    this.samples = samples;
  }

  wrapS(s: number): number {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** Индекс сэмпла для прогресса s. */
  indexAt(s: number): number {
    return Math.floor(this.wrapS(s) / this.step) % this.samples.length;
  }

  sample(i: number): PathSample {
    const n = this.samples.length;
    return this.samples[((i % n) + n) % n] as PathSample;
  }

  /** Точка на линии с боковым смещением d, с интерполяцией между сэмплами. */
  pointAt(s: number, d = 0, out = new Vector3()): Vector3 {
    const ws = this.wrapS(s);
    const f = ws / this.step;
    const i = Math.floor(f);
    const t = f - i;
    const a = this.sample(i);
    const b = this.sample(i + 1);
    out.copy(a.pos).lerp(b.pos, t);
    const rx = a.right.x + (b.right.x - a.right.x) * t;
    const rz = a.right.z + (b.right.z - a.right.z) * t;
    const rl = Math.hypot(rx, rz) || 1;
    out.x += (rx / rl) * d;
    out.z += (rz / rl) * d;
    const bank = a.bank + (b.bank - a.bank) * t;
    out.y -= Math.sin(bank) * d;
    return out;
  }

  /** Касательная в точке s (с интерполяцией). */
  tangentAt(s: number, out = new Vector3()): Vector3 {
    const ws = this.wrapS(s);
    const f = ws / this.step;
    const i = Math.floor(f);
    const t = f - i;
    return out
      .copy(this.sample(i).tan)
      .lerp(this.sample(i + 1).tan, t)
      .normalize();
  }

  widthAt(s: number): number {
    const ws = this.wrapS(s);
    const f = ws / this.step;
    const i = Math.floor(f);
    const t = f - i;
    return this.sample(i).width + (this.sample(i + 1).width - this.sample(i).width) * t;
  }

  curvatureAt(s: number): number {
    return this.sample(this.indexAt(s)).curvature;
  }

  /**
   * Проекция точки на линию. С подсказкой hint ищет в окне вокруг неё
   * (быстро и не путает уровни на эстакадах), без подсказки — по всей линии.
   */
  project(x: number, y: number, z: number, hint = -1, window = 40): Projection {
    const n = this.samples.length;
    let best = -1;
    let bestD = Infinity;
    const scan = (i: number): void => {
      const sm = this.samples[i] as PathSample;
      const dx = sm.pos.x - x;
      const dz = sm.pos.z - z;
      const dy = (sm.pos.y - y) * 2;
      const d2 = dx * dx + dz * dz + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        best = i;
      }
    };
    if (hint >= 0) {
      for (let k = -window; k <= window; k++) scan((((hint + k) % n) + n) % n);
      // Если в окне ничего близкого (телепорт, респаун), ищем по всей линии.
      if (bestD > 40 * 40) {
        bestD = Infinity;
        for (let i = 0; i < n; i++) scan(i);
      }
    } else {
      for (let i = 0; i < n; i++) scan(i);
    }
    // Уточнение на соседних отрезках.
    const sm = this.samples[best] as PathSample;
    const relx = x - sm.pos.x;
    const relz = z - sm.pos.z;
    let along = relx * sm.tan.x + relz * sm.tan.z;
    along = Math.max(-this.step, Math.min(this.step, along));
    const s = this.wrapS(sm.s + along);
    const d = relx * sm.right.x + relz * sm.right.z;
    return { s, d, index: best, y: sm.pos.y };
  }

  /** Разница прогресса b - a по кратчайшему пути вдоль замкнутой линии. */
  deltaS(a: number, b: number): number {
    const L = this.length;
    let d = (b - a) % L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }
}
