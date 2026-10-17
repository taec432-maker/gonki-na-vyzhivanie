/** Переключатель качества (раздел 2 ТЗ): Высокое / Среднее / Эфир. */
export type QualityLevel = 'high' | 'medium' | 'broadcast';

export interface QualitySettings {
  level: QualityLevel;
  label: string;
  /** Доля разрешения рендера от размера окна (ползунок в панели меняет её). */
  renderScale: number;
  maxPixelRatio: number;
  shadowSize: number;
  /** Полуразмер области теней вокруг камеры, м. */
  shadowRadius: number;
  msaa: number;
  bloom: boolean;
  ao: boolean;
  /** AO в половинном разрешении (дешевле). */
  aoHalfRes: boolean;
  motionBlur: boolean;
  /** Множитель числа частиц. */
  particles: number;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  high: {
    level: 'high',
    label: 'Высокое',
    renderScale: 1,
    maxPixelRatio: 2,
    shadowSize: 4096,
    shadowRadius: 90,
    msaa: 4,
    bloom: true,
    ao: true,
    aoHalfRes: false,
    motionBlur: true,
    particles: 1,
  },
  medium: {
    level: 'medium',
    label: 'Среднее',
    renderScale: 0.85,
    maxPixelRatio: 1.5,
    shadowSize: 2048,
    shadowRadius: 75,
    msaa: 2,
    bloom: true,
    ao: true,
    aoHalfRes: true,
    motionBlur: false,
    particles: 0.7,
  },
  broadcast: {
    level: 'broadcast',
    label: 'Эфир',
    renderScale: 1,
    maxPixelRatio: 1,
    shadowSize: 2048,
    shadowRadius: 70,
    msaa: 0,
    bloom: true,
    ao: false,
    aoHalfRes: true,
    motionBlur: false,
    particles: 0.6,
  },
};

export function isQualityLevel(v: unknown): v is QualityLevel {
  return v === 'high' || v === 'medium' || v === 'broadcast';
}
