import '../styles/control.css';
import { LinkChannel, relayUrlFor } from '../core/channel';
import type { GameStatus } from '../game';
import { QUALITY, type QualityLevel } from '../render/quality';

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
    </div>
    <div class="kv" id="status"></div>
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
const STATE: Record<GameStatus['state'], string> = { loading: 'загружается', running: 'идёт', stopped: 'остановлена' };

channel.on((msg) => {
  if (msg.type !== 'status') return;
  const s = msg.payload as GameStatus;
  lastSeen = Date.now();
  statusEl.innerHTML = `
    <span class="muted">Состояние</span><span>${STATE[s.state]}</span>
    <span class="muted">Кадр</span><span>${s.fps} fps (${s.frameMs} мс)</span>
    <span class="muted">Draw calls</span><span>${s.drawCalls}</span>
    <span class="muted">Машин</span><span>${s.cars}</span>`;
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
