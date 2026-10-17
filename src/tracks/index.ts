import type { TrackDef } from './types';
import testOval from './test-oval.json';

export const TRACKS: TrackDef[] = [testOval as TrackDef];

export function trackById(id: string): TrackDef {
  const t = TRACKS.find((x) => x.id === id);
  if (!t) throw new Error(`Нет трассы ${id}`);
  return t;
}
