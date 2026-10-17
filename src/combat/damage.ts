/**
 * Урон от столкновений (раздел 6 ТЗ):
 *   урон = k × относительная скорость × масса соперника / масса жертвы,
 *   мелкие касания (ниже порога) — 0; удар в зад/бок больнее, лоб в лоб — слабее обоим;
 *   стены — небольшой урон.
 */
export const RAM = {
  /** Коэффициент k (HP на м/с относительной скорости). */
  k: 1.15,
  /** Порог: при сближении медленнее — урона нет, м/с. */
  threshold: 4,
  rear: 1.5,
  side: 1.3,
  headOn: 0.7,
  /** Атакующий бьёт носом — сам получает меньше. */
  attackerNose: 0.55,
  /** Стены: k и порог. */
  wallK: 0.45,
  wallThreshold: 7,
  /** Таран «Монстром» — фиксированный урон. */
  monster: 60,
  /** Больше этого за одно столкновение не снимаем. */
  cap: 60,
} as const;

export type HitZone = 'front' | 'rear' | 'side';

/**
 * Где по машине пришёлся удар: dx, dz — направление от машины к соседу в её системе
 * координат (вперёд — −Z, вправо — +X).
 */
export function hitZone(localX: number, localZ: number): HitZone {
  const ax = Math.abs(localX);
  const az = Math.abs(localZ);
  if (ax > az * 0.9) return 'side';
  return localZ < 0 ? 'front' : 'rear';
}

export interface RamInput {
  /** Скорость сближения (проекция относительной скорости на линию центров), м/с. */
  closing: number;
  massSelf: number;
  massOther: number;
  /** Зона удара по себе и по сопернику. */
  zoneSelf: HitZone;
  zoneOther: HitZone;
}

/** Урон машине «self» от столкновения с «other». */
export function ramDamage(i: RamInput): number {
  if (i.closing < RAM.threshold) return 0;
  let dmg = RAM.k * (i.closing - RAM.threshold * 0.5) * (i.massOther / i.massSelf);
  if (i.zoneSelf === 'front' && i.zoneOther === 'front') dmg *= RAM.headOn;
  else if (i.zoneSelf === 'rear') dmg *= RAM.rear;
  else if (i.zoneSelf === 'side') dmg *= RAM.side;
  else if (i.zoneSelf === 'front') dmg *= RAM.attackerNose;
  return Math.min(RAM.cap, Math.max(0, dmg));
}

/** Урон от удара о стену (скорость по нормали к стене). */
export function wallDamage(normalSpeed: number): number {
  if (normalSpeed < RAM.wallThreshold) return 0;
  return Math.min(25, RAM.wallK * (normalSpeed - RAM.wallThreshold * 0.6));
}
