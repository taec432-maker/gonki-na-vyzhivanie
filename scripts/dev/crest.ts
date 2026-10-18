// Доля круга, где полотно впервые выходит на вершину (для трамплина): npx tsx scripts/dev/crest.ts трасса.json
import { readFileSync } from 'node:fs';
import { Track } from '../../src/tracks/track';
const t = new Track(JSON.parse(readFileSync(process.argv[2] as string, 'utf8')));
let maxY = -Infinity;
for (const s of t.path.samples) maxY = Math.max(maxY, s.pos.y);
const first = t.path.samples.find((s) => s.pos.y > maxY - 0.15);
console.info(t.fracFromStart((first?.s ?? 0) + 18).toFixed(4));
