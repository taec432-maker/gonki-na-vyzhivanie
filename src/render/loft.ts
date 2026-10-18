import { BufferGeometry, Float32BufferAttribute } from 'three';

/**
 * Лофт: поверхность, натянутая на последовательность поперечных сечений вдоль оси Z.
 * Из него строятся кузова процедурных машин (раздел 8 ТЗ: «процедурный меш с PBR»).
 */
export interface Station {
  z: number;
  /** Полуширина. */
  hw: number;
  /** Низ и верх сечения. */
  yb: number;
  yt: number;
  /** Степень «квадратности» суперэллипса: 2 — эллипс, 6+ — почти прямоугольник. */
  n?: number;
  /** Сужение кверху (0 — вертикальные борта, 0.3 — заметный завал). */
  taper?: number;
}

export interface LoftOptions {
  segments?: number;
  capStart?: boolean;
  capEnd?: boolean;
  /** Индексы точек сечения, которые относятся к «верху» (для разбивки материалов). */
  classify?: (ring: number, station: number, angle: number) => number;
}

export function ringPoint(st: Station, theta: number): [number, number] {
  const n = st.n ?? 4;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const e = 2 / n;
  const px = Math.sign(c) * Math.pow(Math.abs(c), e);
  const py = Math.sign(s) * Math.pow(Math.abs(s), e);
  const yc = (st.yb + st.yt) / 2;
  const hh = (st.yt - st.yb) / 2;
  const y = yc + py * hh;
  // Доля высоты сечения 0..1; у вырожденного сечения (верх ниже низа) — 0, без деления на ~0.
  const t = st.yt - st.yb > 1e-4 ? (y - st.yb) / (st.yt - st.yb) : 0;
  const x = px * st.hw * (1 - (st.taper ?? 0) * t);
  return [x, y];
}

/** Строит геометрию; группы материалов задаются функцией classify (0, 1, 2…). */
export function loft(stations: Station[], opts: LoftOptions = {}): BufferGeometry {
  const M = opts.segments ?? 28;
  const pos: number[] = [];
  const uv: number[] = [];
  const S = stations.length;
  for (let i = 0; i < S; i++) {
    const st = stations[i] as Station;
    for (let k = 0; k <= M; k++) {
      const th = (k / M) * Math.PI * 2;
      const [x, y] = ringPoint(st, th);
      pos.push(x, y, st.z);
      uv.push(k / M, i / (S - 1));
    }
  }
  const tris: { a: number; b: number; c: number; g: number }[] = [];
  const idx = (i: number, k: number): number => i * (M + 1) + k;
  for (let i = 0; i < S - 1; i++) {
    for (let k = 0; k < M; k++) {
      const th = ((k + 0.5) / M) * Math.PI * 2;
      const g = opts.classify ? opts.classify(k, i, th) : 0;
      tris.push({ a: idx(i, k), b: idx(i, k + 1), c: idx(i + 1, k), g });
      tris.push({ a: idx(i, k + 1), b: idx(i + 1, k + 1), c: idx(i + 1, k), g });
    }
  }
  const capGroup = 0;
  const addCap = (i: number, front: boolean): void => {
    const st = stations[i] as Station;
    const center = pos.length / 3;
    pos.push(0, (st.yb + st.yt) / 2, st.z);
    uv.push(0.5, 0.5);
    for (let k = 0; k < M; k++) {
      if (front) tris.push({ a: center, b: idx(i, k + 1), c: idx(i, k), g: capGroup });
      else tris.push({ a: center, b: idx(i, k), c: idx(i, k + 1), g: capGroup });
    }
  };
  if (opts.capStart !== false) addCap(0, true);
  if (opts.capEnd !== false) addCap(S - 1, false);
  tris.sort((p, q) => p.g - q.g);
  const index: number[] = [];
  const geo = new BufferGeometry();
  let start = 0;
  let current = tris.length ? (tris[0] as { g: number }).g : 0;
  for (let t = 0; t < tris.length; t++) {
    const tr = tris[t] as { a: number; b: number; c: number; g: number };
    if (tr.g !== current) {
      geo.addGroup(start, index.length - start, current);
      start = index.length;
      current = tr.g;
    }
    index.push(tr.a, tr.b, tr.c);
  }
  geo.addGroup(start, index.length - start, current);
  geo.setIndex(index);
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/** Гладкая интерполяция профиля по контрольным точкам [t, value]. */
export function profile(points: [number, number][], t: number): number {
  if (t <= (points[0] as [number, number])[0]) return (points[0] as [number, number])[1];
  for (let i = 0; i < points.length - 1; i++) {
    const [t0, v0] = points[i] as [number, number];
    const [t1, v1] = points[i + 1] as [number, number];
    if (t <= t1) {
      const u = (t - t0) / Math.max(1e-6, t1 - t0);
      const sm = u * u * (3 - 2 * u);
      return v0 + (v1 - v0) * sm;
    }
  }
  return (points[points.length - 1] as [number, number])[1];
}

/** Разбивает геометрию с группами на отдельные геометрии по индексу материала. */
export function splitByGroup(geo: BufferGeometry): Map<number, BufferGeometry> {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.getAttribute('position').array as Float32Array;
  const nor = src.getAttribute('normal').array as Float32Array;
  const out = new Map<number, BufferGeometry>();
  for (const g of geo.groups) {
    const part = new BufferGeometry();
    part.setAttribute('position', new Float32BufferAttribute(pos.slice(g.start * 3, (g.start + g.count) * 3), 3));
    part.setAttribute('normal', new Float32BufferAttribute(nor.slice(g.start * 3, (g.start + g.count) * 3), 3));
    out.set(g.materialIndex ?? 0, part);
  }
  return out;
}
