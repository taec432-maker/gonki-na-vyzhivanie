import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

let ready: Promise<void> | null = null;

/** Rapier — это WASM, его нужно один раз инициализировать до создания мира. */
export function initPhysics(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}

/**
 * Группы коллизий. Луч колеса видит только землю (FLOOR) — иначе подвеска
 * «запрыгивает» на стены и чужие машины. Идея — из референса szabolevi98/racing,
 * код свой (см. docs/РЕШЕНИЯ.md).
 */
export const GROUP = {
  FLOOR: 0x0001,
  WALL: 0x0002,
  CAR: 0x0004,
  PROP: 0x0008,
  DEBRIS: 0x0010,
  SENSOR: 0x0020,
} as const;

const ALL = 0xffff;
export const groups = (member: number, filter: number): number => ((member & 0xffff) << 16) | (filter & 0xffff);

export const FLOOR_GROUPS = groups(GROUP.FLOOR, ALL);
export const WALL_GROUPS = groups(GROUP.WALL, ALL);
export const CAR_GROUPS = groups(GROUP.CAR, GROUP.FLOOR | GROUP.WALL | GROUP.CAR | GROUP.PROP | GROUP.DEBRIS);
/** «Призрак»: сквозь машины, но не сквозь стены и землю. */
export const GHOST_CAR_GROUPS = groups(GROUP.CAR, GROUP.FLOOR | GROUP.WALL);
export const WHEEL_RAY_GROUPS = groups(GROUP.CAR, GROUP.FLOOR);
export const PROP_GROUPS = groups(GROUP.PROP, GROUP.FLOOR | GROUP.WALL | GROUP.CAR | GROUP.PROP);
export const DEBRIS_GROUPS = groups(GROUP.DEBRIS, GROUP.FLOOR | GROUP.WALL);

export function createWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  // Чуть больше итераций — устойчивее стопка машин в завале.
  world.numSolverIterations = 6;
  return world;
}
