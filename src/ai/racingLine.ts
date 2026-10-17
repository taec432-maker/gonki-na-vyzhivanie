import type { Track } from '../tracks/track';

/**
 * Гоночная линия: боковое смещение от центра для каждого сэмпла трассы.
 * Итеративное сглаживание (приближение к линии минимальной кривизны):
 * точка тянется к середине соседей, но не дальше границ дороги с запасом.
 */
export function computeRacingLine(track: Track, margin = 2.2, iterations = 220): Float32Array {
  const path = track.path;
  const n = path.samples.length;
  const d = new Float32Array(n);
  const px = new Float32Array(n);
  const pz = new Float32Array(n);
  const lim = new Float32Array(n);
  for (let i = 0; i < n; i++) lim[i] = Math.max(0, path.sample(i).width / 2 - margin);
  const K = 6;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const sm = path.sample(i);
      px[i] = sm.pos.x + sm.right.x * (d[i] as number);
      pz[i] = sm.pos.z + sm.right.z * (d[i] as number);
    }
    for (let i = 0; i < n; i++) {
      const a = (i - K + n) % n;
      const b = (i + K) % n;
      const mx = ((px[a] as number) + (px[b] as number)) / 2;
      const mz = ((pz[a] as number) + (pz[b] as number)) / 2;
      const sm = path.sample(i);
      // Новое смещение — проекция середины соседей на поперечную ось.
      const target = (mx - sm.pos.x) * sm.right.x + (mz - sm.pos.z) * sm.right.z;
      const cur = d[i] as number;
      const next = cur + (target - cur) * 0.5;
      const l = lim[i] as number;
      d[i] = Math.max(-l, Math.min(l, next));
    }
  }
  // Лёгкое сглаживание самого смещения, чтобы не было «ступенек» у границ.
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -3; k <= 3; k++) acc += d[(i + k + n) % n] as number;
    out[i] = acc / 7;
  }
  return out;
}
