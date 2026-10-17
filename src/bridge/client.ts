import type { BridgeEnvelope, WelcomeData } from './protocol';

/**
 * Клиент TikTok Bridge (раздел 5 ТЗ):
 *  - ws://HOST:PORT/events?role=game&client=race, резервный порт 3101;
 *  - первым приходит welcome: bridge === "tiktok-bridge" и protocolVersion === 1,
 *    иначе это чужой сервер — ошибка в статусе;
 *  - после welcome шлём {"role":"game","client":"race"}; catchup (старые подарки) игнорируем;
 *  - ping раз в 15 с, без ответа 10 с — переподключение;
 *  - переподключение с экспоненциальной паузой 1 → 30 с.
 * Сами события (gift/chat/like) отдаются наружу как есть — разбор в EventNormalizer.
 */
export type BridgeState = 'off' | 'connecting' | 'connected' | 'disconnected' | 'foreign';

export interface BridgeStatus {
  state: BridgeState;
  /** TikTok-эфир подключён в Bridge (если Bridge сообщает), null — неизвестно. */
  live: boolean | null;
  url: string;
  error: string | null;
  /** Через сколько мс следующая попытка. */
  retryIn: number;
  clientId: string | null;
  events: number;
}

export interface BridgeOptions {
  host: string;
  port: number;
  /** Резервный порт: попытки чередуются между основным и резервным. */
  fallbackPort?: number;
  onEvent: (msg: BridgeEnvelope) => void;
  onStatus?: (s: BridgeStatus) => void;
  /** Подмена WebSocket (тесты в Node). */
  socketFactory?: (url: string) => WebSocket;
  pingMs?: number;
  pongTimeoutMs?: number;
  minRetryMs?: number;
  maxRetryMs?: number;
}

const IGNORED = new Set(['welcome', 'catchup', 'pong', 'media', 'game_action', 'status']);

export class BridgeClient {
  private ws: WebSocket | null = null;
  private readonly opts: Required<Omit<BridgeOptions, 'onStatus' | 'socketFactory' | 'fallbackPort'>> &
    Pick<BridgeOptions, 'onStatus' | 'socketFactory' | 'fallbackPort'>;
  private retry: number;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;
  private welcomed = false;
  readonly status: BridgeStatus;

  constructor(opts: BridgeOptions) {
    this.opts = {
      pingMs: 15000,
      pongTimeoutMs: 10000,
      minRetryMs: 1000,
      maxRetryMs: 30000,
      ...opts,
    };
    this.retry = this.opts.minRetryMs;
    this.status = {
      state: 'off',
      live: null,
      url: this.urlFor(opts.port),
      error: null,
      retryIn: 0,
      clientId: null,
      events: 0,
    };
  }

  urlFor(port: number): string {
    return `ws://${this.opts.host}:${port}/events?role=game&client=race`;
  }

  private setStatus(patch: Partial<BridgeStatus>): void {
    Object.assign(this.status, patch);
    this.opts.onStatus?.({ ...this.status });
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus({ state: 'off', retryIn: 0 });
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.retryTimer = this.pingTimer = this.pongTimer = null;
  }

  private connect(): void {
    if (this.stopped) return;
    // Чередуем основной и резервный порт.
    const port = this.opts.fallbackPort && this.attempt % 2 === 1 ? this.opts.fallbackPort : this.opts.port;
    this.attempt++;
    const url = this.urlFor(port);
    this.welcomed = false;
    this.setStatus({ state: 'connecting', url, retryIn: 0 });
    let ws: WebSocket;
    try {
      ws = this.opts.socketFactory ? this.opts.socketFactory(url) : new WebSocket(url);
    } catch (e) {
      this.setStatus({ error: String(e) });
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    // Не дождались welcome за 8 с — считаем, что не подключились.
    const openTimer = setTimeout(() => {
      if (this.ws === ws && !this.welcomed) lost();
    }, 8000);
    const lost = (): void => {
      clearTimeout(openTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        ws.close();
      } catch {
        // Уже закрыт.
      }
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pingTimer = this.pongTimer = null;
      if (this.status.state !== 'foreign') this.setStatus({ state: 'disconnected' });
      this.scheduleRetry();
    };
    ws.onmessage = (e: MessageEvent) => this.onMessage(String(e.data));
    ws.onclose = lost;
    // Браузер после ошибки присылает close, а WebSocket в Node — нет: обрабатываем оба случая.
    ws.onerror = lost;
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const wait = this.retry;
    this.retry = Math.min(this.opts.maxRetryMs, this.retry * 2);
    this.setStatus({ retryIn: wait });
    this.retryTimer = setTimeout(() => this.connect(), wait);
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  private onMessage(text: string): void {
    let msg: BridgeEnvelope;
    try {
      msg = JSON.parse(text) as BridgeEnvelope;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.event !== 'string') return;
    if (!this.welcomed) {
      if (msg.event !== 'welcome') return;
      const d = (msg.data ?? {}) as WelcomeData;
      if (d.bridge !== 'tiktok-bridge' || d.protocolVersion !== 1) {
        this.setStatus({
          state: 'foreign',
          error: `Чужой сервер: bridge=${String(d.bridge)}, protocolVersion=${String(d.protocolVersion)}`,
        });
        this.ws?.close();
        return;
      }
      this.welcomed = true;
      this.retry = this.opts.minRetryMs;
      this.attempt = 0;
      this.setStatus({ state: 'connected', error: null, clientId: d.clientId ?? null });
      this.send({ role: 'game', client: 'race' });
      this.startPing();
      return;
    }
    if (msg.event === 'pong') {
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = null;
      return;
    }
    if (msg.event === 'status') {
      const live = parseLive(msg.data);
      if (live !== null) this.setStatus({ live });
      return;
    }
    if (IGNORED.has(msg.event)) return;
    this.status.events++;
    this.opts.onEvent(msg);
  }

  private startPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      this.send({ event: 'ping' });
      if (this.pongTimer) return;
      this.pongTimer = setTimeout(() => {
        // Нет ответа — соединение «мёртвое», переподключаемся.
        this.pongTimer = null;
        this.ws?.close();
      }, this.opts.pongTimeoutMs);
    }, this.opts.pingMs);
  }
}

/**
 * Статус TikTok-эфира из события status Bridge. Формат в ТЗ не описан — понимаем
 * распространённые варианты полей; если ничего не нашли — null («неизвестно»).
 */
export function parseLive(data: unknown): boolean | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  for (const k of ['live', 'isLive', 'tiktokConnected', 'connected', 'isConnected'])
    if (typeof d[k] === 'boolean') return d[k] as boolean;
  for (const k of ['state', 'status', 'tiktok']) {
    const v = d[k];
    if (typeof v === 'string') {
      const s = v.toLowerCase();
      if (/(^|_)(offline|disconnected|not.?live|ended|error|stopped)/.test(s)) return false;
      if (/(^|_)(online|connected|live|streaming)/.test(s)) return true;
    }
  }
  return null;
}
