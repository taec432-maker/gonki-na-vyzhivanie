import { Track } from '../../src/tracks/track';
import { trackById } from '../../src/tracks';
const t = new Track(trackById(process.argv[2] ?? 'port'));
let minR = Infinity;
let at = 0;
for (const s of t.path.samples) {
  const r = 1 / Math.max(1e-6, Math.abs(s.curvature));
  if (r < minR) {
    minR = r;
    at = s.s;
  }
}
console.info('length', t.length.toFixed(0), 'min radius', minR.toFixed(1), 'at frac', t.fracFromStart(at).toFixed(3));
