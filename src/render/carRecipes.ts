import { CylinderGeometry, type BufferGeometry, type Material, type MeshPhysicalMaterial } from 'three';
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
};
