/** Параметры из адресной строки: ?seed=42&quality=broadcast&bridge=off … */
export interface UrlParams {
  seed: number;
  seedFromUrl: boolean;
  quality: string | null;
  bridge: 'auto' | 'on' | 'off';
  /** Ускорение симуляции (для тестов). */
  turbo: number;
  /** Без лобби и ожиданий: сразу гонка (для тестов). */
  quick: boolean;
  track: string | null;
  bots: number | null;
  laps: number | null;
  /** Не сохранять/не читать localStorage (чистые тесты). */
  fresh: boolean;
}

export function readParams(search: string = typeof location !== 'undefined' ? location.search : ''): UrlParams {
  const p = new URLSearchParams(search);
  const seedRaw = p.get('seed');
  const num = (k: string): number | null => {
    const v = p.get(k);
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const bridge = p.get('bridge');
  return {
    // Без ?seed= берём seed от часов: это вход в симуляцию, а не часть её шага.
    seed:
      seedRaw !== null && Number.isFinite(Number(seedRaw)) ? Number(seedRaw) >>> 0 : (Date.now() & 0x7fffffff) >>> 0,
    seedFromUrl: seedRaw !== null,
    quality: p.get('quality'),
    bridge: bridge === 'on' || bridge === 'off' ? bridge : 'auto',
    turbo: Math.max(1, Math.min(64, num('turbo') ?? 1)),
    quick: p.has('quick'),
    track: p.get('track'),
    bots: num('bots'),
    laps: num('laps'),
    fresh: p.has('fresh'),
  };
}
