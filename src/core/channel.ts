/**
 * Связь между страницами игры: / (игра), /control (панель), /overlay (оверлей).
 *
 * Два транспорта сразу:
 *  - BroadcastChannel — когда все страницы открыты в одном браузере (и на GitHub Pages);
 *  - WebSocket-ретранслятор /relay нашего локального сервера (scripts/serve.mjs) —
 *    когда игра в OBS, а панель в Chrome: это разные браузеры, BroadcastChannel
 *    между ними не работает (см. docs/РЕШЕНИЯ.md).
 * Повторы (одно сообщение по двум путям) отбрасываются по id.
 */
export type Role = 'game' | 'control' | 'overlay';

export interface Envelope<T = unknown> {
  id: string;
  from: Role;
  type: string;
  payload: T;
}

type Listener = (msg: Envelope) => void;

export class LinkChannel {
  readonly role: Role;
  private bc: BroadcastChannel | null = null;
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private seen = new Map<string, number>();
  private counter = 0;
  private readonly instance = Math.floor(Math.random() * 1e9).toString(36);
  private closed = false;
  private retry = 1000;
  relayConnected = false;

  constructor(role: Role, relayUrl: string | null) {
    this.role = role;
    if (typeof BroadcastChannel !== 'undefined') {
      this.bc = new BroadcastChannel('gonki-na-vyzhivanie');
      this.bc.onmessage = (e: MessageEvent<Envelope>) => this.receive(e.data);
    }
    if (relayUrl) this.connectRelay(relayUrl);
  }

  private connectRelay(url: string): void {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.relayConnected = true;
      this.retry = 1000;
    };
    ws.onmessage = (e) => {
      try {
        this.receive(JSON.parse(String(e.data)) as Envelope);
      } catch {
        // Не JSON — не наше сообщение.
      }
    };
    ws.onclose = () => {
      this.relayConnected = false;
      this.ws = null;
      if (this.closed) return;
      setTimeout(() => this.connectRelay(url), this.retry);
      this.retry = Math.min(15000, this.retry * 2);
    };
    ws.onerror = () => ws.close();
  }

  private receive(msg: Envelope): void {
    if (!msg || typeof msg.id !== 'string' || msg.from === this.role) return;
    if (this.seen.has(msg.id)) return;
    this.seen.set(msg.id, Date.now());
    if (this.seen.size > 500) {
      const cutoff = Date.now() - 10000;
      for (const [k, t] of this.seen) if (t < cutoff) this.seen.delete(k);
    }
    for (const l of this.listeners) l(msg);
  }

  send<T>(type: string, payload: T): void {
    const msg: Envelope<T> = { id: `${this.role}-${this.instance}-${++this.counter}`, from: this.role, type, payload };
    this.bc?.postMessage(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.bc?.close();
    this.ws?.close();
  }
}

/** Адрес ретранслятора: есть только у локального сервера (http://127.0.0.1:8091). */
export function relayUrlFor(loc: Location): string | null {
  const local = loc.hostname === '127.0.0.1' || loc.hostname === 'localhost';
  if (!local || loc.protocol !== 'http:') return null;
  return `ws://${loc.host}/relay`;
}
