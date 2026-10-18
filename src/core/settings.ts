import { DEFAULT_SETTINGS, clampSettings, type SessionSettings } from '../race/session';
import { isQualityLevel, type QualityLevel } from '../render/quality';
import { DEFAULT_MAPPING, sanitizeMapping, type GiftMapping } from '../gifts/mapping';
import { DEFAULT_VOLUMES, type Volumes } from '../audio/sound';
import { SETTINGS_FILE_TAG } from './settingsFile';

/**
 * Настройки игры — живут на странице игры (в OBS свой localStorage),
 * панель меняет их командами. Хранение: localStorage, ключ gonki:settings.
 */
export interface BridgeSettings {
  host: string;
  port: number;
  /** auto — подключаться, только если игра открыта с 127.0.0.1/localhost. */
  enabled: 'auto' | 'on' | 'off';
}

export interface GameSettings {
  session: SessionSettings;
  quality: QualityLevel;
  resolution: number;
  bridge: BridgeSettings;
  /** Маппинг подарок → эффект (раздел 7 ТЗ). */
  gifts: GiftMapping;
  /** Громкость: общая, музыка, эффекты (0..1). */
  audio: Volumes;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  session: DEFAULT_SETTINGS,
  quality: 'high',
  resolution: 1,
  bridge: { host: '127.0.0.1', port: 3100, enabled: 'auto' },
  gifts: DEFAULT_MAPPING,
  audio: DEFAULT_VOLUMES,
};

const KEY = 'gonki:settings';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function sanitizeSettings(raw: unknown): GameSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<GameSettings>;
  const b = (r.bridge ?? {}) as Partial<BridgeSettings>;
  const port = Number(b.port);
  const a = (r.audio ?? {}) as Partial<Volumes>;
  const vol = (v: unknown, d: number): number => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d);
  return {
    session: clampSettings(r.session ?? {}),
    quality: isQualityLevel(r.quality) ? r.quality : DEFAULT_GAME_SETTINGS.quality,
    resolution: Number.isFinite(Number(r.resolution)) ? Math.max(0.4, Math.min(1, Number(r.resolution))) : 1,
    bridge: {
      host: typeof b.host === 'string' && b.host.trim() ? b.host.trim().slice(0, 100) : '127.0.0.1',
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3100,
      enabled: b.enabled === 'on' || b.enabled === 'off' ? b.enabled : 'auto',
    },
    gifts: r.gifts ? sanitizeMapping(r.gifts) : sanitizeMapping(DEFAULT_MAPPING),
    audio: {
      master: vol(a.master, DEFAULT_VOLUMES.master),
      music: vol(a.music, DEFAULT_VOLUMES.music),
      sfx: vol(a.sfx, DEFAULT_VOLUMES.sfx),
    },
  };
}

/** Разобрать файл настроек. Неизвестные и испорченные поля — значения по умолчанию. */
export function importSettings(text: string): GameSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Это не файл настроек: не удалось прочитать JSON');
  }
  const r = raw as { app?: unknown; settings?: unknown };
  if (!r || typeof r !== 'object' || r.app !== SETTINGS_FILE_TAG || !r.settings)
    throw new Error('Это не файл настроек игры');
  return sanitizeSettings(r.settings);
}

export function loadSettings(fresh: boolean): GameSettings {
  if (fresh) return sanitizeSettings({});
  const raw = storage()?.getItem(KEY);
  if (!raw) return sanitizeSettings({});
  try {
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return sanitizeSettings({});
  }
}

export function saveSettings(s: GameSettings, fresh: boolean): void {
  if (fresh) return;
  try {
    storage()?.setItem(KEY, JSON.stringify(s));
  } catch {
    // Хранилище переполнено или запрещено — настройки живут до перезагрузки.
  }
}
