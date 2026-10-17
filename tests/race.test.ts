import { describe, expect, it } from 'vitest';
import { RaceTracker } from '../src/race/progress';
import { Track } from '../src/tracks/track';
import { trackById } from '../src/tracks';

const track = new Track(trackById('port'));

/** Проехать по центру трассы от s0 вперёд на dist метров шагами по 2 м. */
function drive(
  tr: RaceTracker,
  id: number,
  s0: number,
  dist: number,
  tick0 = 0,
): { s: number; tick: number; events: string[] } {
  const events: string[] = [];
  let s = s0;
  let tick = tick0;
  for (let k = 0; k < dist; k += 2) {
    const a = track.path.pointAt(s, 0);
    s = track.path.wrapS(s + 2);
    const b = track.path.pointAt(s, 0);
    const ev = tr.update(id, a.x, a.z, b.x, b.z, s, ++tick);
    if (ev) events.push(ev);
  }
  return { s, tick, events };
}

describe('RaceTracker — чекпойнты и круги', () => {
  const startBehind = track.path.wrapS(track.startS - 20);

  it('старт засчитывается при пересечении линии, круг — после всех чекпойнтов', () => {
    const tr = new RaceTracker(track, 3);
    const p = tr.add(1);
    const r = drive(tr, 1, startBehind, 30);
    expect(p.gatesPassed).toBe(1);
    expect(p.lap).toBe(0);
    expect(r.events).toEqual(['gate']);
    const r2 = drive(tr, 1, r.s, track.length, r.tick);
    expect(p.lap).toBe(1);
    expect(r2.events.filter((e) => e === 'lap').length).toBe(1);
    expect(r2.events.filter((e) => e === 'gate').length).toBe(track.gates.length - 1);
  });

  it('финиш ровно после N кругов', () => {
    const tr = new RaceTracker(track, 3);
    const p = tr.add(1);
    const r = drive(tr, 1, startBehind, 20 + track.length * 3 + 10);
    expect(p.finished).toBe(true);
    expect(p.lap).toBe(3);
    expect(r.events.at(-1)).toBe('finish');
    expect(r.events.filter((e) => e === 'finish').length).toBe(1);
  });

  it('срезка не засчитывается: пропущенный чекпойнт — круг не идёт', () => {
    const tr = new RaceTracker(track, 3);
    const p = tr.add(1);
    const r = drive(tr, 1, startBehind, 30);
    // «Телепортируемся» за следующий чекпойнт, минуя его.
    const g1 = track.gates[1]!;
    const g2 = track.gates[2]!;
    const jumped = drive(tr, 1, track.path.wrapS(g1.s + 5), track.path.wrapS(g2.s - g1.s) + 4, r.tick);
    expect(jumped.events).toEqual([]);
    expect(p.gatesPassed).toBe(1);
  });

  it('проезд ворот задом наперёд не засчитывается', () => {
    const tr = new RaceTracker(track, 3);
    const p = tr.add(1);
    const g0 = track.gates[0]!;
    const a = track.path.pointAt(g0.s + 3, 0);
    const b = track.path.pointAt(g0.s - 3, 0);
    expect(tr.update(1, a.x, a.z, b.x, b.z, g0.s - 3, 1)).toBeNull();
    expect(p.gatesPassed).toBe(0);
  });

  it('skipTo (телепорт) засчитывает пропущенные чекпойнты', () => {
    const tr = new RaceTracker(track, 3);
    const p = tr.add(1);
    drive(tr, 1, startBehind, 30);
    tr.skipTo(1, track.path.wrapS(track.gates[4]!.s + 1), 100);
    expect(p.gatesPassed).toBe(5);
  });
});

describe('RaceTracker — позиции', () => {
  it('позиции по кругу и прогрессу вдоль трассы', () => {
    const tr = new RaceTracker(track, 3);
    tr.add(1);
    tr.add(2);
    tr.add(3);
    const s0 = track.path.wrapS(track.startS - 20);
    drive(tr, 1, s0, 400);
    drive(tr, 2, s0, 600);
    drive(tr, 3, s0, 200);
    expect(tr.standings().map((p) => p.id)).toEqual([2, 1, 3]);
  });

  it('круговой отрыв: на круг впереди — выше, даже если по s позади', () => {
    const tr = new RaceTracker(track, 5);
    tr.add(1);
    tr.add(2);
    const s0 = track.path.wrapS(track.startS - 20);
    drive(tr, 1, s0, 20 + track.length + 100);
    drive(tr, 2, s0, 20 + 900);
    expect(tr.standings().map((p) => p.id)).toEqual([1, 2]);
  });

  it('финишировавшие — по времени финиша; выбывшие — в конце', () => {
    const tr = new RaceTracker(track, 1);
    const a = tr.add(1);
    const b = tr.add(2);
    const c = tr.add(3);
    const s0 = track.path.wrapS(track.startS - 20);
    drive(tr, 2, s0, 20 + track.length + 10, 0);
    drive(tr, 1, s0, 20 + track.length + 10, 50);
    c.out = true;
    c.outTick = 10;
    expect(b.finished && a.finished).toBe(true);
    expect(tr.standings().map((p) => p.id)).toEqual([2, 1, 3]);
  });

  it('откат назад за ворота не даёт скачка прогресса', () => {
    const tr = new RaceTracker(track, 3);
    const p = tr.add(1);
    const r = drive(tr, 1, track.path.wrapS(track.startS - 20), 30);
    const before = p.progress;
    const g = track.gates[0]!;
    p.progress = tr.progressOf(p, track.path.wrapS(g.s - 2));
    expect(p.progress).toBeLessThanOrEqual(before);
    expect(p.progress).toBeGreaterThanOrEqual(0);
    expect(r.s).toBeGreaterThan(0);
  });
});
