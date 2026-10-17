import { Vector3 } from 'three';
import type { Controls } from '../physics/vehicle';
import type { TrackPath } from '../tracks/spline';

export interface DriverInput {
  x: number;
  z: number;
  heading: number;
  /** Скорость вперёд, м/с. */
  speed: number;
  /** Прогресс и смещение на трассе. */
  s: number;
  d: number;
}

const target = new Vector3();

/** Курс на точку: 0 — по −Z. */
function headingTo(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, -(tz - z));
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Базовое руление «держись линии»: pure pursuit на точку впереди по линии
 * со смещением offset, газ/тормоз — по профилю скорости.
 */
export function followLine(
  path: TrackPath,
  input: DriverInput,
  offsetAt: (s: number) => number,
  speedAt: (s: number) => number,
  out: Controls,
  speedScale = 1,
): Controls {
  const look = 7 + Math.abs(input.speed) * 0.45;
  const ts = input.s + look;
  path.pointAt(ts, offsetAt(ts), target);
  const want = headingTo(input.x, input.z, target.x, target.z);
  const err = wrapAngle(want - input.heading);
  out.steer = Math.max(-1, Math.min(1, err * 2.6));
  // Смотрим вперёд на тормозной путь: минимальная допустимая скорость на ближайшем отрезке.
  let vt = speedAt(input.s + 2);
  const horizon = 8 + input.speed * 0.4;
  for (let k = 4; k <= horizon; k += 4) vt = Math.min(vt, speedAt(input.s + k) + k * 0.25);
  vt *= speedScale;
  // При сильной ошибке курса — сбросить скорость (после разворота, на выезде со стены).
  if (Math.abs(err) > 0.6) vt = Math.min(vt, 12);
  const dv = vt - input.speed;
  if (dv > 0) {
    out.throttle = Math.min(1, 0.35 + dv * 0.4);
    out.brake = 0;
  } else {
    out.throttle = dv > -1.5 ? 0.2 : 0;
    out.brake = dv < -1.5 ? Math.min(1, -dv * 0.25) : 0;
  }
  return out;
}
