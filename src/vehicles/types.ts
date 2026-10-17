/** Описание машины (раздел 8 ТЗ). Все числа — в JSON, код их только исполняет. */
export type VehicleCategory = 'race' | 'power' | 'odd';
export type Rarity = 'common' | 'rare';
export type Drive = 'rwd' | 'fwd' | 'awd';

/** Форма кузова для процедурной модели (если нет GLB). */
export type BodyStyle =
  | 'formula'
  | 'sports'
  | 'supercar'
  | 'hatch'
  | 'muscle'
  | 'pickup'
  | 'jeep'
  | 'armored'
  | 'hearse'
  | 'limo'
  | 'tractor'
  | 'mower'
  | 'cart'
  | 'icecream'
  | 'garbage'
  | 'buggy';

export interface VehicleSpec {
  id: string;
  /** Номер для чата: «машина 7». */
  number: number;
  name: string;
  category: VehicleCategory;
  rarity: Rarity;
  /** Модель-заглушка: процедурный меш вместо настоящего GLB (список на замену — в CHANGELOG). */
  placeholder: boolean;
  /** Путь к GLB относительно public/, null — процедурная модель. */
  model: string | null;
  body: BodyStyle;
  /** Масса, кг. */
  mass: number;
  /** Мощность, кВт. */
  powerKw: number;
  maxSpeedKmh: number;
  /** Множитель сцепления шин (1 — обычная дорожная машина). */
  grip: number;
  hp: number;
  /** Габариты кузова, м. */
  dims: { length: number; width: number; height: number };
  wheelbase: number;
  /** Колея (расстояние между центрами колёс одной оси), м. */
  track: number;
  wheelRadius: number;
  /** Радиус задних колёс, если отличается (трактор). */
  rearWheelRadius?: number;
  drive: Drive;
  /** Насколько сильно рулит: 1 — обычно. */
  steer: number;
  /** Точка ника над крышей, м над центром машины. */
  nameTagHeight: number;
  /** Ливреи: основной цвет кузова, игрок получает одну из них. */
  colors: string[];
}
