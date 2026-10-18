import type { Session } from '../race/session';
import { esc, formatTime } from './format';
import { readableColor } from './nameTags';
import { POINTS } from '../race/scores';

/**
 * Экран лобби (этап 2): кто записался, очередь, обратный отсчёт и подсказка
 * «напиши в чат». Подиум — топ-3 после заезда.
 */
export class LobbyScreen {
  private readonly lobby: HTMLElement;
  private readonly podium: HTMLElement;
  private acc = 1;
  private lastKey = '';
  private podiumKey = '';

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="lobby" class="panel hidden"></div><div id="podium" class="panel hidden"></div>`,
    );
    this.lobby = root.querySelector('#lobby') as HTMLElement;
    this.podium = root.querySelector('#podium') as HTMLElement;
  }

  /** Список машин для выбора из чата (номер, название, ★ — редкая). */
  vehicles: { number: number; name: string; rare: boolean }[] = [];

  update(dt: number, session: Session): void {
    this.acc += dt;
    const ph = session.phase;
    this.lobby.classList.toggle('hidden', ph !== 'lobby');
    this.podium.classList.toggle('hidden', ph !== 'podium');
    if (this.acc < 0.2) return;
    this.acc = 0;
    if (ph === 'lobby') this.renderLobby(session);
    if (ph === 'podium') this.renderPodium(session);
  }

  private renderLobby(s: Session): void {
    const cars = s.sim.cars;
    const kw = s.settings.joinMode === 'keyword' ? `«${esc(s.settings.keyword)}»` : 'любое сообщение';
    const key = `${cars.map((c) => c.id).join(',')}|${s.queue.length}|${Math.ceil(s.secondsLeft)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const rows = cars
      .map(
        (c) => `<div class="entry${c.playerId ? '' : ' bot'}"><span class="dot" style="background:${c.color}"></span>
        <span class="nm" style="color:${readableColor(c.color)}">${esc(c.name)}</span><span class="car">${esc(c.spec.name)}</span></div>`,
      )
      .join('');
    const cars2 = this.vehicles
      .map((v) => `<span><b>${v.number}</b> ${esc(v.name)}${v.rare ? ' ★' : ''}</span>`)
      .join('');
    const q = s.queue
      .slice(0, 6)
      .map((p) => esc(p.name))
      .join(', ');
    this.lobby.innerHTML = `
      <div class="lb-head"><div class="lb-title">Заезд №${s.raceIndex + 1} · ${esc(s.sim.track.def.name)}${s.night ? ' · ночь' : ''}</div>
      <div class="lb-time">Старт через <b>${formatTime(s.secondsLeft).replace(/\.\d$/, '')}</b></div></div>
      <div class="lb-cta">Напиши в чат ${kw} — и твоя машина на старте!</div>
      <div class="lb-grid">${rows}</div>
      <div class="lb-meta">На старте ${cars.length} из ${s.settings.maxCars} · кругов: ${s.settings.laps}</div>
      ${s.queue.length ? `<div class="lb-queue">В очереди ${s.queue.length}: ${q}${s.queue.length > 6 ? '…' : ''}</div>` : ''}
      ${this.vehicles.length ? `<div class="lb-cars-title">Своя машина — напиши «машина 7»${s.settings.rareCars === 'gift' ? ' (★ — после подарка)' : ''}</div><div class="lb-cars">${cars2}</div>` : ''}`;
  }

  private renderPodium(s: Session): void {
    const res = s.lastResults;
    const key = `${s.raceIndex}|${Math.ceil(s.secondsLeft)}`;
    if (key === this.podiumKey) return;
    this.podiumKey = key;
    // Тройка стоит на 3D-подиуме под этим табло: 2-е место слева, 1-е в центре, 3-е справа.
    const top = [res[1], res[0], res[2]];
    const cls = ['second', 'first', 'third'];
    const medal = ['🥈', '🥇', '🥉'];
    const bonus = [POINTS.second, POINTS.first, POINTS.third];
    const cols = top
      .map((r, i) => {
        if (!r) return '<div class="pd-col"></div>';
        const row = r.playerId ? s.leaderboard.rows.get(r.playerId) : undefined;
        const pts = r.playerId
          ? `<div class="pd-points">+${POINTS.participation + (bonus[i] as number)} очков${row ? ` · всего ${row.points}` : ''}</div>`
          : '<div class="pd-points bot">бот — без очков</div>';
        return `<div class="pd-col ${cls[i]}"><div class="pd-medal">${medal[i]}</div><div class="pd-name">${esc(r.name)}</div>
          <div class="pd-time">${r.finished && r.time !== null ? formatTime(r.time) : `${r.laps} кр.`}</div>${pts}</div>`;
      })
      .join('');
    const rest = res
      .slice(3, 12)
      .map((r) => `<span>${r.place}. ${esc(r.name)}</span>`)
      .join('');
    this.podium.innerHTML = `<div class="pd-title">Победитель — ${esc(res[0]?.name ?? '')}!</div>
      <div class="pd-row">${cols}</div>${rest ? `<div class="pd-rest">${rest}</div>` : ''}
      <div class="pd-next">Следующий заезд через ${Math.ceil(s.secondsLeft)} с</div>`;
  }
}
