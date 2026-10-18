import type RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { Lure } from '../ai/pilot';
import { floorHeight } from '../physics/trackCollider';
import { RAPIER as R, GROUP, PROP_GROUPS, groups } from '../physics/world';
import { headingOf, type Track } from '../tracks/track';
import type { BreakableType } from '../tracks/types';

/**
 * Особенности трассы (раздел 9 ТЗ), которые влияют на гонку: телепорты (вход → выход),
 * зоны ускорения и разрушаемые препятствия (бочки, конусы, рекламные щиты — тела физики).
 * Всё — из JSON трассы и детерминированно.
 */
export interface Portal {
  index: number;
  fromS: number;
  toS: number;
  d: number;
  halfWidth: number;
}

export interface BoostZone {
  fromS: number;
  toS: number;
  d: number;
  halfWidth: number;
}

export interface Breakable {
  id: number;
  type: BreakableType;
  body: RAPIER.RigidBody;
  handle: number;
  /** Сбит (сдвинулся от места) — для статистики и звука. */
  knocked: boolean;
  /** Шаг, когда сбит; через четверть секунды предмет перестаёт сталкиваться с машинами. */
  knockedAt: number;
  harmless: boolean;
  collider: RAPIER.Collider;
  home: Vector3;
}

/** Сбитый предмет: лежит на земле и у стен, но машины проезжают сквозь (не застревают на нём). */
const LYING_GROUPS = groups(GROUP.PROP, GROUP.FLOOR | GROUP.WALL);

/** Размеры разрушаемых (полуразмеры коллайдера) и масса, кг. */
export const BREAKABLE_SIZE: Record<BreakableType, { hx: number; hy: number; hz: number; mass: number }> = {
  barrel: { hx: 0.3, hy: 0.45, hz: 0.3, mass: 35 },
  cone: { hx: 0.2, hy: 0.36, hz: 0.2, mass: 6 },
  billboard: { hx: 1.6, hy: 1.1, hz: 0.08, mass: 60 },
  crate: { hx: 0.5, hy: 0.5, hz: 0.5, mass: 40 },
};

export class TrackFeatures {
  readonly portals: Portal[] = [];
  readonly boosts: BoostZone[] = [];
  readonly lures: Lure[] = [];
  readonly breakables: Breakable[] = [];
  private readonly byHandle = new Map<number, Breakable>();
  private readonly track: Track;

  constructor(world: RAPIER.World, track: Track) {
    this.track = track;
    const def = track.def;
    (def.teleports ?? []).forEach((t, index) => {
      const fromS = track.sFromFrac(t.from);
      this.portals.push({ index, fromS, toS: track.sFromFrac(t.to), d: t.d, halfWidth: t.halfWidth });
      // Приманка для ИИ: часть ботов целится во вход телепорта.
      this.lures.push({ id: 900 + index, s: fromS, d: t.d, chance: 0.45, fromS: fromS - 70, toS: fromS + 2 });
    });
    for (const sc of track.shortcuts)
      this.lures.push({
        id: 950 + sc.index,
        s: sc.fromS,
        d: 0,
        chance: sc.chance,
        fromS: track.path.wrapS(sc.fromS - 15),
        toS: sc.toS,
        offsetAt: (s) => track.shortcutD(sc, s) ?? 0,
      });
    for (const b of def.boosts ?? [])
      this.boosts.push({ fromS: track.sFromFrac(b.from), toS: track.sFromFrac(b.to), d: b.d, halfWidth: b.halfWidth });
    let id = 1;
    const q = new Quaternion();
    for (const g of def.breakables ?? []) {
      for (let i = 0; i < g.count; i++) {
        const s = track.sFromFrac(g.at) + i * (g.spacing ?? 2);
        const d = g.d + (g.stagger ? (i % 2) * g.stagger : 0);
        const p = track.path.pointAt(s, d);
        const size = BREAKABLE_SIZE[g.type];
        p.y = floorHeight(track, s, d) + size.hy + 0.02;
        const heading = headingOf(track.path.tangentAt(s)) + (g.rot ?? 0);
        q.setFromAxisAngle(new Vector3(0, 1, 0), -heading);
        const body = world.createRigidBody(
          R.RigidBodyDesc.dynamic()
            .setTranslation(p.x, p.y, p.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setLinearDamping(0.3)
            .setAngularDamping(0.5)
            .setCanSleep(true),
        );
        const col =
          g.type === 'barrel' || g.type === 'cone'
            ? R.ColliderDesc.cylinder(size.hy, size.hx)
            : R.ColliderDesc.cuboid(size.hx, size.hy, size.hz);
        const vol = 8 * size.hx * size.hy * size.hz;
        const collider = world.createCollider(
          col
            .setDensity(size.mass / vol)
            .setFriction(0.7)
            .setRestitution(0.2)
            .setCollisionGroups(PROP_GROUPS)
            .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
          body,
        );
        body.sleep();
        const b: Breakable = {
          id: id++,
          type: g.type,
          body,
          handle: collider.handle,
          knocked: false,
          knockedAt: 0,
          harmless: false,
          collider,
          home: p.clone(),
        };
        this.breakables.push(b);
        this.byHandle.set(collider.handle, b);
      }
    }
  }

  breakableOf(handle: number): Breakable | undefined {
    return this.byHandle.get(handle);
  }

  /** Машина пересекла вход телепорта (между прошлым и текущим s, в пределах полосы). */
  portalCrossed(prevS: number, s: number, d: number): Portal | null {
    const path = this.track.path;
    for (const p of this.portals) {
      if (Math.abs(d - p.d) > p.halfWidth) continue;
      if (path.deltaS(prevS, p.fromS) > 0 && path.deltaS(s, p.fromS) <= 0 && path.deltaS(prevS, s) < 20) return p;
    }
    return null;
  }

  onBoost(s: number, d: number): boolean {
    const path = this.track.path;
    for (const b of this.boosts) {
      if (Math.abs(d - b.d) > b.halfWidth) continue;
      if (path.deltaS(b.fromS, s) >= 0 && path.deltaS(s, b.toS) >= 0) return true;
    }
    return false;
  }

  /** После шага физики: какие препятствия сбиты; сбитые почти сразу перестают мешать машинам (иначе лежащий щит — трамплин). */
  update(tick: number): void {
    for (const b of this.breakables) {
      if (b.harmless) continue;
      if (b.knocked) {
        if (tick - b.knockedAt > 15) {
          b.collider.setCollisionGroups(LYING_GROUPS);
          b.harmless = true;
        }
        continue;
      }
      const t = b.body.translation();
      if ((t.x - b.home.x) ** 2 + (t.z - b.home.z) ** 2 > 0.5) {
        b.knocked = true;
        b.knockedAt = tick;
      }
    }
  }
}
