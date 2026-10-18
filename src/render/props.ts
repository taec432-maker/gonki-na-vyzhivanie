import type { BufferGeometry } from 'three';
import {
  BoxGeometry,
  AdditiveBlending,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  MeshBasicMaterial,
  SRGBColorSpace,
  Vector3,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { headingOf, type Track } from '../tracks/track';
import type { PropDef } from '../tracks/types';
import { floorHeight } from '../physics/trackCollider';
import { GROUND_STYLES, groundTexture } from './textures';

/** Размещённый экземпляр пропа. */
export interface Placement {
  type: string;
  pos: Vector3;
  rot: number;
  scale: number;
  /** Индекс варианта (цвет контейнера и т. п.). */
  variant: number;
  breakable: boolean;
}

interface PropKind {
  geometry: BufferGeometry;
  material: Material;
  /** Цвета вариантов (instanceColor), если есть. */
  colors?: string[];
  /** Сдвиг по высоте, чтобы стоял на земле. */
  baseY: number;
  /** Отступ от дороги (м): ближе ставить нельзя. */
  clearance: number;
  castShadow: boolean;
  /** Штабелирование (контейнеры): высота одного яруса. */
  stackHeight?: number;
}

/** Нормал-карта гофры: из полос яркости делаем наклоны. */
function corrugatedNormal(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 8;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  for (let x = 0; x < 256; x++) {
    const slope = Math.cos((x / 256) * Math.PI * 2 * 24);
    const r = Math.round((slope * 0.7 * 0.5 + 0.5) * 255);
    ctx.fillStyle = `rgb(${r},128,${Math.round(Math.sqrt(1 - Math.min(1, slope * slope * 0.49)) * 127 + 128)})`;
    ctx.fillRect(x, 0, 1, 8);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

let kinds: Record<string, PropKind> | null = null;

/** Окна домов: днём — тёмные стёкла, ночью часть горит (emissiveMap). */
function windowsTexture(): { map: CanvasTexture; emissive: CanvasTexture } {
  const W = 256;
  const H = 256;
  const make = (lit: boolean): CanvasTexture => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = lit ? '#000' : '#d8d4cc';
    ctx.fillRect(0, 0, W, H);
    let seed = 13;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 6; x++) {
        const on = rnd() < 0.32;
        if (lit)
          ctx.fillStyle = on ? `rgb(255,${200 + Math.floor(rnd() * 40)},${130 + Math.floor(rnd() * 60)})` : '#000';
        else ctx.fillStyle = rnd() < 0.5 ? '#2b3440' : '#3a4654';
        ctx.fillRect(8 + x * 41, 10 + y * 62, 28, 40);
      }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  };
  return { map: make(false), emissive: make(true) };
}

/** Камень: икосаэдр с детерминированными вмятинами. */
function rockGeometry(r: number, seed: number): BufferGeometry {
  const g = new IcosahedronGeometry(r, 1);
  const pos = g.getAttribute('position');
  let s = seed;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const v = new Vector3();
  const bumps = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = bumps.get(key);
    if (k === undefined) {
      k = 0.75 + rnd() * 0.45;
      bumps.set(key, k);
    }
    v.multiplyScalar(k);
    v.y = v.y * 0.7;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function cactusGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(0.32, 0.38, 4.5, 10);
  trunk.translate(0, 2.25, 0);
  parts.push(trunk.toNonIndexed());
  for (const [x, y, h] of [
    [0.9, 2.2, 1.6],
    [-0.8, 2.8, 1.3],
  ] as const) {
    const arm = new CylinderGeometry(0.22, 0.24, h, 8);
    arm.translate(x, y + h / 2, 0);
    parts.push(arm.toNonIndexed());
    const link = new CylinderGeometry(0.2, 0.2, Math.abs(x), 8);
    link.rotateZ(Math.PI / 2);
    link.translate(x / 2, y, 0);
    parts.push(link.toNonIndexed());
  }
  const g = mergeGeometries(parts);
  if (!g) throw new Error('кактус');
  return g;
}

/** Ель: ствол и ярусы-конусы; цвет — в вершинах (снег на верхних гранях у снежной). */
function pineGeometry(snow: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const paint = (g: BufferGeometry, hex: string, snowTop: boolean): BufferGeometry => {
    const n = g.index ? g.toNonIndexed() : g;
    n.computeVertexNormals();
    const c = new Color(hex);
    const w = new Color('#eef3f8');
    const nor = n.getAttribute('normal');
    const arr = new Float32Array(nor.count * 3);
    for (let i = 0; i < nor.count; i++) {
      const col = snowTop && nor.getY(i) > 0.45 ? w : c;
      arr.set([col.r, col.g, col.b], i * 3);
    }
    n.setAttribute('color', new Float32BufferAttribute(arr, 3));
    return n;
  };
  const trunk = new CylinderGeometry(0.22, 0.32, 3, 7);
  trunk.translate(0, 1.5, 0);
  parts.push(paint(trunk, '#4a3526', false));
  for (let i = 0; i < 4; i++) {
    const r = 2.6 - i * 0.55;
    const cone = new ConeGeometry(r, 3.2, 9);
    cone.translate(0, 3.2 + i * 2.1, 0);
    parts.push(paint(cone, i % 2 ? '#24452c' : '#2b5234', snow));
  }
  const g = mergeGeometries(parts);
  if (!g) throw new Error('ель');
  return g;
}

function buildKinds(): Record<string, PropKind> {
  const corrN = corrugatedNormal();
  const concrete = groundTexture('concrete', GROUND_STYLES.concrete as NonNullable<(typeof GROUND_STYLES)['concrete']>);

  // Контейнер 40 футов: 12.2 × 2.6 × 2.44.
  const container = new BoxGeometry(2.44, 2.6, 12.2);
  const containerMat = new MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.55,
    metalness: 0.35,
    normalMap: corrN,
  });
  containerMat.normalMap?.repeat.set(1, 1);

  // Портальный кран: ноги, балка, стрела, кабина.
  const parts: BufferGeometry[] = [];
  const add = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
    const g = new BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(g.toNonIndexed());
  };
  for (const x of [-9, 9]) for (const z of [-7, 7]) add(1.2, 30, 1.2, x, 15, z);
  add(20, 1.4, 1.4, 0, 30, -7);
  add(20, 1.4, 1.4, 0, 30, 7);
  add(2.4, 2.4, 70, 0, 32, -12);
  add(5, 4, 6, 0, 34, 8);
  for (const x of [-9, 9]) add(1, 1, 14, x, 6, 0);
  add(1.8, 2.4, 2.6, 0, 29.5, -26);
  const crane = mergeGeometries(parts);
  if (!crane) throw new Error('кран');
  const craneMat = new MeshStandardMaterial({ color: '#d9a21b', roughness: 0.5, metalness: 0.6 });

  // Склад: бетонный цоколь + гофрированные стены + двускатная крыша (упрощённо — плоская с бортиком).
  const wh: BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry => {
    const g = new BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g.toNonIndexed();
  };
  wh.push(box(40, 11, 24, 0, 5.5, 0));
  wh.push(box(40.6, 0.8, 24.6, 0, 11.2, 0));
  for (let i = -2; i <= 2; i++) wh.push(box(6, 6, 0.3, i * 8, 3, 12.1));
  const warehouse = mergeGeometries(wh);
  if (!warehouse) throw new Error('склад');
  const warehouseMat = new MeshStandardMaterial({ color: '#9aa3ab', roughness: 0.6, metalness: 0.4, normalMap: corrN });

  const barrel = new CylinderGeometry(0.3, 0.3, 0.9, 16);
  const barrelMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.5 });

  // Фонарный столб: столб + консоль + светильник (светится ночью через emissive).
  const lp: BufferGeometry[] = [];
  const pole = new CylinderGeometry(0.12, 0.16, 10, 8);
  pole.translate(0, 5, 0);
  lp.push(pole.toNonIndexed());
  lp.push(box(0.12, 0.12, 2.2, 0, 9.9, -1.1));
  lp.push(box(0.5, 0.18, 0.9, 0, 9.8, -2.2));
  const lamp = mergeGeometries(lp);
  if (!lamp) throw new Error('фонарь');
  const lampMat = new MeshStandardMaterial({ color: '#5b6066', roughness: 0.5, metalness: 0.7, emissive: '#000000' });

  const bollard = new CylinderGeometry(0.25, 0.32, 0.8, 10);
  const bollardMat = new MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.6, metalness: 0.6 });

  const block = new BoxGeometry(4, 1.2, 1.2);
  const blockMat = new MeshStandardMaterial({ map: concrete.map, normalMap: concrete.normalMap, roughness: 0.9 });

  // Навес склада над шорткатом «Порта»: крыша на столбах, торцы открыты.
  const sh: BufferGeometry[] = [];
  sh.push(box(18, 0.6, 36, 0, 7.2, 0));
  for (const x of [-8.6, 8.6]) for (const z of [-17, -8.5, 0, 8.5, 17]) sh.push(box(0.6, 7, 0.6, x, 3.5, z));
  for (const x of [-8.9, 8.9]) sh.push(box(0.2, 3.6, 36, x, 5.4, 0));
  const shed = mergeGeometries(sh);
  if (!shed) throw new Error('навес');

  // Дом: этаж-блок 18 × 12 × 18 с окнами (ночью окна светятся — emissiveMap).
  const building = new BoxGeometry(18, 12, 18);
  const win = windowsTexture();
  const buildingMat = new MeshStandardMaterial({
    color: '#ffffff',
    map: win.map,
    emissiveMap: win.emissive,
    emissive: '#ffd9a0',
    emissiveIntensity: 0,
    roughness: 0.75,
    metalness: 0.2,
  });

  // Неоновая вывеска: светится сама (цвет — instanceColor, яркость > 1 для bloom).
  const neon = new BoxGeometry(6, 1.6, 0.3);
  const neonMat = new MeshBasicMaterial({ color: new Color(3.2, 3.2, 3.2), toneMapped: true });

  const rock = rockGeometry(1, 7);
  const rockMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true });

  const cactus = cactusGeometry();
  const cactusMat = new MeshStandardMaterial({ color: '#4f7d3a', roughness: 0.8 });

  const pine = pineGeometry(false);
  const snowPine = pineGeometry(true);
  const pineMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });

  return {
    shed: { geometry: shed, material: warehouseMat, baseY: 0, clearance: 0, castShadow: true },
    building: {
      geometry: building,
      material: buildingMat,
      colors: ['#8a8f99', '#6f6a66', '#9c8f7e', '#596270', '#7c7470', '#a59a8c'],
      baseY: 6,
      clearance: 10,
      castShadow: true,
      stackHeight: 12,
    },
    neon: {
      geometry: neon,
      material: neonMat,
      colors: ['#ff2e9a', '#2ee6ff', '#b14bff', '#ffe02e', '#2eff8a', '#ff5a2e'],
      baseY: 5,
      clearance: 1,
      castShadow: false,
    },
    rock: {
      geometry: rock,
      material: rockMat,
      colors: ['#a0714a', '#8c5f3d', '#b4865c', '#7d6650'],
      baseY: 0.2,
      clearance: 4,
      castShadow: true,
    },
    greyrock: {
      geometry: rock,
      material: rockMat,
      colors: ['#7b7a76', '#6a6966', '#8c8a84', '#5e5d5a'],
      baseY: 0.2,
      clearance: 4,
      castShadow: true,
    },
    cactus: { geometry: cactus, material: cactusMat, baseY: 0, clearance: 1.5, castShadow: true },
    pine: { geometry: pine, material: pineMat, baseY: 0, clearance: 3, castShadow: true },
    snowpine: { geometry: snowPine, material: pineMat, baseY: 0, clearance: 3, castShadow: true },
    container: {
      geometry: container,
      material: containerMat,
      colors: ['#a3241a', '#1c4f8f', '#2f7d32', '#d86b12', '#7a7f85', '#1b7f86', '#c9a227', '#5a2d82'],
      baseY: 1.3,
      clearance: 3,
      castShadow: true,
      stackHeight: 2.6,
    },
    crane: { geometry: crane, material: craneMat, baseY: 0, clearance: 14, castShadow: true },
    warehouse: { geometry: warehouse, material: warehouseMat, baseY: 0, clearance: 13, castShadow: true },
    barrel: {
      geometry: barrel,
      material: barrelMat,
      colors: ['#1d4fa3', '#b2221b', '#d6a514', '#2a6e3a'],
      baseY: 0.45,
      clearance: 0.5,
      castShadow: true,
    },
    lamp: { geometry: lamp, material: lampMat, baseY: 0, clearance: 0.6, castShadow: true },
    bollard: { geometry: bollard, material: bollardMat, baseY: 0.4, clearance: 0.5, castShadow: false },
    block: { geometry: block, material: blockMat, baseY: 0.6, clearance: 1, castShadow: true },
  };
}

/** Пятна света от фонарей на асфальте (ночью): аддитивные круги, один draw call. */
function lightPools(lamps: readonly Placement[]): InstancedMesh {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,214,150,0.85)');
  g.addColorStop(0.5, 'rgba(255,190,120,0.3)');
  g.addColorStop(1, 'rgba(255,180,110,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  const geo = new PlaneGeometry(14, 14);
  geo.rotateX(-Math.PI / 2);
  const mat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });
  const mesh = new InstancedMesh(geo, mat, Math.max(1, lamps.length));
  const d = new Object3D();
  lamps.forEach((p, i) => {
    // Светильник на консоли — в 2,2 м от столба (как в геометрии фонаря).
    d.position.set(
      p.pos.x + Math.sin(p.rot) * 2.2 * p.scale,
      p.pos.y + 0.06,
      p.pos.z - Math.cos(p.rot) * 2.2 * p.scale,
    );
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  });
  mesh.count = lamps.length;
  mesh.renderOrder = 1;
  mesh.name = 'light-pools';
  return mesh;
}

/** Детерминированная раскладка пропов по описанию трассы. */
export function placeProps(track: Track, defs: readonly PropDef[], clearanceOf: (type: string) => number): Placement[] {
  const rng = track.rng.fork('props');
  const out: Placement[] = [];
  const path = track.path;
  const wallOff = (s: number): number => path.widthAt(s) / 2 + track.def.shoulder.width + track.def.walls.offset;
  /** Не ставим на дорогу (в том числе на другой её участок). */
  const free = (p: Vector3, clearance: number): boolean => {
    const pr = path.project(p.x, p.y, p.z);
    if (Math.abs(pr.d) <= wallOff(pr.s) + clearance - 0.01) return false;
    // И не на шорткате.
    for (const sc of track.shortcuts) {
      const dc = track.shortcutD(sc, pr.s);
      if (dc !== null && Math.abs(pr.d - dc) < sc.width / 2 + track.def.walls.offset + clearance) return false;
    }
    return true;
  };
  for (const def of defs) {
    const jitter = def.jitter ?? 0;
    const clearance = clearanceOf(def.type);
    if (def.at !== undefined) {
      const s = track.sFromFrac(def.at);
      const pos = path.pointAt(s, def.d ?? 0);
      pos.y = floorHeight(track, s, 0);
      out.push({
        type: def.type,
        pos,
        rot: headingOf(path.tangentAt(s)) + (def.rot ?? 0),
        scale: def.scale ?? 1,
        variant: rng.int(0, 7),
        breakable: !!def.breakable,
      });
      continue;
    }
    const span = def.span ?? { from: 0, to: 1 };
    const every = def.every ?? 20;
    const len = track.path.wrapS((span.to - span.from) * track.length) || track.length;
    const sides = def.side === undefined || def.side === 0 ? [-1, 1] : [def.side];
    const rows = def.rows ?? 1;
    for (let k = 0; k * every < len; k++) {
      const s = track.sFromFrac(span.from) + k * every;
      for (const side of sides) {
        for (let r = 0; r < rows; r++) {
          const off =
            side *
            (wallOff(s) +
              Math.max(def.d ?? 2, clearance) +
              r * (def.type === 'container' ? 3.2 : every * 0.8) +
              rng.range(-jitter, jitter) * 0.3);
          const pos = path.pointAt(s + rng.range(-jitter, jitter), off);
          const baseS = path.wrapS(s);
          pos.y = path.pointAt(baseS, 0).y;
          if (!free(pos, clearance)) continue;
          out.push({
            type: def.type,
            pos,
            rot: headingOf(path.tangentAt(s)) + (def.rot ?? 0) + rng.range(-0.04, 0.04) * (jitter > 0 ? 1 : 0),
            scale: (def.scale ?? 1) * (jitter > 0 ? rng.range(0.92, 1.08) : 1),
            variant: rng.int(0, 7),
            breakable: !!def.breakable,
          });
        }
      }
    }
  }
  return out;
}

export interface PropsVisual {
  group: Group;
  placements: Placement[];
  lampMaterial: MeshStandardMaterial;
}

/** Все пропы трассы — один InstancedMesh на тип (единицы draw calls). */
export function buildProps(track: Track, night = false): PropsVisual {
  kinds ??= buildKinds();
  const K = kinds;
  const group = new Group();
  group.name = 'props';
  const placements = placeProps(track, track.def.props ?? [], (t) => K[t]?.clearance ?? 2);
  // Ночью горят фонари и окна домов.
  const lampMat = K.lamp?.material as MeshStandardMaterial;
  lampMat.emissive.set(night ? '#ffd29a' : '#000000');
  lampMat.emissiveIntensity = night ? 2.5 : 0;
  (K.building?.material as MeshStandardMaterial).emissiveIntensity = night ? 0.85 : 0;
  const byType = new Map<string, Placement[]>();
  for (const p of placements) {
    const list = byType.get(p.type) ?? [];
    list.push(p);
    byType.set(p.type, list);
  }
  const dummy = new Object3D();
  const color = new Color();
  for (const [type, list] of byType) {
    const kind = K[type];
    if (!kind) continue;
    // Контейнеры штабелируем: 1–4 яруса.
    const expanded: { p: Placement; level: number }[] = [];
    const rng = track.rng.fork(`stack-${type}`);
    for (const p of list) {
      const levels = kind.stackHeight ? rng.int(1, 4) : 1;
      for (let l = 0; l < levels; l++) expanded.push({ p, level: l });
    }
    const mesh = new InstancedMesh(kind.geometry, kind.material, expanded.length);
    expanded.forEach(({ p, level }, i) => {
      dummy.position.set(p.pos.x, p.pos.y + kind.baseY * p.scale + level * (kind.stackHeight ?? 0), p.pos.z);
      dummy.rotation.set(0, -p.rot + (level % 2 ? 0.02 : 0), 0);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (kind.colors)
        mesh.setColorAt(i, color.set(kind.colors[(p.variant + level * 3) % kind.colors.length] as string));
    });
    mesh.castShadow = kind.castShadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = `props-${type}`;
    group.add(mesh);
  }
  // Области: вода и площадки.
  for (const a of track.def.areas ?? []) {
    const [x0, z0, x1, z1] = a.rect;
    const w = Math.abs(x1 - x0);
    const d = Math.abs(z1 - z0);
    const geo = new PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    let mat: Material;
    if (a.type === 'water') {
      mat = new MeshStandardMaterial({ color: '#0d2a3a', roughness: 0.06, metalness: 0.1, envMapIntensity: 1.2 });
    } else {
      const st = GROUND_STYLES[a.style ?? 'concrete'] ?? GROUND_STYLES.concrete;
      const set = groundTexture(a.style ?? 'concrete', st as NonNullable<typeof st>);
      const m = new MeshStandardMaterial({
        map: set.map.clone(),
        normalMap: set.normalMap.clone(),
        roughnessMap: set.roughnessMap.clone(),
        roughness: 1,
      });
      for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t) t.repeat.set(w / 8, d / 8);
      mat = m;
    }
    const m = new Mesh(geo, mat);
    m.position.set((x0 + x1) / 2, a.y, (z0 + z1) / 2);
    m.receiveShadow = true;
    group.add(m);
  }
  if (night) group.add(lightPools(placements.filter((p) => p.type === 'lamp')));
  return { group, placements, lampMaterial: lampMat };
}
