import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';

describe('Rng', () => {
  it('один seed — одна последовательность', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });
  it('разные seed — разные последовательности', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
  it('значения в [0,1) и равномерны', () => {
    const r = new Rng(7);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 10000).toBeGreaterThan(0.48);
    expect(sum / 10000).toBeLessThan(0.52);
  });
  it('int включает границы', () => {
    const r = new Rng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });
  it('fork не зависит от порядка потребителей основного потока', () => {
    const a = new Rng(5).fork('ai');
    const b = new Rng(5).fork('ai');
    expect(a.next()).toBe(b.next());
  });
});
