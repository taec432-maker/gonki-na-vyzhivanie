import { describe, expect, it } from 'vitest';
import { FixedStepper, STEP } from '../src/core/loop';

describe('FixedStepper', () => {
  it('60 шагов за секунду при любом fps', () => {
    for (const fps of [30, 60, 144]) {
      const s = new FixedStepper();
      let steps = 0;
      for (let i = 0; i < fps; i++) steps += s.advance(1 / fps);
      expect(Math.abs(steps - 60)).toBeLessThanOrEqual(1);
    }
  });
  it('alpha в [0,1]', () => {
    const s = new FixedStepper();
    s.advance(STEP * 1.5);
    expect(s.alpha).toBeGreaterThan(0.4);
    expect(s.alpha).toBeLessThan(0.6);
  });
  it('после долгого зависания не догоняет бесконечно', () => {
    const s = new FixedStepper();
    expect(s.advance(5)).toBeLessThanOrEqual(s.maxStepsPerFrame);
  });
  it('пауза — ноль шагов', () => {
    const s = new FixedStepper();
    s.paused = true;
    expect(s.advance(1)).toBe(0);
  });
});
