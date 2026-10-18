import type { TrackDef } from './types';
import testOval from './test-oval.json';
import port from './port.json';

/** Трассы ротации эфира (раздел 9 ТЗ), по порядку «по кругу». */
export const TRACKS: TrackDef[] = [port as unknown as TrackDef];

/** Служебные трассы (тестовый овал) — только по ?track=. */
const EXTRA: TrackDef[] = [testOval as TrackDef];

export function trackById(id: string): TrackDef {
  const t = [...TRACKS, ...EXTRA].find((x) => x.id === id);
  if (!t) throw new Error(`Нет трассы ${id}`);
  return t;
}
