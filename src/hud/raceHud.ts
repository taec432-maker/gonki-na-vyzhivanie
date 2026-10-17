import type { Simulation } from '../core/sim';
import { STEP } from '../core/loop';
import { esc, formatTime } from './format';

/**
 * HUD гонки: позиции слева, круг и время сверху, отсчёт по центру, таблица результатов.
 * Обновляется 10 раз в секунду — DOM дорогой, кадр дорожке.
 */
export class RaceHud {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly lap: HTMLElement;
  private readonly time: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly results: HTMLElement;
  private acc = 0;
  private lastCount = '';
  private resultsShown = false;

  constructor(root: HTMLElement) {
    this.root = root;
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="standings" class="panel"></div>
       <div id="race-info" class="panel"><div id="race-lap"></div><div id="race-time"></div></div>
       <div id="countdown"></div>
       <div id="results" class="panel hidden"></div>`,
    );
    this.list = root.querySelector('#standings') as HTMLElement;
    this.lap = root.querySelector('#race-lap') as HTMLElement;
    this.time = root.querySelector('#race-time') as HTMLElement;
    this.countdown = root.querySelector('#countdown') as HTMLElement;
    this.results = root.querySelector('#results') as HTMLElement;
  }

  update(dt: number, sim: Simulation, focusId: number): void {
    this.updateCountdown(sim);
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    const st = sim.standings();
    const leader = st[0];
    const laps = sim.config.laps;
    const leaderLap = leader ? Math.min(laps, leader.race.lap + (leader.race.finished ? 0 : 1)) : 1;
    this.lap.textContent = `Круг ${Math.max(1, leaderLap)}/${laps}`;
    this.time.textContent = sim.phase === 'race' || sim.phase === 'finished' ? formatTime(sim.raceTime) : formatTime(0);
    const lead = leader?.race.progress ?? 0;
    const rows = st.map((c, i) => {
      let tail: string;
      if (c.race.out) tail = 'выбыл';
      else if (c.race.finished) tail = formatTime((c.race.finishTick - sim.raceStartTick) * STEP);
      else if (i === 0) tail = `круг ${Math.max(1, c.race.lap + 1)}`;
      else {
        const gap = lead - c.race.progress;
        tail = gap > sim.track.length ? `−${Math.floor(gap / sim.track.length)} кр.` : `+${Math.round(gap)} м`;
      }
      return `<div class="row${c.id === focusId ? ' focus' : ''}${c.race.out ? ' out' : ''}">
        <span class="pos">${i + 1}</span><span class="dot" style="background:${c.color}"></span>
        <span class="name">${esc(c.name)}</span><span class="tail">${tail}</span></div>`;
    });
    this.list.innerHTML = rows.join('');
    if (sim.phase === 'finished' && !this.resultsShown) this.showResults(sim);
    if (sim.phase !== 'finished' && this.resultsShown) {
      this.results.classList.add('hidden');
      this.resultsShown = false;
    }
  }

  private updateCountdown(sim: Simulation): void {
    let text = '';
    if (sim.phase === 'countdown') text = String(Math.ceil(-sim.raceTime));
    else if (sim.phase === 'race' && sim.raceTime < 1.2) text = 'СТАРТ!';
    if (text !== this.lastCount) {
      this.lastCount = text;
      this.countdown.textContent = text;
      this.countdown.classList.remove('pulse');
      void this.countdown.offsetWidth;
      if (text) this.countdown.classList.add('pulse');
    }
  }

  private showResults(sim: Simulation): void {
    this.resultsShown = true;
    const rows = sim
      .results()
      .map(
        (r) => `<tr><td class="pos">${r.place}</td><td>${esc(r.name)}</td>
        <td class="t">${r.finished && r.time !== null ? formatTime(r.time) : r.out ? 'выбыл' : `${r.laps} кр.`}</td></tr>`,
      )
      .join('');
    this.results.innerHTML = `<h2>Результаты заезда</h2><table>${rows}</table>`;
    this.results.classList.remove('hidden');
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }
}
