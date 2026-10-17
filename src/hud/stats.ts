/** Счётчик кадров: медиана и 95-й перцентиль времени кадра за последние N кадров. */
export class FrameStatsMeter {
  private readonly times: number[] = [];
  private readonly size: number;
  /** Все кадры за сессию (для Playwright-профиля), ограничено по длине. */
  readonly history: number[] = [];

  constructor(size = 120) {
    this.size = size;
  }

  push(ms: number): void {
    this.times.push(ms);
    if (this.times.length > this.size) this.times.shift();
    this.history.push(ms);
    if (this.history.length > 20000) this.history.splice(0, 10000);
  }

  median(): number {
    return percentile(this.times, 0.5);
  }

  p95(): number {
    return percentile(this.times, 0.95);
  }

  fps(): number {
    const m = this.median();
    return m > 0 ? 1000 / m : 0;
  }
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i] as number;
}
