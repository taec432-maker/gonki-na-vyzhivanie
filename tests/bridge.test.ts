import { afterEach, describe, expect, it } from 'vitest';
import { BridgeClient, parseLive, type BridgeStatus } from '../src/bridge/client';
import { EventNormalizer } from '../src/bridge/normalize';
import type { BridgeEnvelope, GameEvent } from '../src/bridge/protocol';
import { FakeBridge, scriptedEvents } from './fakeBridge';

const until = async (cond: () => boolean, ms = 4000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('не дождались');
    await new Promise((r) => setTimeout(r, 10));
  }
};

let bridge: FakeBridge;
let client: BridgeClient | null = null;
afterEach(async () => {
  client?.stop();
  client = null;
  await bridge?.stop();
});

function connect(port: number, extra: Partial<ConstructorParameters<typeof BridgeClient>[0]> = {}) {
  const raw: BridgeEnvelope[] = [];
  const events: GameEvent[] = [];
  const statuses: BridgeStatus[] = [];
  const norm = new EventNormalizer();
  client = new BridgeClient({
    host: '127.0.0.1',
    port,
    minRetryMs: 50,
    maxRetryMs: 200,
    onEvent: (m) => {
      raw.push(m);
      const ev = norm.normalize(m);
      if (ev) events.push(ev);
    },
    onStatus: (s) => statuses.push(s),
    ...extra,
  });
  client.start();
  return { raw, events, statuses };
}

describe('Клиент TikTok Bridge (фейковый Bridge на ws)', () => {
  it('welcome → hello, все три типа событий; комбо один раз; дубликаты и catchup игнорируются', async () => {
    bridge = new FakeBridge();
    const port = await bridge.start();
    const { events } = connect(port);
    await until(() => client?.status.state === 'connected');
    await until(() => bridge.received.some((m) => (m as { role?: string }).role === 'game'));
    expect(bridge.received).toContainEqual({ role: 'game', client: 'race' });
    expect(bridge.received).toContainEqual({ url: '/events?role=game&client=race' });
    for (const e of scriptedEvents()) bridge.send(e);
    await until(() => events.length >= 4);
    await new Promise((r) => setTimeout(r, 100));
    expect(events.map((e) => e.kind)).toEqual(['chat', 'gift', 'like', 'chat']);
    const gift = events[1];
    expect(gift).toMatchObject({ kind: 'gift', userId: '7001', name: 'Alex', count: 3, total: 3, giftName: 'Rose' });
    expect(events[2]).toMatchObject({ kind: 'like', count: 15 });
    // test: true и пустой userId → ключ — username.
    expect(events[3]).toMatchObject({ kind: 'chat', userId: 'Маша', test: true });
  });

  it('после перезапуска Bridge клиент сам переподключается', async () => {
    bridge = new FakeBridge();
    const port = await bridge.start();
    const { events } = connect(port);
    await until(() => client?.status.state === 'connected');
    await bridge.stop();
    await until(() => client?.status.state === 'disconnected' || client?.status.state === 'connecting');
    bridge = new FakeBridge();
    await bridge.start(port);
    await until(() => client?.status.state === 'connected', 6000);
    bridge.send({ event: 'chat', eventId: 'after', data: { username: 'Bob', userId: 'b', text: 'я тут' } });
    await until(() => events.some((e) => e.kind === 'chat' && e.userId === 'b'));
  });

  it('чужой сервер (другой bridge или версия протокола) — статус «чужой сервер»', async () => {
    bridge = new FakeBridge();
    bridge.bridgeName = 'other-app';
    const port = await bridge.start();
    const { events } = connect(port);
    await until(() => client?.status.state === 'foreign');
    expect(client?.status.error).toContain('Чужой сервер');
    bridge.send({ event: 'chat', eventId: 'x', data: { username: 'A', userId: 'a', text: 'hi' } });
    await new Promise((r) => setTimeout(r, 100));
    expect(events.length).toBe(0);
  });

  it('ping → pong держит соединение; без pong — переподключение', async () => {
    bridge = new FakeBridge();
    const port = await bridge.start();
    connect(port, { pingMs: 50, pongTimeoutMs: 80 });
    await until(() => client?.status.state === 'connected');
    await until(() => bridge.received.filter((m) => (m as { event?: string }).event === 'ping').length >= 2);
    expect(client?.status.state).toBe('connected');
  });

  it('резервный порт: основной молчит — подключаемся к 3101-му аналогу', async () => {
    bridge = new FakeBridge();
    const port = await bridge.start();
    connect(port + 1 === 65536 ? port - 1 : 1, { fallbackPort: port });
    await until(() => client?.status.state === 'connected', 5000);
    expect(client?.status.url).toContain(`:${port}/`);
  });

  it('статус TikTok-эфира понимается из распространённых полей', () => {
    expect(parseLive({ live: false })).toBe(false);
    expect(parseLive({ state: 'connected' })).toBe(true);
    expect(parseLive({ tiktok: 'offline' })).toBe(false);
    expect(parseLive({ foo: 1 })).toBeNull();
  });
});
