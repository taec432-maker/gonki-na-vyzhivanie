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
  /** Северное сияние на небе (зимний лес ночью). */
  aurora?: boolean;
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
  'city-day': {
    id: 'city-day',
    hdri: 'potsdamer_platz_1k.hdr',
    envIntensity: 0.85,
    backgroundIntensity: 0.95,
    backgroundBlur: 0,
    sun: { dir: [-0.4, 0.55, 0.5], color: '#ffe9d0', intensity: 3.0 },
    hemi: { sky: '#cfd9e6', ground: '#4a4a4f', intensity: 0.35 },
    fog: { color: '#b9c2cc', density: 0.0022 },
    exposure: 1.0,
    grade: { saturation: 1.04, contrast: 1.08, brightness: 0, shadows: '#dfe6f2', highlights: '#fff0de' },
    night: false,
    wet: 0.35,
    weather: 'none',
    smokeLight: 1,
  },
  'city-night': {
    id: 'city-night',
    hdri: 'dikhololo_night_1k.hdr',
    envIntensity: 0.7,
    backgroundIntensity: 0.35,
    backgroundBlur: 0.2,
    sun: { dir: [0.3, 0.8, -0.4], color: '#8fa6ff', intensity: 0.35 },
    hemi: { sky: '#2a3460', ground: '#140f1c', intensity: 0.75 },
    fog: { color: '#1a1530', density: 0.0045 },
    exposure: 1.35,
    grade: { saturation: 1.18, contrast: 1.12, brightness: 0, shadows: '#c9b8ff', highlights: '#ffd0ec' },
    night: true,
    wet: 0.95,
    weather: 'rain',
    smokeLight: 0.35,
  },
  'desert-sunset': {
    id: 'desert-sunset',
    hdri: 'venice_sunset_1k.hdr',
    envIntensity: 0.95,
    backgroundIntensity: 1,
    backgroundBlur: 0,
    sun: { dir: [0.75, 0.22, -0.3], color: '#ffb36b', intensity: 3.6 },
    hemi: { sky: '#ffc999', ground: '#7a5a3c', intensity: 0.45 },
    fog: { color: '#e8b98a', density: 0.0018 },
    exposure: 1.05,
    grade: { saturation: 1.12, contrast: 1.1, brightness: 0, shadows: '#d9c2ff', highlights: '#ffd9a8' },
    night: false,
    wet: 0,
    weather: 'dust',
    smokeLight: 1,
  },
  'desert-night': {
    id: 'desert-night',
    hdri: 'dikhololo_night_1k.hdr',
    envIntensity: 0.8,
    backgroundIntensity: 0.8,
    backgroundBlur: 0,
    sun: { dir: [-0.4, 0.7, 0.3], color: '#a9b8ff', intensity: 0.7 },
    hemi: { sky: '#3c4a75', ground: '#2a2018', intensity: 0.8 },
    fog: { color: '#20253a', density: 0.0022 },
    exposure: 1.3,
    grade: { saturation: 1.05, contrast: 1.08, brightness: 0, shadows: '#c8d2ff', highlights: '#ffe2c0' },
    night: true,
    wet: 0,
    weather: 'none',
    smokeLight: 0.35,
  },
  'mountain-morning': {
    id: 'mountain-morning',
    hdri: 'immenstadter_horn_1k.hdr',
    envIntensity: 1,
    backgroundIntensity: 1,
    backgroundBlur: 0,
    sun: { dir: [-0.6, 0.38, 0.45], color: '#ffe4c4', intensity: 3.2 },
    hemi: { sky: '#d4e2f2', ground: '#4f5a48', intensity: 0.4 },
    fog: { color: '#dfe6ee', density: 0.0042 },
    exposure: 1.0,
    grade: { saturation: 1.02, contrast: 1.05, brightness: 0.01, shadows: '#dde8f6', highlights: '#fff2e2' },
    night: false,
    wet: 0,
    weather: 'none',
    smokeLight: 1,
  },
  'mountain-night': {
    id: 'mountain-night',
    hdri: 'dikhololo_night_1k.hdr',
    envIntensity: 0.75,
    backgroundIntensity: 0.7,
    backgroundBlur: 0,
    sun: { dir: [0.3, 0.75, 0.4], color: '#a0b4ff', intensity: 0.6 },
    hemi: { sky: '#34436a', ground: '#1c1f24', intensity: 1.1 },
    fog: { color: '#1b2233', density: 0.0035 },
    exposure: 1.55,
    grade: { saturation: 1.0, contrast: 1.1, brightness: 0, shadows: '#c6d4ff', highlights: '#ffeedd' },
    night: true,
    wet: 0,
    weather: 'snow',
    smokeLight: 0.35,
  },
  'forest-day': {
    id: 'forest-day',
    hdri: 'forest_slope_1k.hdr',
    envIntensity: 1,
    backgroundIntensity: 0.95,
    backgroundBlur: 0,
    sun: { dir: [0.5, 0.45, -0.55], color: '#fff4e8', intensity: 2.8 },
    hemi: { sky: '#dfe9f5', ground: '#c9d3dc', intensity: 0.55 },
    fog: { color: '#d9e2ea', density: 0.0035 },
    exposure: 1.0,
    grade: { saturation: 0.95, contrast: 1.06, brightness: 0.01, shadows: '#d6e2f2', highlights: '#fffaf2' },
    night: false,
    wet: 0,
    weather: 'snow',
    smokeLight: 1,
  },
  'forest-night': {
    id: 'forest-night',
    hdri: 'dikhololo_night_1k.hdr',
    envIntensity: 0.8,
    backgroundIntensity: 0.55,
    backgroundBlur: 0,
    sun: { dir: [-0.3, 0.75, 0.4], color: '#9fd8ff', intensity: 0.65 },
    hemi: { sky: '#2c4a5e', ground: '#a8b8c8', intensity: 0.75 },
    fog: { color: '#0f1d26', density: 0.0028 },
    exposure: 1.35,
    grade: { saturation: 1.1, contrast: 1.1, brightness: 0, shadows: '#b8e0ff', highlights: '#d8ffe8' },
    night: true,
    wet: 0,
    weather: 'snow',
    smokeLight: 0.4,
    aurora: true,
  },
};

export function presetById(id: string): LightingPreset {
  return PRESETS[id] ?? (PRESETS['day-park'] as LightingPreset);
}
