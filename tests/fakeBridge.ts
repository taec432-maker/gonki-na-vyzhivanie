import { WebSocketServer, type WebSocket } from 'ws';

/** Фейковый TikTok Bridge для тестов: говорит по протоколу раздела 5 ТЗ. */
export class FakeBridge {
  wss: WebSocketServer | null = null;
  readonly received: unknown[] = [];
  clients = new Set<WebSocket>();
  port = 0;
  bridgeName = 'tiktok-bridge';
  protocolVersion = 1;

  async start(port = 0): Promise<number> {
    this.wss = new WebSocketServer({ port, host: '127.0.0.1' });
    await new Promise<void>((r) => this.wss?.once('listening', () => r()));
    this.port = (this.wss.address() as { port: number }).port;
    this.wss.on('connection', (ws, req) => {
      this.clients.add(ws);
      this.received.push({ url: req.url });
      ws.send(
        JSON.stringify({
          event: 'welcome',
          source: 'server',
          data: {
            message: 'TikTok Bridge local events channel',
            clientId: `c1-${this.clients.size}`,
            bridge: this.bridgeName,
            protocolVersion: this.protocolVersion,
            capabilities: ['events', 'game_action:hcr'],
          },
        }),
      );
      ws.on('message', (d) => {
        const msg = JSON.parse(d.toString()) as { event?: string };
        this.received.push(msg);
        if (msg.event === 'ping') ws.send(JSON.stringify({ event: 'pong' }));
      });
      ws.on('close', () => this.clients.delete(ws));
    });
    return this.port;
  }

  send(obj: unknown): void {
    for (const c of this.clients) c.send(JSON.stringify(obj));
  }

  async stop(): Promise<void> {
    for (const c of this.clients) c.terminate();
    this.clients.clear();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
    this.wss = null;
  }
}

/** Набор событий Bridge: старый catchup, чат, комбо из трёх сообщений, дубликат, лайки, чужие события. */
export function scriptedEvents(): unknown[] {
  const user = { userId: '7001', uniqueId: 'alex_123', nickname: 'Alex', profilePictureUrl: 'https://x/p.png' };
  const gift = (n: number, end: boolean, id: string) => ({
    event: 'gift',
    type: 'gift',
    eventId: id,
    source: 'tiktok-live-connector',
    receivedAt: 1760000000000 + n,
    roomId: 'r1',
    streamer: 's',
    data: {
      giftName: 'Rose',
      giftId: '5655',
      diamondCount: 1,
      repeatCount: n,
      repeatEnd: end,
      giftType: 1,
      streaking: !end,
      giftPictureUrl: 'https://x/rose.png',
      user,
    },
    mappedAction: 'hit',
  });
  return [
    { event: 'catchup', data: { gifts: [gift(9, true, 'old-1')] } },
    {
      event: 'chat',
      type: 'comment',
      eventId: 'c1',
      data: { type: 'comment', username: 'Alex', userId: '7001', text: 'привет', timestamp: 1 },
    },
    gift(1, false, 'g1'),
    gift(2, false, 'g2'),
    gift(3, true, 'g3'),
    gift(3, true, 'g3'),
    { event: 'like', type: 'like', eventId: 'l1', data: { likeCount: 15, totalLikeCount: 1234, user } },
    { event: 'media', eventId: 'm1', data: {} },
    { event: 'game_action', eventId: 'ga1', data: {} },
    {
      event: 'chat',
      type: 'comment',
      eventId: 'c2',
      test: true,
      data: { type: 'comment', username: 'Маша', userId: '', text: 'тест' },
    },
  ];
}
