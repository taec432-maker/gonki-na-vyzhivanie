import type { GradeSettings } from './grade';
import type { WeatherKind } from './weather';

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
  /** Цветокоррекция под локацию (после тонемаппинга). */
  grade: GradeSettings;
  night: boolean;
  /** Мокрый асфальт: 0 — сухо, 1 — после ливня (отражения в лужах). */
  wet: number;
  weather: WeatherKind;
  /** Освещённость дыма и пыли (частицы не освещаются светом сцены): 1 — день. */
  smokeLight: number;
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
    grade: { saturation: 1.05, contrast: 1.06, brightness: 0, shadows: '#e9eef8', highlights: '#fff6e8' },
    night: false,
    wet: 0,
    weather: 'none',
    smokeLight: 1,
  },
  'port-day': {
    id: 'port-day',
    hdri: 'potsdamer_platz_1k.hdr',
    envIntensity: 0.9,
    backgroundIntensity: 1,
    backgroundBlur: 0,
    sun: { dir: [0.55, 0.62, -0.35], color: '#fff1dc', intensity: 3.4 },
    hemi: { sky: '#d6e4f5', ground: '#5a5650', intensity: 0.35 },
    fog: { color: '#c7d0d8', density: 0.0016 },
    exposure: 1.0,
    grade: { saturation: 1.06, contrast: 1.08, brightness: 0, shadows: '#e4ebf5', highlights: '#fff3e2' },
    night: false,
    wet: 0,
    weather: 'none',
    smokeLight: 1,
  },
  'port-night': {
    id: 'port-night',
    hdri: 'dikhololo_night_1k.hdr',
    envIntensity: 0.9,
    backgroundIntensity: 0.7,
    backgroundBlur: 0,
    sun: { dir: [-0.3, 0.8, 0.4], color: '#9fb4ff', intensity: 0.5 },
    hemi: { sky: '#3a4a6e', ground: '#1a1a1f', intensity: 0.8 },
    fog: { color: '#141a26', density: 0.0028 },
    exposure: 1.3,
    grade: { saturation: 1.1, contrast: 1.1, brightness: 0, shadows: '#d6e2ff', highlights: '#ffe6c8' },
    night: true,
    wet: 0.85,
    weather: 'rain',
    smokeLight: 0.3,
  },
};

export function presetById(id: string): LightingPreset {
  return PRESETS[id] ?? (PRESETS['day-park'] as LightingPreset);
}
