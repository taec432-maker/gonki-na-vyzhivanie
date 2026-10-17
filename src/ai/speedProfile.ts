import type { TrackPath } from '../tracks/spline';

/**
 * Профиль допустимой скорости вдоль трассы: в повороте не быстрее, чем
 * позволяет боковое ускорение, и с запасом на торможение перед поворотом.
 */
export function buildSpeedProfile(
  path: TrackPath,
  offsets: Float32Array | null,
  aLat: number,
  aBrake: number,
  vCap: number,
): Float32Array {
  const n = path.samples.length;
  const curv = new Float32Array(n);
  // Кривизна траектории с учётом бокового смещения (гоночной линии).
  for (let i = 0; i < n; i++) {
    if (!offsets) {
      curv[i] = Math.abs(path.sample(i).curvature);
      continue;
    }
    const a = path.pointAt(path.sample(i - 3).s, offsets[(i - 3 + n) % n] as number);
    const b = path.pointAt(path.sample(i).s, offsets[i] as number);
    const c = path.pointAt(path.sample(i + 3).s, offsets[(i + 3) % n] as number);
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const bcx = c.x - b.x;
    const bcz = c.z - b.z;
    const cross = abx * bcz - abz * bcx;
    const la = Math.hypot(abx, abz);
    const lb = Math.hypot(bcx, bcz);
    const lc = Math.hypot(c.x - a.x, c.z - a.z);
    curv[i] = la * lb * lc > 1e-6 ? Math.abs((2 * cross) / (la * lb * lc)) : 0;
  }
  // Сглаживание, чтобы шум сплайна не давал ложных «поворотов».
  const sm = new Float32Array(n);
  const R = 4;
  for (let i = 0; i < n; i++) {
    let mx = 0;
    for (let k = -R; k <= R; k++) mx = Math.max(mx, curv[(i + k + n) % n] as number);
    sm[i] = mx;
  }
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = sm[i] as number;
    v[i] = Math.min(vCap, k > 1e-5 ? Math.sqrt(aLat / k) : vCap);
  }
  // Обратный проход (дважды — трасса замкнута): успеть затормозить.
  const ds = path.step;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = v[(i + 1) % n] as number;
      const lim = Math.sqrt(next * next + 2 * aBrake * ds);
      if ((v[i] as number) > lim) v[i] = lim;
    }
  }
  return v;
}
