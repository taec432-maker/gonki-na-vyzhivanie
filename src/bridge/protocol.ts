/**
 * Протокол TikTok Bridge — раздел 5 ТЗ, дословно.
 * Общая обёртка: event, type, eventId, source, receivedAt, roomId, streamer, data, иногда test: true.
 */
export interface BridgeUser {
  userId?: string;
  uniqueId?: string;
  nickname?: string;
  profilePictureUrl?: string;
}

export interface BridgeEnvelope<T = unknown> {
  event: string;
  type?: string;
  eventId?: string;
  source?: string;
  receivedAt?: number;
  roomId?: string;
  streamer?: string;
  data?: T;
  test?: boolean;
  /** Чужой глобальный маппинг Bridge — игнорируем (ТЗ). */
  mappedAction?: string;
}

export interface WelcomeData {
  message?: string;
  clientId?: string;
  bridge?: string;
  protocolVersion?: number;
  capabilities?: string[];
}

export interface GiftData {
  giftName?: string;
  giftId?: string | number;
  diamondCount?: number;
  repeatCount?: number;
  repeatEnd?: boolean;
  giftType?: number;
  streaking?: boolean;
  giftPictureUrl?: string;
  user?: BridgeUser;
}

export interface ChatData {
  type?: string;
  username?: string;
  userId?: string;
  text?: string;
  timestamp?: number;
}

export interface LikeData {
  likeCount?: number;
  totalLikeCount?: number;
  user?: BridgeUser;
}

/** Нормализованные события, которые понимает игра (и реальные, и мок). */
export interface ChatEvent {
  kind: 'chat';
  /** Ключ игрока: userId, а если пустой — username. */
  userId: string;
  name: string;
  text: string;
  test: boolean;
}

export interface GiftEvent {
  kind: 'gift';
  userId: string;
  name: string;
  giftName: string;
  giftId: string;
  /** Алмазов за одну штуку. */
  diamonds: number;
  /** Сколько штук в комбо. */
  count: number;
  /** Итоговая стоимость: diamondCount × repeatCount. */
  total: number;
  picture: string | null;
  test: boolean;
}

export interface LikeEvent {
  kind: 'like';
  userId: string;
  name: string;
  count: number;
  test: boolean;
}

export type GameEvent = ChatEvent | GiftEvent | LikeEvent;
