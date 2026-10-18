// Карта трассы сверху (JSON для рисования): npx tsx scripts/dev/track-map.ts port > map.json
// Точки центра с долей круга, края дороги, ворота, шорткаты, телепорты, высоты.
import { Track } from '../../src/tracks/track';
import { trackById } from '../../src/tracks';
import { readFileSync } from 'node:fs';
const arg = process.argv[2] ?? 'port';
const def = arg.endsWith('.json') ? JSON.parse(readFileSync(arg, 'utf8')) : trackById(arg);
const t = new Track(def);
const out = {
  length: t.length,
  center: t.path.samples.map((s) => [
    s.pos.x,
    s.pos.z,
    s.pos.y,
    t.fracFromStart(s.s),
    s.curvature,
    t.path.widthAt(s.s),
  ]),
  gates: t.gates.map((g) => [g.ax, g.az, g.bx, g.bz]),
  shortcuts: t.shortcuts.map((sc) => {
    const pts: number[][] = [];
    for (let k = 0; k <= 40; k++) {
      const s = t.path.wrapS(sc.fromS + (t.path.deltaS(sc.fromS, sc.toS) * k) / 40);
      const p = t.path.pointAt(s, t.shortcutD(sc, s) ?? 0);
      pts.push([p.x, p.z]);
    }
    return pts;
  }),
  teleports: (def.teleports ?? []).map((tp: { from: number; to: number; d: number }) => {
    const a = t.path.pointAt(t.sFromFrac(tp.from), tp.d);
    const b = t.path.pointAt(t.sFromFrac(tp.to), tp.d);
    return [a.x, a.z, b.x, b.z];
  }),
};
console.info(JSON.stringify(out));
