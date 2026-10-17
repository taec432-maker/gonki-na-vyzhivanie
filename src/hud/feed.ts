import { EFFECTS, type EffectId } from '../combat/effects';
import { esc } from './format';

export interface FeedItem {
  name: string;
  /** Подарок (или «Лайки», «Чат»). */
  what: string;
  icon: string | null;
  effect: EffectId | null;
  /** Что случилось: «сработает на старте», «в очереди на заезд». */
  note?: string;
  test: boolean;
  color?: string;
  /** Значок вместо иконки подарка (системные события: взрыв, выбывание). */
  emoji?: string;
}

/** Лента событий: карточки «Ник ▸ Подарок ▸ Эффект» на 3 с, не больше 5 одновременно. */
export class EventFeed {
  private readonly root: HTMLElement;
  /** Для оверлея и тестов — последние события. */
  readonly history: FeedItem[] = [];
  seconds = 3;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'feed';
    parent.append(this.root);
  }

  push(item: FeedItem): void {
    this.history.push(item);
    if (this.history.length > 50) this.history.shift();
    const el = document.createElement('div');
    el.className = 'card';
    const eff = item.effect ? EFFECTS[item.effect] : null;
    const icon = item.icon
      ? `<img src="${esc(item.icon)}" alt="" referrerpolicy="no-referrer" />`
      : `<span class="emoji">${item.emoji ?? eff?.icon ?? '🎁'}</span>`;
    el.innerHTML = `${item.test ? '<span class="test">ТЕСТ</span>' : ''}
      <span class="who" ${item.color ? `style="color:${item.color}"` : ''}>${esc(item.name)}</span>
      <span class="sep">▸</span>${icon}<span class="what">${esc(item.what)}</span>
      ${eff ? `<span class="sep">▸</span><span class="eff">${eff.icon} ${eff.label}</span>` : ''}
      ${item.note ? `<span class="note">${esc(item.note)}</span>` : ''}`;
    const img = el.querySelector('img');
    if (img)
      img.onerror = () =>
        img.replaceWith(Object.assign(document.createElement('span'), { className: 'emoji', textContent: '🎁' }));
    this.root.prepend(el);
    while (this.root.children.length > 5) this.root.lastElementChild?.remove();
    setTimeout(() => el.classList.add('gone'), this.seconds * 1000);
    setTimeout(() => el.remove(), this.seconds * 1000 + 400);
  }
}

/** Общий нитро-бар лайков и индикатор Bridge. */
export class LikeBar {
  private readonly el: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly label: HTMLElement;
  private lastKey = '';

  constructor(parent: HTMLElement) {
    parent.insertAdjacentHTML(
      'beforeend',
      `<div id="likebar" class="panel"><div class="lb-text"><span>❤ Лайки → общий нитро</span><b id="lb-count"></b></div><div class="lb-track"><i id="lb-fill"></i></div></div>`,
    );
    this.el = parent.querySelector('#likebar') as HTMLElement;
    this.fill = parent.querySelector('#lb-fill') as HTMLElement;
    this.label = parent.querySelector('#lb-count') as HTMLElement;
  }

  update(bar: number, target: number, bursts: number, visible: boolean): void {
    this.el.classList.toggle('hidden', !visible);
    const key = `${bar}|${target}|${bursts}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.fill.style.width = `${Math.min(100, (bar / target) * 100).toFixed(1)}%`;
    this.label.textContent = `${bar}/${target}${bursts ? ` · Общий нитро ×${bursts}` : ''}`;
  }

  burst(): void {
    this.el.classList.remove('boom');
    void this.el.offsetWidth;
    this.el.classList.add('boom');
  }
}

export class BridgeIndicator {
  private readonly el: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bridge-ind';
    parent.append(this.el);
  }

  set(state: string, live: boolean | null): void {
    const map: Record<string, [string, string]> = {
      off: ['', 'mock'],
      connecting: ['подключение к Bridge…', 'wait'],
      connected: [live === false ? 'TikTok не в эфире' : 'Bridge', live === false ? 'warn' : 'ok'],
      disconnected: ['Bridge не подключён', 'bad'],
      foreign: ['чужой сервер вместо Bridge', 'bad'],
    };
    const [text, cls] = map[state] ?? ['', 'mock'];
    const key = `${text}|${cls}`;
    if (key === this.last) return;
    this.last = key;
    this.el.className = cls;
    this.el.textContent = text;
    this.el.style.display = text ? '' : 'none';
  }
}
