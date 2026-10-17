import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Vector3,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { VehicleSpec } from '../vehicles/types';
import { NOMINAL_WHEEL_Y, type CarModel, type GlbWheel, type PartName } from './carModel';

/**
 * Настоящие glTF-модели машин (раздел 8 ТЗ). Формат подготовленного файла (scripts/models):
 * узлы верхнего уровня body, hood (необязательно) и wheel_FL/FR/RL/RR, внутри — меши,
 * уже слитые по материалу; сжатие Meshopt. Здесь модель приводится к осям игры
 * (вперёд −Z, вверх +Y) и к колёсной базе из JSON машины; краска «Paint 1» — цвет игрока.
 */
const loaded = new Map<string, GLTF>();
const pending = new Map<string, Promise<GLTF>>();

function loadGlb(url: string): Promise<GLTF> {
  let p = pending.get(url);
  if (!p) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    p = loader.loadAsync(url);
    pending.set(url, p);
  }
  return p;
}

/** Предзагрузить модели ростера (до старта игры). Не загрузилась — машина будет процедурной. */
export async function preloadCarModels(specs: readonly VehicleSpec[], base: string): Promise<void> {
  await Promise.all(
    specs
      .filter((s) => s.model)
      .map(async (s) => {
        try {
          loaded.set(s.id, await loadGlb(`${base}${s.model}`));
        } catch (e) {
          console.warn(`Модель ${s.model} не загрузилась, используется процедурная`, e);
        }
      }),
  );
}

export function hasGlb(spec: VehicleSpec): boolean {
  return loaded.has(spec.id);
}

/** Узлы колёс в файле и какие колёса физики они изображают (порядок физики: FL, FR, RL, RR). */
const WHEEL_NODES: readonly { name: string; phys: number[] }[] = [
  { name: 'wheel_FL', phys: [0] },
  { name: 'wheel_FR', phys: [1] },
  // Задняя ось одним узлом: колёса не поворачивают и крутятся одинаково.
  { name: 'wheels_R', phys: [2, 3] },
  { name: 'wheel_RL', phys: [2] },
  { name: 'wheel_RR', phys: [3] },
];

/** Мелочь, которую вдали не видно (LOD), и что не отбрасывает тень. */
const DETAIL = /interior|brake|disc|hardware|mirror|light/i;
const NO_SHADOW = /interior|glass|light|hardware|mirror|disc|brake/i;

function meshes(o: Object3D): Mesh[] {
  const out: Mesh[] = [];
  o.traverse((x) => {
    if ((x as Mesh).isMesh) out.push(x as Mesh);
  });
  return out;
}

/** Копия геометрии с float-атрибутами (в файле они квантованы — applyMatrix4 их бы обрезал). */
function floatGeometry(src: BufferGeometry): BufferGeometry {
  const g = new BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++)
      for (let j = 0; j < a.itemSize; j++) arr[i * a.itemSize + j] = a.getComponent(i, j);
    g.setAttribute(name, new Float32BufferAttribute(arr, a.itemSize));
  }
  if (src.index) g.setIndex(src.index.clone());
  return g;
}

function boxOf(list: readonly Object3D[]): Box3 {
  const b = new Box3();
  for (const o of list) b.expandByObject(o);
  return b;
}

/** Собрать машину из GLB. null — модели нет (или файл не того формата). */
export function buildGlbCarModel(spec: VehicleSpec, color: string): CarModel | null {
  const gltf = loaded.get(spec.id);
  if (!gltf) return null;
  const src = gltf.scene.clone(true);
  src.updateMatrixWorld(true);
  const node = (name: string): Object3D | undefined => src.children.find((c) => c.name === name);
  const bodyNode = node('body');
  const wheelSet = WHEEL_NODES.flatMap((w) => {
    const n = node(w.name);
    return n ? [{ ...w, node: n }] : [];
  });
  const covered = new Set(wheelSet.flatMap((w) => w.phys));
  if (!bodyNode || covered.size !== 4) return null;
  // Центр колеса — по шине (у передних колёс в узле ещё и тормозной механизм).
  const centers = wheelSet.map((w) => {
    const all = meshes(w.node);
    const tires = all.filter((m) => /tire/i.test((m.material as Material).name));
    return boxOf(tires.length ? tires : all).getCenter(new Vector3());
  });
  const axle = (rearAxle: boolean): Vector3 => {
    const list = centers.filter((_, i) => (wheelSet[i]?.phys[0] ?? 0) >= 2 === rearAxle);
    return list.reduce((a, c) => a.add(c), new Vector3()).multiplyScalar(1 / Math.max(1, list.length));
  };
  const front = axle(false);
  const rear = axle(true);
  const fwd = front.clone().sub(rear).setY(0);
  const k = spec.wheelbase / fwd.length();
  // Поворот вокруг Y: «вперёд» модели → −Z игры.
  const heading = Math.atan2(fwd.x, fwd.z);
  const pivot = new Group();
  pivot.rotation.y = Math.PI - heading;
  pivot.scale.setScalar(k);
  pivot.add(src);
  pivot.updateMatrixWorld(true);
  const mid = front.add(rear).multiplyScalar(0.5).applyMatrix4(pivot.matrixWorld);
  pivot.position.set(-mid.x, NOMINAL_WHEEL_Y - mid.y, -mid.z);
  pivot.updateMatrixWorld(true);

  // Краска игрока: «Paint 1…» — своя копия на машину; остальные материалы общие с исходником.
  const paints: MeshPhysicalMaterial[] = [];
  const paintCopies = new Map<Material, MeshPhysicalMaterial>();
  for (const m of meshes(src)) {
    const mat = m.material as Material;
    m.castShadow = !mat.transparent && !NO_SHADOW.test(mat.name);
    m.receiveShadow = true;
    if (!/^paint 1/i.test(mat.name)) continue;
    let p = paintCopies.get(mat);
    if (!p) {
      const base = mat as MeshStandardMaterial;
      p = (base as MeshPhysicalMaterial).isMeshPhysicalMaterial
        ? (base as MeshPhysicalMaterial).clone()
        : new MeshPhysicalMaterial().copy(base);
      p.color.set(color);
      p.clearcoat = 1;
      p.clearcoatRoughness = 0.04;
      p.roughness = 0.32;
      p.name = 'paint';
      paintCopies.set(mat, p);
      paints.push(p);
    }
    m.material = p;
  }

  // Колёса: каждый узел — группа с центром в оси (её крутит CarView).
  const root = new Group();
  const body = new Group();
  body.name = 'body';
  root.add(body);
  body.add(pivot);
  const wheels: GlbWheel[] = [];
  wheelSet.forEach((w, i) => {
    const center = (centers[i] as Vector3).clone().applyMatrix4(pivot.matrixWorld);
    const g = new Group();
    g.name = w.name;
    g.position.copy(center);
    g.updateMatrixWorld(true);
    const holder = new Group();
    holder.matrixAutoUpdate = false;
    // Геометрия колеса в системе группы: (мир модели) → минус центр.
    holder.matrix.copy(w.node.matrixWorld).premultiply(g.matrixWorld.clone().invert());
    for (const c of [...w.node.children]) holder.add(c);
    w.node.parent?.remove(w.node);
    g.add(holder);
    root.add(g);
    wheels.push({ group: g, x: center.x, z: center.z, phys: w.phys, steer: w.phys.every((p) => p < 2) });
  });
  const details: Object3D[] = [];
  for (const m of meshes(root)) {
    const name = (m.material as Material).name;
    if (DETAIL.test(name)) details.push(m);
  }

  const hood = node('hood') ?? null;
  const attached = new Set<PartName>(hood ? ['hood'] : []);
  const detach = (part: PartName): Mesh | null => {
    if (part !== 'hood' || !hood || !attached.has('hood')) return null;
    attached.delete('hood');
    // Обломок — слитая копия капота в системе машины.
    root.updateMatrixWorld(true);
    const inv = root.matrixWorld.clone().invert();
    const parts = meshes(hood);
    hood.visible = false;
    const first = parts.find((m) => paints.includes(m.material as MeshPhysicalMaterial)) ?? parts[0];
    if (!first) return null;
    const geo = floatGeometry(first.geometry).applyMatrix4(first.matrixWorld.clone().premultiply(inv));
    const copy = new Mesh(geo, paints[0] ?? first.material);
    copy.castShadow = true;
    return copy;
  };
  return {
    root,
    body,
    paint: paints[0] ?? new MeshPhysicalMaterial({ color }),
    paints,
    bodyOffsetY: 0,
    attached,
    detach,
    wheels,
  };
}
