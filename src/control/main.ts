import '../styles/control.css';
import { LinkChannel, relayUrlFor } from '../core/channel';
import type { GameStatus } from '../game';
import { QUALITY, type QualityLevel } from '../render/quality';
import { mountGifts } from './gifts';

/** Панель стримера: управляет игрой через LinkChannel (BroadcastChannel + ретранслятор). */
const channel = new LinkChannel('control', relayUrlFor(location));
const app = document.getElementById('app') as HTMLElement;

app.innerHTML = `
<header>
  <h1>Гонки на выживание — панель</h1>
  <span id="link" class="pill bad">Игра не найдена</span>
  <span id="relay" class="pill muted"></span>
</header>
<main>
  <section>
    <h2>Гонка</h2>
    <div class="row">
      <button class="primary" data-cmd="start">Старт</button>
      <button data-cmd="stop">Стоп</button>
      <button data-cmd="restart">Рестарт</button>
      <button data-cmd="next-race">Следующий заезд</button>
    </div>
    <div class="kv" id="status"></div>
  </section>
  <section>
    <h2>Зрители (тест без TikTok)</h2>
    <div class="row">
      <button class="primary" id="mock-1">+1 тест-игрок</button>
      <button id="mock-20">+20 случайных игроков</button>
    </div>
    <div class="row">
      <input id="chat-name" placeholder="ник" size="12" />
      <input id="chat-text" placeholder="сообщение" size="14" value="привет" />
      <button id="chat-send">Написать в чат</button>
    </div>
    <div class="muted" id="players-head">В заезде: 0 · в очереди: 0</div>
    <table id="players"></table>
  </section>
  <section>
    <h2>Настройки заезда</h2>
    <div class="row"><label>Машин на трассе <input type="number" id="set-max" min="6" max="16" step="1" /></label></div>
    <div class="row"><label>Кругов <input type="number" id="set-laps" min="1" max="10" step="1" /></label></div>
    <div class="row"><label>Лобби, с <input type="number" id="set-lobby" min="5" max="300" step="5" /></label>
      <label>Подиум, с <input type="number" id="set-podium" min="3" max="60" step="1" /></label></div>
    <div class="row"><label>Вход в гонку
      <select id="set-join"><option value="any">любое сообщение</option><option value="keyword">ключевое слово</option></select></label>
      <input id="set-keyword" size="8" /></div>
    <div class="row"><button class="primary" id="set-apply">Применить</button><span class="muted">Число машин и круги — со следующего заезда.</span></div>
  </section>
  <section>
    <h2>Камера</h2>
    <div class="row">
      <button id="cam-auto">Авто (режиссёр)</button>
      <button id="cam-overview">Общий план</button>
    </div>
    <div class="muted">Следить за машиной:</div>
    <div class="row" id="cam-cars"></div>
  </section>
  <section>
    <h2>Позиции</h2>
    <table id="standings"></table>
  </section>
  <section>
    <h2>Качество картинки</h2>
    <div class="row" id="quality"></div>
    <div class="row">
      <label>Разрешение <input type="range" id="res" min="0.5" max="1" step="0.05" value="1" /></label>
      <span id="res-val" class="pill">100%</span>
    </div>
    <p class="muted">Если в OBS проседает fps — выберите «Эфир» или уменьшите разрешение.</p>
  </section>
</main>`;

const updateGifts = mountGifts(app.querySelector('main') as HTMLElement, channel);
for (const b of app.querySelectorAll<HTMLButtonElement>('[data-cmd]')) {
  b.addEventListener('click', () => channel.send(b.dataset.cmd as string, null));
}
const qRow = document.getElementById('quality') as HTMLElement;
for (const level of Object.keys(QUALITY) as QualityLevel[]) {
  const b = document.createElement('button');
  b.textContent = QUALITY[level].label;
  b.dataset.level = level;
  b.addEventListener('click', () => channel.send('quality', level));
  qRow.append(b);
}
const res = document.getElementById('res') as HTMLInputElement;
const resVal = document.getElementById('res-val') as HTMLElement;
res.addEventListener('input', () => {
  resVal.textContent = `${Math.round(Number(res.value) * 100)}%`;
  channel.send('resolution', Number(res.value));
});

let lastSeen = 0;
const link = document.getElementById('link') as HTMLElement;
const relay = document.getElementById('relay') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const STATE: Record<GameStatus['state'], string> = { loading: 'загружается', running: 'идёт', stopped: 'на паузе' };
const PHASE: Record<string, string> = {
  grid: 'решётка',
  countdown: 'отсчёт',
  race: 'гонка',
  finished: 'финиш',
  lobby: 'лобби',
  podium: 'подиум',
};
const camCars = document.getElementById('cam-cars') as HTMLElement;
const standingsEl = document.getElementById('standings') as HTMLElement;
(document.getElementById('cam-auto') as HTMLElement).addEventListener('click', () => channel.send('camera', 'auto'));
(document.getElementById('cam-overview') as HTMLElement).addEventListener('click', () =>
  channel.send('camera', 'overview'),
);
camCars.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-car]');
  if (b) channel.send('camera', Number(b.dataset.car));
});
let camKey = '';
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
$('mock-1').addEventListener('click', () => channel.send('mock-viewers', { count: 1 }));
$('mock-20').addEventListener('click', () => channel.send('mock-viewers', { count: 20 }));
$('chat-send').addEventListener('click', () => {
  const name = $<HTMLInputElement>('chat-name').value.trim() || 'Тест';
  channel.send('mock-chat', { userId: `manual-${name}`, name, text: $<HTMLInputElement>('chat-text').value });
});
$('players').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-remove]');
  if (b) channel.send('remove-player', { id: b.dataset.remove });
});
let settingsLoaded = false;
$('set-apply').addEventListener('click', () => {
  channel.send('settings', {
    maxCars: Number($<HTMLInputElement>('set-max').value),
    laps: Number($<HTMLInputElement>('set-laps').value),
    lobbySeconds: Number($<HTMLInputElement>('set-lobby').value),
    podiumSeconds: Number($<HTMLInputElement>('set-podium').value),
    joinMode: $<HTMLSelectElement>('set-join').value,
    keyword: $<HTMLInputElement>('set-keyword').value,
  });
  settingsLoaded = false;
});
const escHtml = (t: string): string => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

channel.on((msg) => {
  if (msg.type !== 'status') return;
  const s = msg.payload as GameStatus;
  lastSeen = Date.now();
  updateGifts(s);
  statusEl.innerHTML = `
    <span class="muted">Состояние</span><span>${STATE[s.state]}</span>
    <span class="muted">Кадр</span><span>${s.fps} fps (${s.frameMs} мс)</span>
    <span class="muted">Draw calls</span><span>${s.drawCalls}</span>
    <span class="muted">Заезд</span><span>№${s.race + 1} · ${PHASE[s.phase] ?? s.phase}${s.phase === 'lobby' || s.phase === 'podium' ? ` · ещё ${Math.ceil(s.secondsLeft)} с` : ` · ${s.raceTime.toFixed(0)} с`}</span>
    <span class="muted">Машин</span><span>${s.cars}</span>
    <span class="muted">Физика</span><span>${s.simMs} мс/шаг, кадр на процессоре ${s.cpuMs} мс</span>`;
  const key =
    s.standings
      .map((c) => c.id)
      .sort((a, b) => a - b)
      .join(',') + `|${s.camera.manualId}`;
  if (key !== camKey) {
    camKey = key;
    camCars.innerHTML = [...s.standings]
      .sort((a, b) => a.id - b.id)
      .map(
        (c) =>
          `<button data-car="${c.id}" class="${s.camera.manualId === c.id ? 'primary' : ''}"><span style="color:${c.color}">●</span> ${escHtml(c.name)}</button>`,
      )
      .join('');
  }
  if (!settingsLoaded) {
    settingsLoaded = true;
    const ss = s.settings.session;
    $<HTMLInputElement>('set-max').value = String(ss.maxCars);
    $<HTMLInputElement>('set-laps').value = String(ss.laps);
    $<HTMLInputElement>('set-lobby').value = String(ss.lobbySeconds);
    $<HTMLInputElement>('set-podium').value = String(ss.podiumSeconds);
    $<HTMLSelectElement>('set-join').value = ss.joinMode;
    $<HTMLInputElement>('set-keyword').value = ss.keyword;
  }
  $('players-head').textContent = `В заезде: ${s.roster.length} · в очереди: ${s.queue.length}`;
  const prow = (p: { id: string; name: string }, where: string) =>
    `<tr><td>${escHtml(p.name)}</td><td class="muted">${where}</td><td><button class="danger" data-remove="${escHtml(p.id)}">удалить</button></td></tr>`;
  $('players').innerHTML = [
    ...s.roster.map((p) => prow(p, 'в заезде')),
    ...s.queue.map((p, i) => prow(p, `очередь ${i + 1}`)),
  ].join('');
  standingsEl.innerHTML = s.standings
    .map(
      (c, i) =>
        `<tr><td>${i + 1}</td><td><span style="color:${c.color}">●</span> ${escHtml(c.name)}</td><td>${c.finished ? 'финиш' : `круг ${c.lap + 1}`}</td></tr>`,
    )
    .join('');
  for (const b of qRow.querySelectorAll<HTMLButtonElement>('button'))
    b.classList.toggle('primary', b.dataset.level === s.quality);
});

setInterval(() => {
  const alive = Date.now() - lastSeen < 2000;
  link.textContent = alive ? 'Игра на связи' : 'Игра не найдена — откройте http://127.0.0.1:8091/';
  link.className = `pill ${alive ? 'ok' : 'bad'}`;
  relay.textContent = channel.relayConnected ? 'ретранслятор: да' : 'ретранслятор: нет (только этот браузер)';
}, 500);
channel.send('hello', null);
