import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Matrix4,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type MeshPhysicalMaterial,
} from 'three';
import type { BodyStyle, VehicleSpec } from '../vehicles/types';
import { carMaterials } from './materials';

type Prof = [number, number][];

export interface ExtraCtx {
  spec: VehicleSpec;
  paint: MeshPhysicalMaterial;
  push: (bucket: Map<Material, BufferGeometry[]>, mat: Material, geo: BufferGeometry) => void;
  box: (w: number, h: number, d: number, x: number, y: number, z: number, rx?: number) => BufferGeometry;
  profile: (p: Prof, t: number) => number;
  recipe: Recipe;
}

export type Extra = (bucket: Map<Material, BufferGeometry[]>, ctx: ExtraCtx) => void;

/**
 * «Рецепт» кузова: профили по длине машины (t: 0 — нос, 1 — корма).
 * Высоты — в метрах от земли; ширина — доля от половины габаритной ширины.
 */
export interface Recipe {
  bottom: Prof;
  belt: Prof;
  width: Prof;
  n: number;
  taper: number;
  arches: boolean;
  cabin: {
    from: number;
    to: number;
    roof: number;
    /** Доли длины кабины под лобовое и заднее стекло. */
    front: number;
    rear: number;
    inset: number;
    taper: number;
    glassRoof?: boolean;
  } | null;
  /** Капот: [от, до] по длине. */
  hood: [number, number];
  /** Бампер: [центр по высоте, высота]. */
  bumper: [number, number];
  noseInset: number;
  extras: Extra[];
}

const L = (ctx: ExtraCtx): number => ctx.spec.dims.length;
const W = (ctx: ExtraCtx): number => ctx.spec.dims.width;
const zAt = (ctx: ExtraCtx, t: number): number => -L(ctx) / 2 + t * L(ctx);

/** Задний спойлер на стойках. */
const spoiler =
  (t: number, h: number, wFrac = 0.92): Extra =>
  (b, ctx) => {
    const y = ctx.profile(ctx.recipe.belt, t) + h;
    ctx.push(b, ctx.paint, ctx.box(W(ctx) * wFrac, 0.04, 0.3, 0, y, zAt(ctx, t), -0.12));
    for (const s of [-1, 1])
      ctx.push(b, carMaterials.trim(), ctx.box(0.05, h, 0.08, s * W(ctx) * 0.3, y - h / 2, zAt(ctx, t)));
  };

/** Выхлопные трубы. */
const exhausts =
  (count: number, y = 0.28): Extra =>
  (b, ctx) => {
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * 0.16 + (count === 1 ? W(ctx) * 0.28 : 0);
      const g = new CylinderGeometry(0.055, 0.055, 0.22, 12);
      g.rotateX(Math.PI / 2);
      g.translate(x, y, L(ctx) / 2 - 0.02);
      ctx.push(b, carMaterials.chrome(), g);
    }
  };

/** Боковые пороги/обвес. */
const skirts: Extra = (b, ctx) => {
  for (const s of [-1, 1])
    ctx.push(b, carMaterials.trim(), ctx.box(0.06, 0.1, ctx.spec.wheelbase * 0.62, s * W(ctx) * 0.49, 0.24, 0));
};

/** Цилиндр (трубы, баки, дуги): ось — 'x', 'y' или 'z'. */
function cyl(
  r: number,
  h: number,
  x: number,
  y: number,
  z: number,
  axis: 'x' | 'y' | 'z' = 'y',
  seg = 12,
): BufferGeometry {
  const g = new CylinderGeometry(r, r, h, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** Труба между двумя точками (каркас багги, корзина тележки). */
function tube(r: number, a: [number, number, number], b: [number, number, number]): BufferGeometry {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const g = new CylinderGeometry(r, r, len, 8);
  const m = new Matrix4().lookAt(new Vector3(0, 0, 0), new Vector3(dx, dy, dz), new Vector3(0, 1, 0));
  g.rotateX(Math.PI / 2);
  g.applyMatrix4(m);
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

/** Решётка багажника/люстра на крыше. */
const roofRack =
  (t0: number, t1: number, y: number, wFrac = 0.8): Extra =>
  (b, ctx) => {
    for (const s of [-1, 1])
      ctx.push(
        b,
        carMaterials.metalDark(),
        ctx.box(0.05, 0.06, L(ctx) * (t1 - t0), s * W(ctx) * wFrac * 0.5, y, zAt(ctx, (t0 + t1) / 2)),
      );
    for (let i = 0; i < 4; i++)
      ctx.push(
        b,
        carMaterials.metalDark(),
        ctx.box(W(ctx) * wFrac, 0.04, 0.05, 0, y, zAt(ctx, t0 + ((t1 - t0) * i) / 3)),
      );
  };

/** Дополнительные фары (ралли, джип): светящиеся круги в ряд. */
const lampBar =
  (t: number, y: number, count: number, spread: number): Extra =>
  (b, ctx) => {
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * spread;
      const g = cyl(0.09, 0.06, x, y, zAt(ctx, t) - 0.05, 'z', 14);
      ctx.push(b, carMaterials.lights(), tintedGeo(g, '#fff6d8'));
      ctx.push(b, carMaterials.metalDark(), cyl(0.1, 0.08, x, y, zAt(ctx, t), 'z', 14));
    }
  };

function tintedGeo(geo: BufferGeometry, hex: string): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute('position').count;
  const c = new Color(hex);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new Float32BufferAttribute(arr, 3));
  return g;
}

const base = {
  n: 4.5,
  taper: 0.12,
  arches: true,
  bumper: [0.38, 0.2] as [number, number],
  noseInset: 0,
};

export const RECIPES: Partial<Record<BodyStyle, Recipe>> = {
  sports: {
    ...base,
    bottom: [
      [0, 0.24],
      [0.5, 0.17],
      [1, 0.26],
    ],
    belt: [
      [0, 0.56],
      [0.06, 0.7],
      [0.3, 0.8],
      [0.75, 0.86],
      [0.95, 0.84],
      [1, 0.7],
    ],
    width: [
      [0, 0.78],
      [0.08, 0.95],
      [0.5, 1],
      [0.9, 0.98],
      [1, 0.86],
    ],
    cabin: { from: 0.32, to: 0.8, roof: 1.24, front: 0.36, rear: 0.4, inset: 0.86, taper: 0.28 },
    hood: [0.04, 0.31],
    extras: [spoiler(0.95, 0.16), exhausts(2), skirts],
  },
  muscle: {
    ...base,
    n: 5,
    taper: 0.08,
    bumper: [0.4, 0.22],
    bottom: [
      [0, 0.26],
      [0.5, 0.19],
      [1, 0.28],
    ],
    belt: [
      [0, 0.68],
      [0.04, 0.8],
      [0.38, 0.86],
      [0.7, 0.9],
      [0.96, 0.9],
      [1, 0.78],
    ],
    width: [
      [0, 0.9],
      [0.05, 0.97],
      [0.5, 1],
      [0.95, 0.99],
      [1, 0.92],
    ],
    cabin: { from: 0.4, to: 0.82, roof: 1.34, front: 0.32, rear: 0.45, inset: 0.84, taper: 0.22 },
    hood: [0.03, 0.39],
    extras: [
      exhausts(2, 0.3),
      // Воздухозаборник на капоте.
      (b, ctx) =>
        ctx.push(
          b,
          carMaterials.trim(),
          ctx.box(0.55, 0.09, 0.9, 0, ctx.profile(ctx.recipe.belt, 0.2) + 0.05, zAt(ctx, 0.2)),
        ),
      spoiler(0.97, 0.06, 0.85),
    ],
  },
  supercar: {
    ...base,
    n: 3.6,
    taper: 0.18,
    bumper: [0.32, 0.16],
    bottom: [
      [0, 0.18],
      [0.5, 0.13],
      [1, 0.22],
    ],
    belt: [
      [0, 0.42],
      [0.1, 0.62],
      [0.38, 0.74],
      [0.7, 0.86],
      [0.92, 0.84],
      [1, 0.66],
    ],
    width: [
      [0, 0.82],
      [0.12, 0.98],
      [0.55, 1],
      [0.85, 1],
      [1, 0.9],
    ],
    cabin: { from: 0.3, to: 0.72, roof: 1.13, front: 0.45, rear: 0.4, inset: 0.78, taper: 0.34 },
    hood: [0.05, 0.3],
    extras: [
      spoiler(0.96, 0.22, 0.95),
      exhausts(4, 0.36),
      skirts,
      // Воздухозаборники по бокам.
      (b, ctx) => {
        for (const s of [-1, 1])
          ctx.push(b, carMaterials.trim(), ctx.box(0.05, 0.22, 0.7, s * W(ctx) * 0.5, 0.6, zAt(ctx, 0.62)));
      },
    ],
  },
  mower: {
    ...base,
    n: 4,
    taper: 0.15,
    arches: false,
    bumper: [0.3, 0.14],
    bottom: [
      [0, 0.22],
      [1, 0.25],
    ],
    belt: [
      [0, 0.45],
      [0.2, 0.55],
      [0.55, 0.62],
      [0.75, 0.9],
      [1, 0.95],
    ],
    width: [
      [0, 0.8],
      [0.3, 0.95],
      [1, 0.9],
    ],
    cabin: null,
    hood: [0.02, 0.45],
    extras: [
      // Сиденье, руль и дека косилки.
      (b, ctx) => {
        ctx.push(b, carMaterials.trim(), ctx.box(0.5, 0.45, 0.45, 0, 1.05, zAt(ctx, 0.78)));
        ctx.push(b, carMaterials.trim(), ctx.box(0.55, 0.12, 0.5, 0, 0.98, zAt(ctx, 0.66)));
        const col = new CylinderGeometry(0.03, 0.03, 0.6, 8);
        col.rotateX(0.5);
        col.translate(0, 0.95, zAt(ctx, 0.48));
        ctx.push(b, carMaterials.metalDark(), col);
        const wheel = new CylinderGeometry(0.17, 0.17, 0.04, 16);
        wheel.rotateX(-1.0);
        wheel.translate(0, 1.22, zAt(ctx, 0.43));
        ctx.push(b, carMaterials.trim(), wheel);
        ctx.push(b, carMaterials.metalDark(), ctx.box(W(ctx) * 1.05, 0.12, L(ctx) * 0.42, 0, 0.16, zAt(ctx, 0.42)));
      },
    ],
  },

  formula: {
    ...base,
    n: 3,
    taper: 0.2,
    arches: false,
    bumper: [0.2, 0.06],
    noseInset: 0.15,
    bottom: [
      [0, 0.12],
      [1, 0.14],
    ],
    belt: [
      [0, 0.26],
      [0.15, 0.36],
      [0.45, 0.56],
      [0.62, 0.66],
      [0.8, 0.6],
      [1, 0.5],
    ],
    // Узкий кузов между открытыми колёсами.
    width: [
      [0, 0.12],
      [0.2, 0.22],
      [0.45, 0.42],
      [0.6, 0.44],
      [0.85, 0.36],
      [1, 0.2],
    ],
    cabin: null,
    hood: [0.15, 0.4],
    extras: [
      // Переднее и заднее антикрыло, кокпит с дугой, боковые понтоны.
      (b, ctx) => {
        ctx.push(b, ctx.paint, ctx.box(W(ctx) * 0.98, 0.04, 0.42, 0, 0.16, zAt(ctx, 0.03)));
        for (const s of [-1, 1])
          ctx.push(b, carMaterials.trim(), ctx.box(0.03, 0.16, 0.42, s * W(ctx) * 0.49, 0.2, zAt(ctx, 0.03)));
        ctx.push(b, ctx.paint, ctx.box(W(ctx) * 0.62, 0.05, 0.4, 0, 0.98, zAt(ctx, 0.97), -0.1));
        for (const s of [-1, 1])
          ctx.push(b, ctx.paint, ctx.box(0.03, 0.42, 0.5, s * W(ctx) * 0.31, 0.8, zAt(ctx, 0.96)));
        ctx.push(b, carMaterials.metalDark(), ctx.box(0.08, 0.36, 0.12, 0, 0.78, zAt(ctx, 0.95)));
        ctx.push(b, carMaterials.trim(), ctx.box(0.42, 0.12, 0.62, 0, 0.62, zAt(ctx, 0.5)));
        ctx.push(b, carMaterials.trim(), cyl(0.12, 0.12, 0, 0.72, zAt(ctx, 0.52), 'y', 16));
        ctx.push(b, carMaterials.metalDark(), tube(0.025, [-0.25, 0.66, zAt(ctx, 0.43)], [0, 0.86, zAt(ctx, 0.47)]));
        ctx.push(b, carMaterials.metalDark(), tube(0.025, [0.25, 0.66, zAt(ctx, 0.43)], [0, 0.86, zAt(ctx, 0.47)]));
        ctx.push(b, carMaterials.metalDark(), tube(0.025, [0, 0.86, zAt(ctx, 0.47)], [0, 0.62, zAt(ctx, 0.36)]));
        for (const s of [-1, 1]) ctx.push(b, ctx.paint, ctx.box(0.3, 0.3, 1.5, s * 0.52, 0.34, zAt(ctx, 0.62)));
        ctx.push(b, carMaterials.trim(), ctx.box(0.26, 0.24, 0.3, 0, 0.82, zAt(ctx, 0.63)));
      },
    ],
  },
  hatch: {
    ...base,
    n: 4.2,
    taper: 0.12,
    bottom: [
      [0, 0.26],
      [0.5, 0.22],
      [1, 0.3],
    ],
    belt: [
      [0, 0.62],
      [0.06, 0.78],
      [0.3, 0.88],
      [0.85, 0.94],
      [1, 0.9],
    ],
    width: [
      [0, 0.86],
      [0.08, 0.97],
      [0.5, 1],
      [0.92, 0.99],
      [1, 0.94],
    ],
    cabin: { from: 0.3, to: 0.99, roof: 1.42, front: 0.3, rear: 0.12, inset: 0.86, taper: 0.22 },
    hood: [0.04, 0.29],
    extras: [
      lampBar(0.0, 0.62, 4, 0.32),
      spoiler(0.97, 0.06, 0.8),
      exhausts(1, 0.3),
      // Брызговики.
      (b, ctx) => {
        for (const s of [-1, 1])
          ctx.push(
            b,
            carMaterials.trim(),
            ctx.box(
              0.3,
              0.26,
              0.02,
              s * ctx.spec.track * 0.5,
              0.2,
              ctx.spec.wheelbase / 2 + ctx.spec.wheelRadius + 0.08,
            ),
          );
      },
    ],
  },
  pickup: {
    ...base,
    n: 7,
    taper: 0.06,
    bumper: [0.48, 0.24],
    bottom: [
      [0, 0.38],
      [1, 0.42],
    ],
    belt: [
      [0, 0.92],
      [0.05, 1.08],
      [0.3, 1.14],
      [1, 1.16],
    ],
    width: [
      [0, 0.92],
      [0.05, 0.99],
      [0.5, 1],
      [1, 0.98],
    ],
    cabin: { from: 0.3, to: 0.6, roof: 1.85, front: 0.3, rear: 0.1, inset: 0.92, taper: 0.1 },
    hood: [0.03, 0.29],
    extras: [
      // Кузов: пол и борта, дуга за кабиной.
      (b, ctx) => {
        ctx.push(b, carMaterials.metalDark(), ctx.box(W(ctx) * 0.9, 0.04, L(ctx) * 0.36, 0, 1.0, zAt(ctx, 0.8)));
        for (const s of [-1, 1])
          ctx.push(b, ctx.paint, ctx.box(0.06, 0.32, L(ctx) * 0.38, s * W(ctx) * 0.47, 1.28, zAt(ctx, 0.8)));
        ctx.push(b, ctx.paint, ctx.box(W(ctx) * 0.94, 0.32, 0.06, 0, 1.28, zAt(ctx, 0.99)));
        ctx.push(
          b,
          carMaterials.metalDark(),
          tube(0.04, [-W(ctx) * 0.42, 1.3, zAt(ctx, 0.62)], [-W(ctx) * 0.42, 1.95, zAt(ctx, 0.62)]),
        );
        ctx.push(
          b,
          carMaterials.metalDark(),
          tube(0.04, [W(ctx) * 0.42, 1.3, zAt(ctx, 0.62)], [W(ctx) * 0.42, 1.95, zAt(ctx, 0.62)]),
        );
        ctx.push(
          b,
          carMaterials.metalDark(),
          tube(0.04, [-W(ctx) * 0.42, 1.95, zAt(ctx, 0.62)], [W(ctx) * 0.42, 1.95, zAt(ctx, 0.62)]),
        );
        ctx.push(b, carMaterials.chrome(), ctx.box(W(ctx) * 0.6, 0.3, 0.05, 0, 0.88, zAt(ctx, 0.0)));
      },
      lampBar(0.62, 2.0, 4, 0.36),
    ],
  },
  jeep: {
    ...base,
    n: 9,
    taper: 0.05,
    bumper: [0.5, 0.22],
    bottom: [
      [0, 0.42],
      [1, 0.44],
    ],
    belt: [
      [0, 0.98],
      [0.04, 1.12],
      [0.5, 1.16],
      [1, 1.16],
    ],
    width: [
      [0, 0.9],
      [0.05, 0.98],
      [0.5, 1],
      [1, 0.98],
    ],
    cabin: { from: 0.34, to: 0.97, roof: 1.86, front: 0.14, rear: 0.04, inset: 0.94, taper: 0.06 },
    hood: [0.03, 0.33],
    extras: [
      roofRack(0.42, 0.92, 1.92),
      lampBar(0.4, 2.0, 4, 0.36),
      // Запаска на задней двери и «кенгурятник».
      (b, ctx) => {
        const g = cyl(ctx.spec.wheelRadius * 0.95, 0.26, 0, 1.1, zAt(ctx, 1) + 0.14, 'z', 20);
        ctx.push(b, carMaterials.rubber(), g);
        ctx.push(b, carMaterials.metalDark(), ctx.box(W(ctx) * 0.7, 0.06, 0.06, 0, 0.9, zAt(ctx, 0) - 0.1));
        for (const s of [-1, 1])
          ctx.push(
            b,
            carMaterials.metalDark(),
            tube(0.035, [s * W(ctx) * 0.3, 0.5, zAt(ctx, 0) - 0.1], [s * W(ctx) * 0.3, 1.0, zAt(ctx, 0) - 0.08]),
          );
      },
    ],
  },
  armored: {
    ...base,
    n: 12,
    taper: 0.12,
    bumper: [0.62, 0.3],
    bottom: [
      [0, 0.55],
      [1, 0.58],
    ],
    belt: [
      [0, 1.15],
      [0.12, 1.5],
      [0.5, 1.6],
      [1, 1.55],
    ],
    width: [
      [0, 0.86],
      [0.1, 0.98],
      [0.5, 1],
      [1, 0.96],
    ],
    cabin: { from: 0.2, to: 0.95, roof: 2.3, front: 0.12, rear: 0.05, inset: 0.9, taper: 0.18 },
    hood: [0.03, 0.2],
    extras: [
      // Броне-плиты, люк с поручнями, решётка радиатора.
      (b, ctx) => {
        for (const s of [-1, 1])
          ctx.push(
            b,
            carMaterials.metalDark(),
            ctx.box(0.06, 0.5, L(ctx) * 0.7, s * W(ctx) * 0.505, 1.1, zAt(ctx, 0.55)),
          );
        ctx.push(b, carMaterials.metalDark(), cyl(0.42, 0.22, 0, 2.38, zAt(ctx, 0.55), 'y', 18));
        ctx.push(b, carMaterials.metalDark(), ctx.box(0.12, 0.12, 0.9, 0, 2.48, zAt(ctx, 0.42)));
        ctx.push(b, carMaterials.metalDark(), ctx.box(W(ctx) * 0.8, 0.5, 0.06, 0, 1.0, zAt(ctx, 0) - 0.04));
      },
      lampBar(0.02, 1.25, 2, 1.4),
    ],
  },
  hearse: {
    ...base,
    n: 5,
    taper: 0.12,
    bottom: [
      [0, 0.26],
      [0.5, 0.22],
      [1, 0.28],
    ],
    belt: [
      [0, 0.66],
      [0.05, 0.8],
      [0.3, 0.86],
      [1, 0.9],
    ],
    width: [
      [0, 0.88],
      [0.05, 0.97],
      [0.5, 1],
      [1, 0.97],
    ],
    cabin: { from: 0.3, to: 0.99, roof: 1.5, front: 0.18, rear: 0.03, inset: 0.9, taper: 0.12 },
    hood: [0.03, 0.29],
    extras: [
      // Хромированные «ландо»-скобы на задних стойках, молдинги.
      (b, ctx) => {
        for (const s of [-1, 1]) {
          ctx.push(b, carMaterials.chrome(), ctx.box(0.03, 0.03, L(ctx) * 0.9, s * W(ctx) * 0.5, 0.62, 0));
          ctx.push(
            b,
            carMaterials.chrome(),
            tube(0.025, [s * W(ctx) * 0.46, 1.1, zAt(ctx, 0.7)], [s * W(ctx) * 0.46, 1.38, zAt(ctx, 0.8)]),
          );
          ctx.push(
            b,
            carMaterials.chrome(),
            tube(0.025, [s * W(ctx) * 0.46, 1.38, zAt(ctx, 0.8)], [s * W(ctx) * 0.46, 1.1, zAt(ctx, 0.9)]),
          );
        }
        ctx.push(b, carMaterials.chrome(), ctx.box(W(ctx) * 0.5, 0.18, 0.05, 0, 0.6, zAt(ctx, 0) + 0.02));
      },
    ],
  },
  limo: {
    ...base,
    n: 5,
    taper: 0.12,
    bottom: [
      [0, 0.26],
      [0.5, 0.21],
      [1, 0.28],
    ],
    belt: [
      [0, 0.64],
      [0.04, 0.78],
      [0.25, 0.84],
      [0.92, 0.88],
      [1, 0.8],
    ],
    width: [
      [0, 0.88],
      [0.04, 0.97],
      [0.5, 1],
      [0.96, 0.98],
      [1, 0.92],
    ],
    cabin: { from: 0.24, to: 0.86, roof: 1.44, front: 0.12, rear: 0.1, inset: 0.88, taper: 0.16 },
    hood: [0.03, 0.23],
    extras: [
      exhausts(2, 0.28),
      (b, ctx) => {
        for (const s of [-1, 1])
          ctx.push(b, carMaterials.chrome(), ctx.box(0.03, 0.03, L(ctx) * 0.92, s * W(ctx) * 0.5, 0.58, 0));
        ctx.push(b, carMaterials.chrome(), ctx.box(W(ctx) * 0.46, 0.2, 0.05, 0, 0.58, zAt(ctx, 0) + 0.02));
      },
    ],
  },
  tractor: {
    ...base,
    n: 6,
    taper: 0.1,
    arches: false,
    bumper: [0.7, 0.2],
    bottom: [
      [0, 0.62],
      [1, 0.7],
    ],
    belt: [
      [0, 1.15],
      [0.5, 1.25],
      [1, 1.3],
    ],
    // Узкий капот спереди, широкая кабина сзади.
    width: [
      [0, 0.38],
      [0.5, 0.42],
      [0.6, 0.62],
      [1, 0.66],
    ],
    cabin: { from: 0.56, to: 0.98, roof: 2.6, front: 0.08, rear: 0.05, inset: 1.0, taper: 0.05, glassRoof: false },
    hood: [0.02, 0.5],
    extras: [
      (b, ctx) => {
        // Выхлопная труба, крылья над задними колёсами, балласт спереди.
        ctx.push(b, carMaterials.metalDark(), cyl(0.06, 1.2, W(ctx) * 0.12, 1.85, zAt(ctx, 0.32)));
        const rr = ctx.spec.rearWheelRadius ?? ctx.spec.wheelRadius;
        for (const s of [-1, 1])
          ctx.push(
            b,
            ctx.paint,
            ctx.box(0.5, 0.05, rr * 2.1, s * ctx.spec.track * 0.5, rr * 2 + 0.08, ctx.spec.wheelbase / 2),
          );
        ctx.push(b, carMaterials.metalDark(), ctx.box(W(ctx) * 0.6, 0.4, 0.3, 0, 0.75, zAt(ctx, 0) - 0.05));
      },
    ],
  },
  cart: {
    ...base,
    n: 12,
    taper: -0.1,
    arches: false,
    bumper: [0.22, 0.06],
    bottom: [
      [0, 0.18],
      [1, 0.2],
    ],
    belt: [
      [0, 0.24],
      [1, 0.26],
    ],
    width: [
      [0, 0.86],
      [1, 0.86],
    ],
    cabin: null,
    hood: [0, 0],
    extras: [
      // Корзина из прутьев, ручка, мотор сзади.
      (b, ctx) => {
        const hw = W(ctx) * 0.46;
        const z0 = zAt(ctx, 0.05);
        const z1 = zAt(ctx, 0.85);
        const y0 = 0.3;
        const y1 = 1.0;
        const m = carMaterials.chrome();
        for (let i = 0; i <= 6; i++) {
          const z = z0 + ((z1 - z0) * i) / 6;
          for (const s of [-1, 1]) ctx.push(b, m, tube(0.012, [s * hw, y0, z], [s * hw * 1.08, y1, z]));
        }
        for (let i = 0; i <= 4; i++) {
          const x = -hw + (2 * hw * i) / 4;
          ctx.push(b, m, tube(0.012, [x, y0, z0], [x * 1.08, y1, z0 - 0.08]));
          ctx.push(b, m, tube(0.012, [x, y0, z1], [x * 1.08, y1, z1 + 0.04]));
        }
        for (const y of [y0, (y0 + y1) / 2, y1])
          for (const s of [-1, 1])
            ctx.push(
              b,
              m,
              tube(0.014, [s * hw * (1 + (y - y0) * 0.11), y, z0], [s * hw * (1 + (y - y0) * 0.11), y, z1]),
            );
        ctx.push(b, m, tube(0.022, [-hw, 1.1, z1 + 0.15], [hw, 1.1, z1 + 0.15]));
        ctx.push(b, ctx.paint, ctx.box(hw * 2.05, 0.05, 0.08, 0, 1.1, z1 + 0.15));
        ctx.push(b, carMaterials.metalDark(), ctx.box(0.4, 0.3, 0.3, 0, 0.42, zAt(ctx, 0.95)));
        ctx.push(b, carMaterials.metalDark(), cyl(0.04, 0.3, 0.12, 0.7, zAt(ctx, 0.95)));
      },
    ],
  },
  icecream: {
    ...base,
    n: 8,
    taper: 0.06,
    bumper: [0.45, 0.22],
    bottom: [
      [0, 0.36],
      [1, 0.4],
    ],
    belt: [
      [0, 0.95],
      [0.06, 1.1],
      [0.22, 1.2],
      [0.3, 2.3],
      [1, 2.35],
    ],
    width: [
      [0, 0.9],
      [0.08, 0.98],
      [0.5, 1],
      [1, 1],
    ],
    cabin: { from: 0.1, to: 0.26, roof: 2.0, front: 0.5, rear: 0.05, inset: 0.94, taper: 0.1 },
    hood: [0.02, 0.12],
    extras: [
      // Рожок мороженого на крыше, окно выдачи, козырёк.
      (b, ctx) => {
        const cone = new ConeGeometry(0.32, 0.9, 16);
        cone.rotateX(Math.PI);
        cone.translate(0, 2.85, zAt(ctx, 0.6));
        ctx.push(b, carMaterials.waffle(), cone);
        const ball = new SphereGeometry(0.4, 16, 12);
        ball.translate(0, 3.38, zAt(ctx, 0.6));
        ctx.push(b, ctx.paint, ball);
        ctx.push(b, carMaterials.glass(), ctx.box(0.04, 0.7, 1.6, W(ctx) * 0.505, 1.65, zAt(ctx, 0.62)));
        ctx.push(b, carMaterials.metalDark(), ctx.box(0.4, 0.05, 1.8, W(ctx) * 0.6, 2.1, zAt(ctx, 0.62)));
        for (let i = 0; i < 6; i++)
          ctx.push(
            b,
            carMaterials.lights(),
            tintedGeo(
              ctx.box(0.03, 0.08, 0.14, W(ctx) * 0.51, 2.28, zAt(ctx, 0.36 + i * 0.11)),
              i % 2 ? '#ff4fa3' : '#4fd8ff',
            ),
          );
      },
    ],
  },
  garbage: {
    ...base,
    n: 9,
    taper: 0.04,
    bumper: [0.6, 0.28],
    bottom: [
      [0, 0.55],
      [1, 0.6],
    ],
    belt: [
      [0, 1.3],
      [0.18, 1.45],
      [0.24, 3.0],
      [0.95, 3.1],
      [1, 2.7],
    ],
    width: [
      [0, 0.9],
      [0.06, 0.98],
      [0.5, 1],
      [1, 0.98],
    ],
    cabin: { from: 0.02, to: 0.22, roof: 2.75, front: 0.25, rear: 0.05, inset: 0.96, taper: 0.06 },
    hood: [0, 0],
    extras: [
      // Рёбра кузова, задний загрузочный механизм, проблесковые маячки.
      (b, ctx) => {
        for (let i = 0; i < 6; i++)
          for (const s of [-1, 1])
            ctx.push(
              b,
              carMaterials.metalDark(),
              ctx.box(0.05, 2.3, 0.08, s * W(ctx) * 0.505, 1.95, zAt(ctx, 0.3 + i * 0.12)),
            );
        ctx.push(b, carMaterials.metalDark(), ctx.box(W(ctx) * 0.96, 1.8, 0.5, 0, 1.6, zAt(ctx, 0.98)));
        for (const s of [-1, 1])
          ctx.push(
            b,
            carMaterials.lights(),
            tintedGeo(cyl(0.08, 0.12, s * 0.5, 2.85, zAt(ctx, 0.12), 'y', 12), '#ff9a00'),
          );
      },
    ],
  },
  buggy: {
    ...base,
    n: 3.5,
    taper: 0.2,
    arches: false,
    bumper: [0.4, 0.12],
    bottom: [
      [0, 0.34],
      [1, 0.36],
    ],
    belt: [
      [0, 0.5],
      [0.2, 0.62],
      [0.6, 0.72],
      [1, 0.82],
    ],
    width: [
      [0, 0.42],
      [0.3, 0.6],
      [0.7, 0.66],
      [1, 0.56],
    ],
    cabin: null,
    hood: [0.05, 0.3],
    extras: [
      // Трубчатый каркас безопасности, сиденье, мотор сзади, фары на дуге.
      (b, ctx) => {
        const m = carMaterials.metalDark();
        const hw = W(ctx) * 0.3;
        const zf = zAt(ctx, 0.3);
        const zr = zAt(ctx, 0.78);
        const top = 1.5;
        for (const s of [-1, 1]) {
          ctx.push(b, m, tube(0.035, [s * hw, 0.6, zf], [s * hw * 0.85, top, zf + 0.5]));
          ctx.push(b, m, tube(0.035, [s * hw * 0.85, top, zf + 0.5], [s * hw * 0.85, top, zr - 0.2]));
          ctx.push(b, m, tube(0.035, [s * hw * 0.85, top, zr - 0.2], [s * hw, 0.7, zr]));
          ctx.push(b, m, tube(0.03, [s * hw, 0.6, zf], [s * hw, 0.7, zr]));
        }
        ctx.push(b, m, tube(0.035, [-hw * 0.85, top, zf + 0.5], [hw * 0.85, top, zf + 0.5]));
        ctx.push(b, m, tube(0.035, [-hw * 0.85, top, zr - 0.2], [hw * 0.85, top, zr - 0.2]));
        ctx.push(b, carMaterials.trim(), ctx.box(0.5, 0.55, 0.5, 0, 0.9, zAt(ctx, 0.58)));
        ctx.push(b, carMaterials.metalDark(), ctx.box(0.7, 0.45, 0.6, 0, 0.85, zAt(ctx, 0.9)));
      },
      lampBar(0.43, 1.56, 4, 0.22),
    ],
  },
};
