import type { BridgeEnvelope, ChatData, GameEvent, GiftData, LikeData } from './protocol';

/**
 * Разбор сообщений Bridge в события игры (раздел 5 ТЗ):
 *  - дедуп по eventId;
 *  - подарок начисляется ОДИН раз — на сообщении с repeatEnd: true (или streaking: false),
 *    количество = repeatCount, стоимость = diamondCount × repeatCount;
 *  - чат: ключ игрока — userId, если пустой — username;
 *  - остальные event (media, game_action, status, welcome, catchup…) — молча игнорируются.
 * Тот же код обрабатывает мок-события из панели (src/bridge/mock.ts).
 */
export class EventNormalizer {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];
  private readonly limit: number;

  constructor(limit = 5000) {
    this.limit = limit;
  }

  private dedupe(id: string | undefined): boolean {
    if (!id) return true;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.order.push(id);
    if (this.order.length > this.limit) {
      const old = this.order.shift();
      if (old !== undefined) this.seen.delete(old);
    }
    return true;
  }

  normalize(msg: BridgeEnvelope): GameEvent | null {
    if (!msg || typeof msg !== 'object') return null;
    const test = msg.test === true;
    switch (msg.event) {
      case 'chat': {
        const d = (msg.data ?? {}) as ChatData;
        if (!this.dedupe(msg.eventId)) return null;
        const name = String(d.username ?? '').trim();
        const userId = String(d.userId ?? '').trim() || name;
        if (!userId) return null;
        return { kind: 'chat', userId, name: name || userId, text: String(d.text ?? ''), test };
      }
      case 'gift': {
        const d = (msg.data ?? {}) as GiftData;
        // Комбо ещё «накручивается» — ждём финального сообщения.
        const final = d.repeatEnd === true || d.streaking === false;
        if (!final) return null;
        if (!this.dedupe(msg.eventId)) return null;
        const u = d.user ?? {};
        const name = String(u.nickname ?? u.uniqueId ?? '').trim();
        const userId = String(u.userId ?? '').trim() || String(u.uniqueId ?? '').trim() || name;
        if (!userId) return null;
        const diamonds = Math.max(0, Number(d.diamondCount ?? 0) || 0);
        const count = Math.max(1, Math.floor(Number(d.repeatCount ?? 1) || 1));
        return {
          kind: 'gift',
          userId,
          name: name || userId,
          giftName: String(d.giftName ?? 'Подарок'),
          giftId: String(d.giftId ?? ''),
          diamonds,
          count,
          total: diamonds * count,
          picture: d.giftPictureUrl ? String(d.giftPictureUrl) : null,
          test,
        };
      }
      case 'like': {
        const d = (msg.data ?? {}) as LikeData;
        if (!this.dedupe(msg.eventId)) return null;
        const u = d.user ?? {};
        const name = String(u.nickname ?? u.uniqueId ?? '').trim();
        const userId = String(u.userId ?? '').trim() || name;
        const count = Math.max(0, Math.floor(Number(d.likeCount ?? 0) || 0));
        if (count === 0) return null;
        return { kind: 'like', userId, name, count, test };
      }
      default:
        return null;
    }
  }
}
