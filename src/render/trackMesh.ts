import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type Material,
} from 'three';
import { floorSection, jumpOffset, wallLines, type WallLine } from '../physics/trackCollider';
import type { Track } from '../tracks/track';
import { GROUND_STYLES, groundTexture, roadTexture, type GroundStyle } from './textures';

/**
 * Лента вдоль трассы между смещениями d0..d1 (с учётом крена и трамплинов).
 * uv: u — поперёк (в долях или метрах), v — вдоль (метры / vScale).
 */
export function ribbon(
  track: Track,
  d0: (s: number) => number,
  d1: (s: number) => number,
  opts: { cols?: number; lift?: number; vScale?: number; uMeters?: number; include?: (s: number) => boolean } = {},
): BufferGeometry {
  const path = track.path;
  const n = path.samples.length;
  const cols = opts.cols ?? 2;
  const lift = opts.lift ?? 0;
  const vScale = opts.vScale ?? 16;
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const p = new Vector3();
  for (let i = 0; i <= n; i++) {
    const s = i === n ? path.length : (path.sample(i).s as number);
    const a = d0(s);
    const b = d1(s);
    const jy = jumpOffset(track, s);
    for (let c = 0; c < cols; c++) {
      const t = c / (cols - 1);
      const d = a + (b - a) * t;
      path.pointAt(s, d, p);
      pos.push(p.x, p.y + jy + lift, p.z);
      uv.push(opts.uMeters ? (d - a) / opts.uMeters : t, s / vScale);
    }
  }
  for (let i = 0; i < n; i++) {
    const sMid = path.sample(i).s + path.step / 2;
    if (opts.include && !opts.include(sMid)) continue;
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      const b = a + 1;
      const cc = a + cols;
      const d = cc + 1;
      index.push(a, b, cc, b, d, cc);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function pbrMaterial(key: string, repeat: number, style?: GroundStyle): MeshStandardMaterial {
  const st = style ?? (GROUND_STYLES[key] as GroundStyle);
  const set = groundTexture(key, st);
  const m = new MeshStandardMaterial({
    map: set.map.clone(),
    roughnessMap: set.roughnessMap.clone(),
    normalMap: set.normalMap.clone(),
    metalness: 0,
    roughness: 1,
  });
  for (const t of [m.map, m.roughnessMap, m.normalMap]) {
    if (!t) continue;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.needsUpdate = true;
  }
  return m;
}

/** Бордюр (поребрик) — красно-белые полосы. */
function kerbMaterial(): MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? '#e8e8e8' : '#c21d1d';
    ctx.fillRect(0, i * 64, 64, 64);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return new MeshStandardMaterial({ map: t, roughness: 0.6 });
}

function checkerMaterial(): MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#eee';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return new MeshStandardMaterial({ map: t, roughness: 0.7 });
}

/** Отбойник: профиль «нью-джерси» вдоль линии (край трассы или шортката). */
function wallGeometry(track: Track, line: WallLine): BufferGeometry {
  const side = line.outward;
  const path = track.path;
  const h = track.def.walls.height;
  // Профиль поперёк: (смещение наружу, высота).
  const prof: [number, number][] = [
    [0, -0.3],
    [0, 0.08],
    [0.12, 0.3],
    [0.18, h],
    [0.42, h],
    [0.48, 0.3],
    [0.6, 0.08],
    [0.6, -0.3],
  ];
  const n = path.samples.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const p = new Vector3();
  for (let i = 0; i <= n; i++) {
    const s = i === n ? path.length : path.sample(i).s;
    const base = line.offset(s);
    const jy = jumpOffset(track, s);
    for (let k = 0; k < prof.length; k++) {
      const [o, y] = prof[k] as [number, number];
      path.pointAt(s, base + o * side, p);
      pos.push(p.x, p.y + jy + y, p.z);
      uv.push(k / (prof.length - 1), s / 4);
    }
  }
  const P = prof.length;
  for (let i = 0; i < n; i++) {
    const sMid = path.sample(i).s + path.step / 2;
    if (!line.include(sMid)) continue;
    for (let k = 0; k < P - 1; k++) {
      const a = i * P + k;
      const b = a + 1;
      const c = a + P;
      const d = c + 1;
      if (side > 0) index.push(a, c, b, b, c, d);
      else index.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

export interface TrackVisual {
  group: Group;
  roadMaterial: MeshStandardMaterial;
  materials: Material[];
  /** Что намокает под дождём: асфальт, поребрики, бетон вокруг (см. wet.ts). */
  wetMaterials: MeshStandardMaterial[];
}

export function buildTrackVisual(track: Track): TrackVisual {
  const group = new Group();
  group.name = 'track';
  const def = track.def;
  const half = (s: number): number => track.path.widthAt(s) / 2;
  const edge = (s: number): number => {
    const sec = floorSection(track, s);
    return sec[sec.length - 1] as number;
  };

  const roadSet = roadTexture(
    def.surface === 'asphalt' || def.surface === 'wet' ? def.surface : def.surface,
    def.surface === 'asphalt' || def.surface === 'wet',
  );
  const roadMaterial = new MeshStandardMaterial({
    map: roadSet.map,
    roughnessMap: roadSet.roughnessMap,
    normalMap: roadSet.normalMap,
    roughness: 1,
    metalness: 0,
  });
  const road = new Mesh(
    ribbon(
      track,
      (s) => -half(s),
      (s) => half(s),
      { cols: 5, lift: 0.01 },
    ),
    roadMaterial,
  );
  road.receiveShadow = true;
  road.name = 'road';
  group.add(road);

  // Участки другого покрытия поверх основной дороги.
  const materials: Material[] = [roadMaterial];
  for (const z of def.zones ?? []) {
    const zs = roadTexture(z.surface, false);
    const m = new MeshStandardMaterial({
      map: zs.map,
      roughnessMap: zs.roughnessMap,
      normalMap: zs.normalMap,
      roughness: 1,
    });
    materials.push(m);
    const zone = new Mesh(
      ribbon(
        track,
        (s) => -half(s),
        (s) => half(s),
        {
          cols: 5,
          lift: 0.02,
          include: (s) => track.inSpan(track.fracFromStart(s), z.from, z.to),
        },
      ),
      m,
    );
    zone.receiveShadow = true;
    group.add(zone);
  }

  const shoulderMat = pbrMaterial(def.shoulder.surface === 'grass' ? 'grass' : def.shoulder.surface, 1);
  materials.push(shoulderMat);
  for (const side of [-1, 1] as const) {
    const g = ribbon(
      track,
      (s) => (side < 0 ? -edge(s) : half(s)),
      (s) => (side < 0 ? -half(s) : edge(s)),
      { cols: 3, lift: 0.0, vScale: 8, uMeters: 8 },
    );
    const m = new Mesh(g, shoulderMat);
    m.receiveShadow = true;
    group.add(m);
  }

  // Поребрики в поворотах.
  const kerb = kerbMaterial();
  materials.push(kerb);
  const inCorner = (s: number): boolean => Math.abs(track.path.curvatureAt(s)) > 0.012;
  for (const side of [-1, 1] as const) {
    const g = ribbon(
      track,
      (s) => (side < 0 ? -half(s) - 0.9 : half(s) - 0.15),
      (s) => (side < 0 ? -half(s) + 0.15 : half(s) + 0.9),
      { cols: 2, lift: 0.03, vScale: 4, include: inCorner },
    );
    const m = new Mesh(g, kerb);
    m.receiveShadow = true;
    group.add(m);
  }

  // Линия старта.
  const checker = checkerMaterial();
  materials.push(checker);
  const s0 = track.startS;
  const startLine = new Mesh(
    ribbon(
      track,
      (s) => -half(s),
      (s) => half(s),
      {
        cols: 2,
        lift: 0.025,
        vScale: 2,
        include: (s) => Math.abs(track.path.deltaS(s0, s)) < 1.2,
      },
    ),
    checker,
  );
  startLine.receiveShadow = true;
  group.add(startLine);

  // Отбойники.
  const wallMat = pbrMaterial('concrete', 1);
  materials.push(wallMat);
  for (const line of wallLines(track)) {
    const w = new Mesh(wallGeometry(track, line), wallMat);
    w.castShadow = true;
    w.receiveShadow = true;
    group.add(w);
  }

  // Шорткаты: своё полотно (обычно грунт) между своими отбойниками.
  for (const sc of track.shortcuts) {
    const dc = (s: number): number => track.shortcutD(sc, s) ?? 0;
    const mat = pbrMaterial(sc.surface === 'asphalt' ? 'asphalt' : sc.surface, 1);
    materials.push(mat);
    const m = new Mesh(
      ribbon(
        track,
        (s) => dc(s) - sc.width / 2,
        (s) => dc(s) + sc.width / 2,
        { cols: 3, lift: 0.03, uMeters: 4, vScale: 4, include: (s) => track.shortcutD(sc, s) !== null },
      ),
      mat,
    );
    m.receiveShadow = true;
    group.add(m);
  }

  // Земля вокруг.
  let minY = Infinity;
  let cx = 0;
  let cz = 0;
  for (const sm of track.path.samples) {
    minY = Math.min(minY, sm.pos.y);
    cx += sm.pos.x;
    cz += sm.pos.z;
  }
  cx /= track.path.samples.length;
  cz /= track.path.samples.length;
  const groundKey = def.ground ?? (def.shoulder.surface === 'grass' ? 'grass' : def.shoulder.surface);
  const groundMat = pbrMaterial(groundKey, 120);
  if (def.groundColor) groundMat.color.set(def.groundColor).multiplyScalar(1.6);
  materials.push(groundMat);
  const ground = new Mesh(new PlaneGeometry(3000, 3000), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, minY + (def.groundOffset ?? -0.08), cz);
  ground.receiveShadow = true;
  group.add(ground);

  const wetMaterials = [roadMaterial, kerb, checker, ...(groundKey === 'concrete' ? [groundMat] : [])];
  return { group, roadMaterial, materials, wetMaterials };
}
