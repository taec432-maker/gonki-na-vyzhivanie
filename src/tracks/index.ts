import type { TrackDef } from './types';
import testOval from './test-oval.json';
import port from './port.json';
import city from './city.json';
import desert from './desert.json';
import mountain from './mountain.json';
import forest from './forest.json';

/** Трассы ротации эфира (раздел 9 ТЗ), по порядку «по кругу». */
export const TRACKS: TrackDef[] = [port, city, desert, mountain, forest].map((t) => t as unknown as TrackDef);

/** Служебные трассы (тестовый овал) — только по ?track=. */
const EXTRA: TrackDef[] = [testOval as TrackDef];

export function trackById(id: string): TrackDef {
  const t = [...TRACKS, ...EXTRA].find((x) => x.id === id);
  if (!t) throw new Error(`Нет трассы ${id}`);
  return t;
}
