/**
 * Детерминированный генератор случайных чисел (sfc32).
 * Вся симуляция берёт случайность только отсюда, чтобы прогон с одним seed
 * давал один и тот же результат (раздел 11 ТЗ, п. 4).
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | string) {
    const h = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.a = 0x9e3779b9 ^ h;
    this.b = 0x243f6a88 ^ Math.imul(h, 0x85ebca6b);
    this.c = 0xb7e15162 ^ Math.imul(h, 0xc2b2ae35);
    this.d = h | 1;
    for (let i = 0; i < 15; i++) this.nextUint();
  }

  /** Целое без знака 0..2^32-1. */
  nextUint(): number {
    this.a |= 0;
    this.b |= 0;
    this.c |= 0;
    this.d |= 0;
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Число в [0, 1). */
  next(): number {
    return this.nextUint() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Целое в [min, max] включительно. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: пустой список');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = items[i] as T;
      items[i] = items[j] as T;
      items[j] = t;
    }
    return items;
  }

  /** Независимый поток для подсистемы: не сдвигает основной поток при добавлении новых потребителей. */
  fork(label: string): Rng {
    return new Rng((this.nextUint() ^ hashString(label)) >>> 0);
  }
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
