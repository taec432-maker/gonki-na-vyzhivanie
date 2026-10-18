import type { ControlPoint } from './spline';

/** Тип покрытия: влияет на сцепление и сопротивление качению. */
export type SurfaceType = 'asphalt' | 'wet' | 'dirt' | 'sand' | 'snow' | 'ice' | 'grass' | 'metal';

export interface SurfaceProps {
  /** Множитель сцепления шин. */
  grip: number;
  /** Сопротивление качению (доп. торможение, м/с² на единицу скорости). */
  drag: number;
  /** Цвет пыли из-под колёс (для частиц). */
  dust: string | null;
}

export const SURFACES: Record<SurfaceType, SurfaceProps> = {
  asphalt: { grip: 1.0, drag: 0.0, dust: null },
  wet: { grip: 0.82, drag: 0.0, dust: null },
  metal: { grip: 0.88, drag: 0.0, dust: null },
  dirt: { grip: 0.8, drag: 0.03, dust: '#8a7356' },
  grass: { grip: 0.7, drag: 0.06, dust: '#5d6b3a' },
  snow: { grip: 0.62, drag: 0.04, dust: '#e8eef5' },
  sand: { grip: 0.6, drag: 0.16, dust: '#c9a36b' },
  ice: { grip: 0.26, drag: 0.0, dust: null },
};

/** Участок трассы [from, to) в долях круга, 0..1. */
export interface Span {
  from: number;
  to: number;
}

export interface SurfaceZone extends Span {
  surface: SurfaceType;
}

export interface JumpDef {
  /** Доля круга, где стоит трамплин. */
  at: number;
  /** Высота трамплина (м). */
  height: number;
  /** Длина разгонной части (м). */
  length: number;
  /** Расщелина за трамплином, м: полотна нет — недолёт = падение и возврат на трассу. */
  gap?: number;
}

export interface TeleportDef {
  /** Вход (доля круга) и выход (доля круга) — выход всегда дальше по ходу. */
  from: number;
  to: number;
  /** Полуширина входной зоны поперёк дороги, м; центр — смещение d. */
  d: number;
  halfWidth: number;
}

export interface BoostDef extends Span {
  d: number;
  halfWidth: number;
}

export interface ShortcutDef {
  /** Начало и конец на основной линии. */
  from: number;
  to: number;
  /** С какой стороны отходит (+1 — справа, −1 — слева) и максимальное отклонение центра, м. */
  side: 1 | -1;
  offset: number;
  width: number;
  /** Покрытие объезда (по умолчанию грунт — короче, но медленнее). */
  surface?: SurfaceType;
  /** Вероятность, что бот поедет шорткатом (на каждом круге). */
  chance?: number;
}

export interface PropDef {
  type: string;
  /** Одиночный: доля круга. */
  at?: number;
  /**
   * Смещение: для ряда — расстояние наружу от отбойника (м);
   * для одиночного — от центральной линии со знаком (+ — справа).
   */
  d?: number;
  rot?: number;
  /** Ряд: каждые every метров в диапазоне span, с обеих сторон (0) или с одной. */
  every?: number;
  span?: Span;
  side?: 1 | -1 | 0;
  /** Случайный разброс (м) — детерминированно по seed трассы. */
  jitter?: number;
  scale?: number;
  /** Сколько рядов вглубь (для штабелей контейнеров, леса). */
  rows?: number;
  /** Разрушаемый (бочка, конус, щит): улетает от удара, наносит немного урона. */
  breakable?: boolean;
}

export type BreakableType = 'barrel' | 'cone' | 'billboard' | 'crate';

/** Разрушаемые препятствия у дороги: ряд от доли круга at через spacing метров. */
export interface BreakableDef {
  type: BreakableType;
  at: number;
  /** Смещение от центра дороги, м (+ — справа). */
  d: number;
  count: number;
  spacing?: number;
  /** Шахматка: каждое второе сдвигается на stagger м поперёк. */
  stagger?: number;
  rot?: number;
}

/** Область декора вне трассы: вода, площадка. Прямоугольник в XZ. */
export interface AreaDef {
  type: 'water' | 'ground';
  rect: [number, number, number, number];
  y: number;
  style?: string;
}

export interface TrackDef {
  id: string;
  name: string;
  /** Короткое описание локации для экрана лобби. */
  description: string;
  /** Контрольные точки: {x,y,z,w?,bank?} или короткая запись [x, y, z]. */
  points: (ControlPoint | [number, number, number])[];
  width: number;
  surface: SurfaceType;
  zones?: SurfaceZone[];
  shoulder: { width: number; surface: SurfaceType };
  walls: { offset: number; height: number; gaps?: (Span & { side?: 1 | -1 })[] };
  /** Число равномерно расставленных чекпойнтов или явный список долей круга. */
  checkpoints: number | number[];
  startAt: number;
  /** Пресет освещения/погоды (src/render/presets.ts). */
  lighting: string;
  /** Ночной вариант пресета (для ротации день/ночь). */
  lightingNight?: string;
  weather: 'none' | 'rain' | 'snow' | 'dust';
  jumps?: JumpDef[];
  teleports?: TeleportDef[];
  boosts?: BoostDef[];
  shortcuts?: ShortcutDef[];
  props?: PropDef[];
  breakables?: BreakableDef[];
  /** Насколько ниже полотна (м) машина считается упавшей (обрыв, расщелина): урон и возврат на трассу. */
  fallDepth?: number;
  /** Ростер машин локации (id), пусто — все обычные. */
  roster?: string[];
  /** Цвет земли за пределами дороги. */
  groundColor?: string;
  /** Стиль текстуры земли (src/render/textures.ts GROUND_STYLES). */
  ground?: string;
  areas?: AreaDef[];
  /** Высота земли относительно дороги (для каньонов/обрывов — сильно ниже). */
  groundOffset?: number;
  /** Откос от края полотна до земли там, где дорога выше земли: скала, бетон, песок, снег. */
  skirt?: 'rock' | 'concrete' | 'sand' | 'snow';
  /** Участки-мосты (доли круга): без откоса, с фермами. */
  bridges?: Span[];
}
