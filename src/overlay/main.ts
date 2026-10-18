import { LinkChannel, relayUrlFor } from '../core/channel';
import type { GameStatus } from '../game';
import { EFFECTS, type EffectId } from '../combat/effects';
import '../styles/overlay.css';

/**
 * Прозрачный оверлей для второго Browser Source в OBS (раздел 4 ТЗ): лидерборд сессии
 * и лента событий. Данные — из статуса игры (раз в полсекунды через тот же канал, что и панель).
 * ?only=board — только лидерборд, ?only=feed — только лента (если их удобнее ставить
 * отдельными источниками в разные углы).
 */
const only = new URLSearchParams(location.search).get('only');
document.documentElement.style.background = 'transparent';
document.body.style.background = 'transparent';
const root = document.getElementById('overlay') as HTMLElement;
root.innerHTML = `
  <section class="ov-board"><div class="ov-title">Лидерборд сессии</div><ol id="ov-lb"></ol></section>
  <section class="ov-feed" id="ov-feed"></section>`;
const lb = document.getElementById('ov-lb') as HTMLElement;
const feed = document.getElementById('ov-feed') as HTMLElement;
if (only === 'board') feed.hidden = true;
if (only === 'feed') (lb.parentElement as HTMLElement).hidden = true;
const effectLabel = (id: string | null): string => {
  const e = id ? EFFECTS[id as EffectId] : undefined;
  return e ? `${e.icon} ${e.label}` : '';
};
const esc = (t: string): string => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let lastKey = '';
const channel = new LinkChannel('overlay', relayUrlFor(location));
channel.on((msg) => {
  if (msg.type !== 'status') return;
  const s = msg.payload as GameStatus;
  // Лента: последние 5 событий за 20 с — старое уходит, чтобы не висело весь эфир.
  const recent = s.feed.filter((f) => Date.now() - f.at < 20_000).slice(-5);
  const key = JSON.stringify([s.leaderboard, recent]);
  if (key === lastKey) return;
  lastKey = key;
  lb.innerHTML = s.leaderboard.length
    ? s.leaderboard
        .slice(0, 10)
        .map(
          (r, i) =>
            `<li><span class="pl">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="pt">${r.points}</span></li>`,
        )
        .join('')
    : '<li class="empty">Очки появятся после первого заезда</li>';
  feed.innerHTML = recent
    .slice()
    .reverse()
    .map(
      (f) =>
        `<div class="ov-card"><b>${esc(f.name)}</b> ▸ ${esc(f.what)}${f.effect ? ` ▸ <i>${esc(effectLabel(f.effect))}</i>` : ''}</div>`,
    )
    .join('');
});
channel.send('hello', null);
