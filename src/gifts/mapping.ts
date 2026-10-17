import { isEffectId, type EffectId } from '../combat/effects';
import defaults from './defaults.json';

/**
 * Маппинг подарок → эффект (раздел 7 ТЗ). Двухуровневый:
 *  1) переопределение по точному giftId или giftName (без учёта регистра);
 *  2) иначе — тир по стоимости одного сообщения (diamondCount × repeatCount).
 */
export interface Tier {
  min: number;
  max: number;
  effect: EffectId;
  power: number;
}

export interface Override {
  /** giftId или giftName — что из них задано. */
  giftId?: string;
  giftName?: string;
  effect: EffectId;
  power: number;
}

export interface GiftMapping {
  tiers: Tier[];
  overrides: Override[];
  likes: { target: number; nitroSeconds: number };
}

export interface Resolved {
  effect: EffectId;
  power: number;
  /** Откуда взяли: override или tier. */
  via: 'override' | 'tier';
}

export const DEFAULT_MAPPING: GiftMapping = sanitizeMapping(defaults);

export function sanitizeMapping(raw: unknown): GiftMapping {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<GiftMapping>;
  const num = (v: unknown, d: number, lo = 0, hi = 1e9): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };
  const tiers: Tier[] = Array.isArray(r.tiers)
    ? r.tiers
        .filter((t) => t && isEffectId((t as Tier).effect))
        .map((t) => ({
          min: Math.floor(num(t.min, 1, 0)),
          max: Math.floor(num(t.max, 1e9, 0)),
          effect: t.effect,
          power: num(t.power, 1, 0.1, 10),
        }))
        .sort((a, b) => a.min - b.min)
    : [];
  const overrides: Override[] = Array.isArray(r.overrides)
    ? r.overrides
        .filter((o) => o && isEffectId((o as Override).effect) && (o.giftId || o.giftName))
        .map((o) => ({
          ...(o.giftId ? { giftId: String(o.giftId) } : {}),
          ...(o.giftName ? { giftName: String(o.giftName) } : {}),
          effect: o.effect,
          power: num(o.power, 1, 0.1, 10),
        }))
    : [];
  const likes = (r.likes ?? {}) as Partial<GiftMapping['likes']>;
  return {
    tiers: tiers.length ? tiers : (defaults.tiers as Tier[]).map((t) => ({ ...t })),
    overrides,
    likes: { target: Math.round(num(likes.target, 500, 10, 1e6)), nitroSeconds: num(likes.nitroSeconds, 3, 0.5, 20) },
  };
}

export function resolveGift(
  m: GiftMapping,
  gift: { giftId: string; giftName: string; total: number },
): Resolved | null {
  const name = gift.giftName.trim().toLowerCase();
  const byId = gift.giftId ? m.overrides.find((o) => o.giftId === gift.giftId) : undefined;
  const byName = byId ?? m.overrides.find((o) => o.giftName && o.giftName.trim().toLowerCase() === name);
  if (byName) return { effect: byName.effect, power: byName.power, via: 'override' };
  const tier = m.tiers.find((t) => gift.total >= t.min && gift.total <= t.max);
  if (tier) return { effect: tier.effect, power: tier.power, via: 'tier' };
  // Дороже всех тиров — самый дорогой; дешевле — ничего.
  const top = m.tiers.at(-1);
  if (top && gift.total > top.max) return { effect: top.effect, power: top.power, via: 'tier' };
  return null;
}
