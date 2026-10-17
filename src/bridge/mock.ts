import { Rng } from '../core/rng';
import type { BridgeEnvelope, ChatData, GiftData, LikeData } from './protocol';

/**
 * Мок-режим без Bridge (раздел 5 ТЗ): панель создаёт сообщения ТОЧНО в формате Bridge,
 * и они идут через тот же разбор (EventNormalizer), что и настоящие.
 */
const FIRST = [
  'alex',
  'Маша',
  'dimon',
  'Котик',
  'nastya',
  'Gamer',
  'Влад',
  'lera',
  'Pro100',
  'Санёк',
  'kira',
  'Ёжик',
  'max',
  'Олег',
  'polina',
  'Turbo',
  'Даша',
  'ivan',
  'Лиса',
  'Shadow',
  'Артём',
  'zhenya',
  'Бублик',
  'Racer',
];
const SUFFIX = ['', '_2010', '777', '🔥', ' ✨', '_official', '.tt', '99', '_ru', '😎', 'Х', '_live', ''];

export class MockViewers {
  private readonly rng: Rng;
  private n = 0;
  private ev = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed).fork('mock');
  }

  private id(): string {
    return `mock-${Date.now().toString(36)}-${++this.ev}`;
  }

  /** Новый случайный зритель: {userId, nickname}. */
  viewer(): { userId: string; name: string } {
    this.n++;
    const name = `${this.rng.pick(FIRST)}${this.rng.pick(SUFFIX)}`;
    return { userId: `mock${this.n}`, name: this.n > FIRST.length ? `${name}${this.n}` : name };
  }

  chat(userId: string, name: string, text = 'привет'): BridgeEnvelope<ChatData> {
    return {
      event: 'chat',
      type: 'comment',
      eventId: this.id(),
      source: 'mock',
      receivedAt: Date.now(),
      test: true,
      data: { type: 'comment', username: name, userId, text, timestamp: Date.now() },
    };
  }

  /**
   * Подарок как в TikTok: серия сообщений с растущим repeatCount, последнее — repeatEnd.
   * Для giftType 1 (комбо) — count сообщений; иначе одно.
   */
  gift(
    userId: string,
    name: string,
    giftName: string,
    diamondCount: number,
    repeatCount = 1,
    giftId = '',
  ): BridgeEnvelope<GiftData>[] {
    const out: BridgeEnvelope<GiftData>[] = [];
    for (let i = 1; i <= repeatCount; i++) {
      const last = i === repeatCount;
      out.push({
        event: 'gift',
        type: 'gift',
        eventId: this.id(),
        source: 'mock',
        receivedAt: Date.now(),
        test: true,
        mappedAction: 'hit',
        data: {
          giftName,
          giftId,
          diamondCount,
          repeatCount: i,
          repeatEnd: last,
          giftType: 1,
          streaking: !last,
          user: { userId, uniqueId: name.toLowerCase(), nickname: name },
        },
      });
    }
    return out;
  }

  like(userId: string, name: string, likeCount: number): BridgeEnvelope<LikeData> {
    return {
      event: 'like',
      type: 'like',
      eventId: this.id(),
      source: 'mock',
      receivedAt: Date.now(),
      test: true,
      data: { likeCount, totalLikeCount: likeCount, user: { userId, uniqueId: name, nickname: name } },
    };
  }
}
