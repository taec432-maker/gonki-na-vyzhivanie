import type { BufferGeometry } from 'three';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  Vector2,
  type Material,
  type MeshPhysicalMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { VehicleSpec } from '../vehicles/types';
import { carMaterials, paintMaterial } from './materials';
import { loft, profile, splitByGroup, type Station } from './loft';
import { RECIPES, type Recipe } from './carRecipes';

export type PartName = 'hood' | 'bumperF' | 'bumperR';

export interface CarModel {
  root: Group;
  /** Кузов в системе координат тела физики (смещён на высоту подвески). */
  body: Group;
  paint: MeshPhysicalMaterial;
  /** Сколько опустить кузов относительно центра тела физики. */
  bodyOffsetY: number;
  /** Какие части ещё на месте. */
  attached: Set<PartName>;
  /**
   * Оторвать часть (повреждения): кузов пересобирается без неё, возвращается
   * меш части для обломка (или null, если её уже нет).
   */
  detach(part: PartName): Mesh | null;
}

/** Высота центра колеса относительно центра тела в покое (см. PhysVehicle: подвеска ~0.28 м). */
export const NOMINAL_WHEEL_Y = -0.28;

type Bucket = Map<Material, BufferGeometry[]>;

function push(bucket: Bucket, mat: Material, geo: BufferGeometry): void {
  let list = bucket.get(mat);
  if (!list) {
    list = [];
    bucket.set(mat, list);
  }
  list.push(geo.index ? geo.toNonIndexed() : geo);
}

/** Окрашивает геометрию фары/фонаря (цвет свечения берётся из вершин, см. carMaterials.lights). */
function tinted(geo: BufferGeometry, hex: string): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute('position').count;
  const c = new Color(hex);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(arr, 3));
  return g;
}

function mergeList(list: BufferGeometry[]): BufferGeometry | null {
  return mergeGeometries(
    list.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      if (n.getAttribute('uv')) n.deleteAttribute('uv');
      if (!n.getAttribute('normal')) n.computeVertexNormals();
      return n;
    }),
    false,
  );
}

/** Материалы, которые не отбрасывают тень (мелочь — экономия draw calls в проходе теней). */
const NO_SHADOW = new Set(['lights', 'chrome']);

function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

/**
 * Процедурная модель машины: кузов-лофт с арками колёс, кабина со стёклами,
 * фары, бамперы, капот. Все статичные части сливаются по материалам —
 * 4–6 draw calls на машину (бюджет ≤ 300 на кадр).
 */
export function buildCarModel(spec: VehicleSpec, color: string): CarModel {
  const recipe: Recipe = RECIPES[spec.body] ?? (RECIPES.sports as Recipe);
  const L = spec.dims.length;
  const W = spec.dims.width;
  const r = spec.wheelRadius;
  const rr = spec.rearWheelRadius ?? r;
  const paint = paintMaterial(color);
  const bucket: Bucket = new Map();
  const zF = -spec.wheelbase / 2;
  const zR = spec.wheelbase / 2;
  const archR = (z: number): number => {
    let y = -Infinity;
    for (const [zw, rad] of [
      [zF, r],
      [zR, rr],
    ] as const) {
      const R = rad * 1.18;
      const dz = z - zw;
      if (Math.abs(dz) < R) y = Math.max(y, rad + Math.sqrt(R * R - dz * dz) * 0.92);
    }
    return y;
  };

  // --- Нижний кузов ---
  const N = 72;
  const stations: Station[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = -L / 2 + t * L;
    const belt = profile(recipe.belt, t);
    let bottom = profile(recipe.bottom, t);
    if (recipe.arches) bottom = Math.max(bottom, Math.min(belt - 0.08, archR(z)));
    stations.push({
      z,
      hw: (W / 2) * profile(recipe.width, t),
      yb: bottom,
      yt: belt,
      n: recipe.n,
      taper: recipe.taper,
    });
  }
  push(bucket, paint, loft(stations, { segments: 32 }));

  // Днище и тёмная «юбка» под кузовом, чтобы не просвечивало небо.
  push(bucket, carMaterials.trim(), box(W * 0.8, 0.06, L * 0.86, 0, profile(recipe.bottom, 0.5) + 0.03, 0));

  // --- Кабина ---
  const cab = recipe.cabin;
  if (cab) {
    const cs: Station[] = [];
    const CN = 36;
    for (let i = 0; i <= CN; i++) {
      const u = i / CN;
      const t = cab.from + (cab.to - cab.from) * u;
      const z = -L / 2 + t * L;
      const belt = profile(recipe.belt, t) - 0.04;
      // Лобовое и заднее стекло — наклонные участки по краям кабины.
      const rise = Math.min(1, u / cab.front, (1 - u) / cab.rear);
      const sm = rise * rise * (3 - 2 * rise);
      const roof = belt + (cab.roof - belt) * Math.max(0.04, sm);
      cs.push({ z, hw: (W / 2) * profile(recipe.width, t) * cab.inset, yb: belt, yt: roof, n: 5, taper: cab.taper });
    }
    const roofMat = cab.glassRoof ? 1 : 0;
    const geo = loft(cs, {
      segments: 32,
      classify: (_k, st, th) => {
        const u = st / CN;
        const top = th > Math.PI * 0.3 && th < Math.PI * 0.7;
        const flat = u > cab.front && u < 1 - cab.rear;
        return top && flat ? roofMat : 1;
      },
    });
    // Группы: 0 — крыша (краска), 1 — стекло.
    const mats = [paint, carMaterials.glass()];
    for (const [gi, part] of splitByGroup(geo)) push(bucket, mats[gi] as Material, part);
    // Стойки кабины: тонкие тёмные рамки поверх стекла по краям лобового.
    const zA = -L / 2 + (cab.from + (cab.to - cab.from) * cab.front) * L;
    const zB = -L / 2 + (cab.to - (cab.to - cab.from) * cab.rear) * L;
    push(
      bucket,
      paint,
      box(
        W * profile(recipe.width, cab.from) * cab.inset * 0.96,
        0.05,
        Math.abs(zB - zA),
        0,
        cab.roof + 0.005,
        (zA + zB) / 2,
      ),
    );
  }

  // --- Капот и бамперы: слиты с кузовом, но помнятся отдельно — чтобы отлетать при повреждениях ---
  const parts = new Map<PartName, { geo: BufferGeometry; mat: Material }>();
  const hoodT0 = recipe.hood[0];
  const hoodT1 = recipe.hood[1];
  if (hoodT1 > hoodT0) {
    const hs: Station[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = hoodT0 + ((hoodT1 - hoodT0) * i) / 12;
      const belt = profile(recipe.belt, t);
      hs.push({
        z: -L / 2 + t * L,
        hw: (W / 2) * profile(recipe.width, t) * 0.9,
        yb: belt - 0.03,
        yt: belt + 0.025,
        n: 6,
      });
    }
    parts.set('hood', { geo: loft(hs, { segments: 20 }), mat: paint });
  }
  const bh = recipe.bumper;
  parts.set('bumperF', {
    geo: box(W * 0.94, bh[1], 0.22, 0, bh[0], -L / 2 + 0.06).toNonIndexed(),
    mat: carMaterials.trim(),
  });
  parts.set('bumperR', {
    geo: box(W * 0.92, bh[1], 0.2, 0, bh[0], L / 2 - 0.06).toNonIndexed(),
    mat: carMaterials.trim(),
  });

  // --- Фары, решётка, фонари ---
  const fy = profile(recipe.belt, 0.04) - 0.1;
  for (const side of [-1, 1]) {
    push(
      bucket,
      carMaterials.lights(),
      tinted(box(W * 0.2, 0.08, 0.05, side * W * 0.33, fy, -L / 2 + 0.035 + recipe.noseInset), '#fff4dc'),
    );
    push(
      bucket,
      carMaterials.lights(),
      tinted(box(W * 0.22, 0.09, 0.05, side * W * 0.32, profile(recipe.belt, 0.97) - 0.1, L / 2 - 0.02), '#ff1a10'),
    );
    // Зеркала.
    if (cab) {
      const zm = -L / 2 + (cab.from + 0.02) * L;
      push(bucket, paint, box(0.14, 0.08, 0.16, side * (W / 2 + 0.05), profile(recipe.belt, cab.from) + 0.08, zm));
    }
  }
  push(bucket, carMaterials.trim(), box(W * 0.42, 0.12, 0.05, 0, fy - 0.05, -L / 2 + 0.03 + recipe.noseInset));

  for (const extra of recipe.extras)
    extra(bucket, { spec, paint, push, box, profile: (p, t) => profile(p, t), recipe });

  // --- Сливаем по материалам (части — внутри своих материалов, пока не оторваны) ---
  const body = new Group();
  body.name = 'body';
  const attached = new Set<PartName>(parts.keys());
  const assemble = (): void => {
    for (const child of [...body.children]) {
      body.remove(child);
      (child as Mesh).geometry.dispose();
    }
    const all: Bucket = new Map();
    for (const [mat, list] of bucket) all.set(mat, [...list]);
    for (const [name, p] of parts) if (attached.has(name)) push(all, p.mat, p.geo);
    for (const [mat, list] of all) {
      const merged = mergeList(list);
      if (!merged) continue;
      const mesh = new Mesh(merged, mat);
      mesh.castShadow = !NO_SHADOW.has(mat.name);
      mesh.receiveShadow = true;
      body.add(mesh);
    }
  };
  assemble();
  const bodyOffsetY = NOMINAL_WHEEL_Y - r;
  body.position.y = bodyOffsetY;
  const root = new Group();
  root.add(body);
  const detach = (part: PartName): Mesh | null => {
    const p = parts.get(part);
    if (!p || !attached.has(part)) return null;
    attached.delete(part);
    assemble();
    const m = new Mesh(p.geo.clone(), p.mat);
    m.castShadow = true;
    m.position.y = bodyOffsetY;
    return m;
  };
  return { root, body, paint, bodyOffsetY, attached, detach };
}

/** Геометрия шины и диска (общие на все машины — рисуются инстансингом). */
export function buildWheelGeometries(): { tire: BufferGeometry; rim: BufferGeometry } {
  // Профиль шины в единицах радиуса 1 и ширины 1.
  const pts: Vector2[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI;
    pts.push(new Vector2(0.78 + Math.cos(a) * 0.22, Math.sin(a) * 0.5));
  }
  pts.unshift(new Vector2(0.62, -0.46));
  pts.push(new Vector2(0.62, 0.46));
  const tire = new LatheGeometry(pts, 40);
  tire.rotateZ(Math.PI / 2);
  const parts: BufferGeometry[] = [];
  const disc = new CylinderGeometry(0.64, 0.64, 0.5, 32, 1, true);
  disc.rotateZ(Math.PI / 2);
  parts.push(disc.toNonIndexed());
  const face = new CylinderGeometry(0.62, 0.62, 0.06, 32);
  face.rotateZ(Math.PI / 2);
  face.translate(0.2, 0, 0);
  parts.push(face.toNonIndexed());
  for (let k = 0; k < 6; k++) {
    const sp = new BoxGeometry(0.08, 0.5, 0.11);
    sp.translate(0, 0.33, 0);
    sp.rotateX((k / 6) * Math.PI * 2);
    sp.translate(0.25, 0, 0);
    parts.push(sp.toNonIndexed());
  }
  const hub = new CylinderGeometry(0.14, 0.14, 0.1, 16);
  hub.rotateZ(Math.PI / 2);
  hub.translate(0.27, 0, 0);
  parts.push(hub.toNonIndexed());
  const rim = mergeGeometries(
    parts.map((p) => {
      p.deleteAttribute('uv');
      return p;
    }),
  );
  if (!rim) throw new Error('Не удалось собрать диск колеса');
  return { tire, rim };
}
