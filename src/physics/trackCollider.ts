import type RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { Track } from '../tracks/track';
import { RAPIER as R, FLOOR_GROUPS, WALL_GROUPS } from './world';

export interface TrackColliders {
  floor: RAPIER.Collider;
  walls: RAPIER.Collider[];
  ground: RAPIER.Collider;
  /** Handle'ы коллайдеров стен — для урона от стен. */
  wallHandles: Set<number>;
}

/** Поперечное сечение полотна: смещения от центра для вершин ленты. */
export function floorSection(track: Track, s: number): number[] {
  const half = track.path.widthAt(s) / 2;
  const edge = half + track.def.shoulder.width + track.def.walls.offset + 1.5;
  return [-edge, -half, -half * 0.5, 0, half * 0.5, half, edge];
}

/** Признак: в этой точке стены нет (обрыв, переулок); side — с какой стороны (без side — с обеих). */
export function wallGapAt(track: Track, s: number, side?: 1 | -1): boolean {
  const f = track.fracFromStart(s);
  return (track.def.walls.gaps ?? []).some(
    (g) => (g.side === undefined || side === undefined || g.side === side) && track.inSpan(f, g.from, g.to),
  );
}

/** Линия отбойника: смещение от центра, где она есть, и «наружу» (куда смотрит профиль). */
export interface WallLine {
  offset: (s: number) => number;
  include: (s: number) => boolean;
  outward: 1 | -1;
}

/**
 * Все отбойники трассы: два основных и внешний у каждого шортката. Где объезд
 * сливается с дорогой, основной отбойник прерывается. Внутреннего отбойника у объезда нет:
 * его торец у слияния — ловушка для машин, а середину объезда от дороги и так отделяет основной.
 */
export function wallLines(track: Track): WallLine[] {
  const lines: WallLine[] = [];
  const merged = (s: number, side: 1 | -1): boolean =>
    track.shortcuts.some((sc) => {
      if (sc.side !== side) return false;
      // Основной отбойник прерывается на всём съезде и въезде (до «полки» объезда):
      // иначе его торец оказывается на пути машин, срезающих поворот объезда.
      const u = track.shortcutU(sc, s);
      return u !== null && (u < 0.42 || u > 0.58);
    });
  for (const side of [-1, 1] as const)
    lines.push({
      offset: (s) => track.wallOffset(s) * side,
      include: (s) => !wallGapAt(track, s, side) && !merged(s, side),
      outward: side,
    });
  for (const sc of track.shortcuts) {
    const dc = (s: number): number => track.shortcutD(sc, s) ?? 0;
    const inside = (s: number): boolean => track.shortcutD(sc, s) !== null;
    lines.push({
      offset: (s) => dc(s) + (sc.side * sc.width) / 2,
      // Внешний отбойник начинается чуть дальше края дороги: у слияния не торчит торцом в полосу.
      include: (s) => inside(s) && Math.abs(dc(s)) + sc.width / 2 > track.wallOffset(s) + 4,
      outward: sc.side,
    });
  }
  return lines;
}

/** Высота полотна в точке (s, d) — с учётом трамплинов. Должна совпадать с визуальной сеткой. */
export function floorHeight(track: Track, s: number, d: number): number {
  const base = track.path.pointAt(s, d).y;
  return base + jumpOffset(track, s);
}

/** Подъём полотна на трамплинах: плавный разгон и резкий край. */
export function jumpOffset(track: Track, s: number): number {
  let y = 0;
  for (const j of track.def.jumps ?? []) {
    const at = track.sFromFrac(j.at);
    const before = track.path.deltaS(s, at); // >0 — трамплин впереди
    if (before >= 0 && before <= j.length) {
      const t = 1 - before / j.length;
      y += j.height * t * t;
    }
  }
  return y;
}

export function buildTrackColliders(world: RAPIER.World, track: Track): TrackColliders {
  const path = track.path;
  const n = path.samples.length;
  const cols = floorSection(track, 0).length;
  const vertices = new Float32Array(n * cols * 3);
  const p = new Vector3();
  for (let i = 0; i < n; i++) {
    const s = path.sample(i).s;
    const sec = floorSection(track, s);
    for (let c = 0; c < cols; c++) {
      const d = sec[c] as number;
      path.pointAt(s, d, p);
      const k = (i * cols + c) * 3;
      vertices[k] = p.x;
      vertices[k + 1] = p.y + jumpOffset(track, s);
      vertices[k + 2] = p.z;
    }
  }
  const indices = new Uint32Array(n * (cols - 1) * 6);
  let t = 0;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    // Обрыв за трамплином: не соединяем край трамплина с полотном за ним (там «расщелина»).
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      const b = i * cols + c + 1;
      const cc = i2 * cols + c;
      const d = i2 * cols + c + 1;
      indices[t++] = a;
      indices[t++] = b;
      indices[t++] = cc;
      indices[t++] = b;
      indices[t++] = d;
      indices[t++] = cc;
    }
  }
  const floorDesc = R.ColliderDesc.trimesh(vertices, indices.subarray(0, t))
    .setCollisionGroups(FLOOR_GROUPS)
    .setFriction(1.0);
  const floor = world.createCollider(floorDesc);

  // Земля под всем — чтобы улетевшая машина не падала вечно.
  let minY = Infinity;
  for (const sm of path.samples) minY = Math.min(minY, sm.pos.y);
  const groundY = minY + (track.def.groundOffset ?? -0.08) - 0.5;
  const ground = world.createCollider(
    R.ColliderDesc.cuboid(4000, 0.5, 4000)
      .setTranslation(0, groundY, 0)
      .setCollisionGroups(FLOOR_GROUPS)
      .setFriction(0.8),
  );

  // Стены — короткие тонкие брусья вдоль обоих краёв.
  const walls: RAPIER.Collider[] = [];
  const wallHandles = new Set<number>();
  const h = track.def.walls.height;
  const segLen = 3;
  const segs = Math.ceil(path.length / segLen);
  const a = new Vector3();
  const b = new Vector3();
  const q = new Quaternion();
  const yAxis = new Vector3(0, 1, 0);
  const lines = wallLines(track);
  for (let k = 0; k < segs; k++) {
    const s0 = k * segLen;
    const s1 = Math.min(path.length, s0 + segLen);
    const sm = (s0 + s1) / 2;
    for (const line of lines) {
      if (!line.include(sm)) continue;
      const side = line.outward;
      path.pointAt(s0, line.offset(s0), a);
      path.pointAt(s1, line.offset(s1), b);
      const len = a.distanceTo(b);
      if (len < 0.01) continue;
      const cx = (a.x + b.x) / 2;
      const cz = (a.z + b.z) / 2;
      const cy = Math.min(a.y, b.y) + jumpOffset(track, sm) + h / 2 - 0.3;
      const heading = Math.atan2(b.x - a.x, -(b.z - a.z));
      q.setFromAxisAngle(yAxis, -heading);
      const thick = 0.5;
      const desc = R.ColliderDesc.cuboid(thick / 2, h / 2 + 0.3, len / 2 + 0.15)
        .setTranslation(cx + side * thick * 0.5 * Math.cos(heading), cy, cz + side * thick * 0.5 * Math.sin(heading))
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCollisionGroups(WALL_GROUPS)
        .setFriction(0.15)
        .setRestitution(0.2);
      const col = world.createCollider(desc);
      walls.push(col);
      wallHandles.add(col.handle);
    }
  }
  // Полотно шорткатов — отдельные ленты.
  for (const sc of track.shortcuts) {
    const verts: number[] = [];
    const idx: number[] = [];
    const len = path.deltaS(sc.fromS, sc.toS);
    const steps = Math.ceil(len / 2);
    for (let i = 0; i <= steps; i++) {
      const sv = path.wrapS(sc.fromS + (len * i) / steps);
      const dc = track.shortcutD(sc, sv) ?? 0;
      for (const o of [-1, 0, 1]) {
        path.pointAt(sv, dc + (o * sc.width) / 2, a);
        verts.push(a.x, a.y + jumpOffset(track, sv) + 0.01, a.z);
      }
      if (i < steps)
        for (let c = 0; c < 2; c++) {
          const v = i * 3 + c;
          idx.push(v, v + 1, v + 3, v + 1, v + 4, v + 3);
        }
    }
    world.createCollider(
      R.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx))
        .setCollisionGroups(FLOOR_GROUPS)
        .setFriction(1.0),
    );
  }
  return { floor, walls, ground, wallHandles };
}
