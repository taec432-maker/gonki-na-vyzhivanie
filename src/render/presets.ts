/** Пресеты освещения и погоды по локациям (раздел 9 ТЗ). HDRI — Poly Haven, CC0 (см. ASSETS.md). */
export interface LightingPreset {
  id: string;
  hdri: string;
  envIntensity: number;
  backgroundIntensity: number;
  /** Размытие фона (0 — чёткое небо HDRI). */
  backgroundBlur: number;
  sun: { dir: [number, number, number]; color: string; intensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  fog: { color: string; density: number };
  exposure: number;
  /** Цветокоррекция: насыщенность (−1..1), контраст (−1..1), оттенок (hex, смешивается мягко). */
  grade: { saturation: number; contrast: number; brightness: number; hue: number };
  night: boolean;
  /** Мокрый асфальт (отражения). */
  wet: boolean;
}

export const PRESETS: Record<string, LightingPreset> = {
  'day-park': {
    id: 'day-park',
    hdri: 'rooitou_park_1k.hdr',
    envIntensity: 1,
    backgroundIntensity: 1,
    backgroundBlur: 0,
    sun: { dir: [-0.45, 0.75, 0.35], color: '#fff3e0', intensity: 3.2 },
    hemi: { sky: '#cfe3ff', ground: '#4a4a3a', intensity: 0.3 },
    fog: { color: '#c9d6e3', density: 0.0012 },
    exposure: 1.0,
    grade: { saturation: 0.05, contrast: 0.06, brightness: 0, hue: 0 },
    night: false,
    wet: false,
  },
};

export function presetById(id: string): LightingPreset {
  return PRESETS[id] ?? (PRESETS['day-park'] as LightingPreset);
}
