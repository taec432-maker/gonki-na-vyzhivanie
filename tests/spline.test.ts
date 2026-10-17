import { describe, expect, it } from 'vitest';
import { TrackPath } from '../src/tracks/spline';
import { Track, crossesGate } from '../src/tracks/track';
import { trackById } from '../src/tracks';

function circle(r: number, n = 16) {
  // По часовой стрелке (вид сверху, −Z — «север»): правые повороты.
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: Math.sin(a) * r, y: 0, z: -Math.cos(a) * r };
  });
}

describe('TrackPath', () => {
  it('длина окружности ≈ 2πr', () => {
    const p = new TrackPath(circle(100), 12);
    expect(p.length).toBeGreaterThan(2 * Math.PI * 100 * 0.99);
    expect(p.length).toBeLessThan(2 * Math.PI * 100 * 1.01);
  });
  it('кривизна окружности ≈ 1/r, знак — поворот вправо', () => {
    const p = new TrackPath(circle(100, 32), 12);
    for (const sm of p.samples.filter((_, i) => i % 50 === 0)) {
      expect(sm.curvature).toBeGreaterThan(0.0092);
      expect(sm.curvature).toBeLessThan(0.0108);
    }
  });
  it('проекция возвращает s и боковое смещение', () => {
    const p = new TrackPath(circle(100), 12);
    const pt = p.pointAt(123, 3);
    const pr = p.project(pt.x, pt.y, pt.z);
    expect(pr.s).toBeCloseTo(123, 0);
    expect(pr.d).toBeCloseTo(3, 1);
  });
  it('deltaS — кратчайший путь через старт', () => {
    const p = new TrackPath(circle(100), 12);
    expect(p.deltaS(p.length - 5, 5)).toBeCloseTo(10, 5);
    expect(p.deltaS(5, p.length - 5)).toBeCloseTo(-10, 5);
  });
});

describe('Track', () => {
  const track = new Track(trackById('test-oval'));
  it('ворота чекпойнтов идут по порядку и пересекаются движением вперёд', () => {
    expect(track.gates.length).toBe(6);
    for (const g of track.gates) {
      const a = track.path.pointAt(g.s - 2, 0);
      const b = track.path.pointAt(g.s + 2, 0);
      expect(crossesGate(g, a.x, a.z, b.x, b.z)).toBe(true);
      const c = track.path.pointAt(g.s + 4, 0);
      expect(crossesGate(g, b.x, b.z, c.x, c.z)).toBe(false);
    }
  });
  it('стартовая решётка — за линией старта, места не пересекаются', () => {
    const slots = track.gridSlots(12);
    for (const s of slots) expect(track.path.deltaS(track.startS, s.s)).toBeLessThan(0);
    for (let i = 0; i < slots.length; i++)
      for (let j = i + 1; j < slots.length; j++)
        expect(
          (slots[i] as { pos: { distanceTo(o: unknown): number } }).pos.distanceTo((slots[j] as { pos: unknown }).pos),
        ).toBeGreaterThan(3);
  });
});
