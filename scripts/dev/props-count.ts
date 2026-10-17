import { Track } from '../../src/tracks/track';
import { trackById } from '../../src/tracks';
import { placeProps } from '../../src/render/props';
const t = new Track(trackById('port'));
const pl = placeProps(
  t,
  t.def.props ?? [],
  (ty) =>
    (
      ({ container: 3, crane: 14, warehouse: 13, barrel: 0.5, lamp: 0.6, bollard: 0.5, block: 1 }) as Record<
        string,
        number
      >
    )[ty] ?? 1,
);
const c: Record<string, number> = {};
for (const p of pl) c[p.type] = (c[p.type] ?? 0) + 1;
console.info(c);
