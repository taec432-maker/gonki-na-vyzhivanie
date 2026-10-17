import { FixedStepper, STEP, STEP_HZ } from './core/loop';
import { LinkChannel, relayUrlFor } from './core/channel';
import type { UrlParams } from './core/params';
import { hashString } from './core/rng';
import { Simulation, type CarEntry } from './core/sim';
import { CarView } from './render/carView';
import { CameraDirector } from './render/director';
import { presetById } from './render/presets';
import { buildProps } from './render/props';
import { isQualityLevel } from './render/quality';
import { Renderer, type FrameStats } from './render/renderer';
import { buildTrackVisual, type TrackVisual } from './render/trackMesh';
import { WheelRenderer } from './render/wheels';
import { RaceHud } from './hud/raceHud';
import { FrameStatsMeter } from './hud/stats';
import { trackById } from './tracks';
import { VEHICLES } from './vehicles';
import type { Group } from 'three';

export interface GameStatus {
  state: 'loading' | 'running' | 'stopped';
  phase: string;
  raceTime: number;
  race: number;
  track: string;
  fps: number;
  frameMs: number;
  tick: number;
  drawCalls: number;
  quality: string;
  resolution: number;
  cars: number;
  /** Среднее время одного шага симуляции, мс (физика + ИИ). */
  simMs: number;
  /** Время подготовки кадра на процессоре без отрисовки, мс. */
  cpuMs: number;
  triangles: number;
  camera: { manualId: number | null; targetId: number; shot: string };
  standings: { id: number; name: string; color: string; lap: number; finished: boolean }[];
}

export const BOT_NAMES = [
  'Рыжий',
  'Серый',
  'Шустрый',
  'Барон',
  'Молния',
  'Гайка',
  'Турбо',
  'Кнопка',
  'Ржавый',
  'Дизель',
  'Шпилька',
  'Тормоз',
  'Пончик',
  'Крот',
  'Сокол',
  'Вжик',
];

export const CAR_COLORS = [
  '#c8102e',
  '#1b3a8a',
  '#f5b800',
  '#2e8b57',
  '#f2f2f2',
  '#1f1f22',
  '#ff7a00',
  '#7b2cbf',
  '#00a3c4',
  '#9aa0a6',
  '#e04f9f',
  '#6b4423',
  '#7fff00',
  '#8b0000',
  '#40e0d0',
  '#ffd1dc',
];

export interface SoakReport {
  races: number;
  allFinished: boolean;
  respawns: number;
  /** Худший случай: сколько секунд машина не продвигалась. */
  maxNoProgress: number;
  perRace: { finished: number; cars: number; time: number; respawns: number; winner: string }[];
}

/** Страница игры: симуляция + рендер + HUD + связь с панелью. */
export class Game {
  readonly params: UrlParams;
  sim!: Simulation;
  readonly renderer: Renderer;
  readonly stepper = new FixedStepper();
  readonly meter = new FrameStatsMeter();
  readonly channel: LinkChannel;
  readonly director = new CameraDirector();
  private views = new Map<number, CarView>();
  private wheels!: WheelRenderer;
  private hud!: RaceHud;
  private trackVisual: { id: string; visual: TrackVisual; props: Group } | null = null;
  private last = 0;
  private lastStats: FrameStats = { drawCalls: 0, triangles: 0, textures: 0, geometries: 0 };
  private statusTimer = 0;
  private hudSpeed: HTMLElement;
  private hudFps: HTMLElement;
  private simMsAvg = 0;
  private cpuMsAvg = 0;
  private switching = false;
  private soaking = false;
  /** Номер заезда с начала сессии. */
  raceIndex = 0;
  /** Секунд показа решётки до отсчёта и результатов после финиша. */
  gridSeconds = 2.5;
  resultsSeconds = 10;
  botCount = 8;
  laps = 3;
  /** Сколько кадров отрисовано (тесты ждут кадры, а не секунды — SwiftShader медленный). */
  frameCount = 0;
  ready = false;
  readonly errors: string[] = [];

  constructor(canvas: HTMLCanvasElement, params: UrlParams) {
    this.params = params;
    const base = import.meta.env.BASE_URL;
    this.renderer = new Renderer(canvas, base);
    this.channel = new LinkChannel('game', relayUrlFor(location));
    this.hudSpeed = document.getElementById('hud-speed') as HTMLElement;
    this.hudFps = document.getElementById('hud-fps') as HTMLElement;
    this.stepper.timeScale = params.turbo;
    if (params.bots !== null) this.botCount = Math.max(1, Math.min(16, params.bots));
    if (params.laps !== null) this.laps = Math.max(1, Math.min(20, params.laps));
    if (params.quick) {
      this.gridSeconds = 0.2;
      this.resultsSeconds = 2;
    }
    if (params.quality && isQualityLevel(params.quality)) this.renderer.setQuality(params.quality);
    window.addEventListener('resize', () => this.renderer.resize());
    this.channel.on((msg) => this.onCommand(msg.type, msg.payload));
  }

  async start(onProgress: (k: number, label: string) => void): Promise<void> {
    onProgress(0.1, 'Физика');
    this.hud = new RaceHud(document.getElementById('hud') as HTMLElement);
    this.wheels = new WheelRenderer(this.renderer.scene);
    onProgress(0.3, 'Трасса и освещение');
    await this.newRace();
    onProgress(1, 'Готово');
    this.ready = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  /** Seed заезда: от базового seed и номера заезда — сессия воспроизводима целиком. */
  private raceSeed(index: number): number {
    return (hashString(`${this.params.seed}:${index}`) ^ this.params.seed) >>> 0;
  }

  /** Список участников заезда. Этап 2 заменит ботов зрителями из очереди. */
  protected entries(): CarEntry[] {
    const list: CarEntry[] = [];
    const common = VEHICLES.filter((v) => v.rarity === 'common');
    for (let i = 0; i < this.botCount; i++) {
      list.push({
        name: `Бот ${BOT_NAMES[i % BOT_NAMES.length] as string}`,
        color: CAR_COLORS[i % CAR_COLORS.length] as string,
        spec: common[(i + this.raceIndex) % common.length] ?? (VEHICLES[0] as (typeof VEHICLES)[number]),
        playerId: null,
      });
    }
    return list;
  }

  /** Подготовить новый заезд: новая симуляция, машины на решётке, камера — облёт. */
  async newRace(): Promise<void> {
    this.switching = true;
    const trackId = this.params.track ?? 'port';
    const def = trackById(trackId);
    const old = this.sim;
    this.sim = await Simulation.create({ seed: this.raceSeed(this.raceIndex), track: def, laps: this.laps });
    if (!this.trackVisual || this.trackVisual.id !== def.id) {
      if (this.trackVisual) {
        this.renderer.scene.remove(this.trackVisual.visual.group, this.trackVisual.props);
      }
      await this.renderer.applyPreset(presetById(def.lighting));
      const visual = buildTrackVisual(this.sim.track);
      const props = buildProps(this.sim.track);
      this.renderer.scene.add(visual.group, props.group);
      this.trackVisual = { id: def.id, visual, props: props.group };
    }
    for (const v of this.views.values()) v.dispose(this.renderer.scene);
    this.views.clear();
    old?.dispose();
    for (const e of this.entries()) {
      const car = this.sim.addCar(e);
      this.views.set(car.id, new CarView(this.renderer.scene, car));
    }
    this.sim.events.on('finish', (e) => this.director.hotspot(e.car.id, e.car.cur.p, 2.5));
    this.director.reset();
    this.stepper.reset();
    this.switching = false;
  }

  private onCommand(type: string, payload: unknown): void {
    switch (type) {
      case 'start':
        this.sim.running = true;
        if (this.sim.phase === 'grid') this.sim.startCountdown();
        break;
      case 'stop':
        this.sim.running = false;
        break;
      case 'restart':
        void this.newRace();
        break;
      case 'next-race':
        this.raceIndex++;
        void this.newRace();
        break;
      case 'quality':
        if (isQualityLevel(payload)) this.renderer.setQuality(payload);
        break;
      case 'resolution':
        if (typeof payload === 'number') this.renderer.setResolutionScale(payload);
        break;
      case 'camera':
        if (payload === 'overview') this.director.forceOverview = true;
        else if (payload === 'auto' || payload === null) {
          this.director.forceOverview = false;
          this.director.manualId = null;
        } else if (typeof payload === 'number') {
          this.director.forceOverview = false;
          this.director.manualId = payload;
        }
        break;
      case 'hello':
        this.sendStatus();
        break;
    }
  }

  /** Для тестов: общий план / обычная камера. */
  setCameraMode(mode: 'chase' | 'overview'): void {
    this.director.forceOverview = mode === 'overview';
  }

  status(): GameStatus {
    const sim = this.sim;
    return {
      state: !this.ready ? 'loading' : sim.running ? 'running' : 'stopped',
      phase: sim?.phase ?? 'grid',
      raceTime: +(sim?.raceTime ?? 0).toFixed(2),
      race: this.raceIndex,
      track: sim?.track.def.id ?? '',
      fps: Math.round(this.meter.fps()),
      frameMs: +this.meter.median().toFixed(2),
      tick: sim?.tick ?? 0,
      drawCalls: this.lastStats.drawCalls,
      quality: this.renderer.quality.level,
      resolution: this.renderer.resolutionScale,
      cars: sim?.cars.length ?? 0,
      simMs: +this.simMsAvg.toFixed(3),
      cpuMs: +this.cpuMsAvg.toFixed(3),
      triangles: this.lastStats.triangles,
      camera: { manualId: this.director.manualId, targetId: this.director.targetId, shot: this.director.shot },
      standings: (sim?.standings() ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        lap: c.race.lap,
        finished: c.race.finished,
      })),
    };
  }

  private sendStatus(): void {
    this.channel.send('status', this.status());
  }

  /** Переходы между фазами заезда, общие для обычного режима и soak-теста. */
  private lifecycle(): 'next' | null {
    const sim = this.sim;
    if (sim.phase === 'grid' && sim.running && sim.phaseTick >= this.gridSeconds * STEP_HZ) sim.startCountdown();
    if (sim.phase === 'finished' && sim.phaseTick >= this.resultsSeconds * STEP_HZ) return 'next';
    return null;
  }

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.meter.push(now - this.last);
    this.last = now;
    if (this.switching || this.soaking) return;
    try {
      const t0 = performance.now();
      const steps = this.stepper.advance(dt);
      for (let i = 0; i < steps; i++) {
        this.sim.step();
        if (this.lifecycle() === 'next') {
          this.raceIndex++;
          void this.newRace();
          return;
        }
      }
      const t1 = performance.now();
      if (steps > 0) this.simMsAvg += ((t1 - t0) / steps - this.simMsAvg) * 0.05;
      const alpha = this.stepper.alpha;
      this.wheels.begin();
      for (const v of this.views.values()) v.update(alpha, this.wheels);
      this.wheels.end();
      const focus = this.director.update(dt, this.renderer.camera, this.sim, this.views);
      this.renderer.updateSun(focus, this.director.shot === 'overview' ? 220 : 70);
      const target = this.views.get(this.director.targetId);
      this.hudSpeed.textContent = target ? `${Math.round(Math.abs(target.car.phys.forwardSpeed()) * 3.6)} км/ч` : '';
      this.hud.update(dt, this.sim, this.director.targetId);
      this.cpuMsAvg += (performance.now() - t0 - this.cpuMsAvg) * 0.05;
      this.lastStats = this.renderer.render(dt);
      this.frameCount++;
      this.hudFps.textContent = `${Math.round(this.meter.fps())} fps · ${this.meter.median().toFixed(1)} мс`;
      this.statusTimer += dt;
      if (this.statusTimer > 0.5) {
        this.statusTimer = 0;
        this.sendStatus();
      }
    } catch (e) {
      this.errors.push(String(e));
      console.error(e);
    }
  };

  /** Для тестов: проиграть n шагов симуляции синхронно. */
  advance(n: number): void {
    for (let i = 0; i < n; i++) {
      this.sim.step();
      this.lifecycle();
    }
  }

  /** Перемотать до фазы (для скриншотов): не дольше maxSeconds симуляции. */
  async advanceUntil(phase: string, maxSeconds = 600): Promise<boolean> {
    const limit = maxSeconds * STEP_HZ;
    for (let i = 0; i < limit; i++) {
      if (this.sim.phase === phase) return true;
      this.sim.step();
      if (this.lifecycle() === 'next') {
        this.raceIndex++;
        await this.newRace();
      }
      if (i % 600 === 599) await new Promise((r) => setTimeout(r, 0));
    }
    return this.sim.phase === phase;
  }

  /**
   * Soak-тест: n заездов подряд без отрисовки, теми же функциями, что и в эфире.
   * Возвращает, все ли финишировали и сколько было мягких респаунов.
   */
  async soak(n: number): Promise<SoakReport> {
    this.soaking = true;
    const report: SoakReport = { races: 0, allFinished: true, respawns: 0, maxNoProgress: 0, perRace: [] };
    try {
      for (let r = 0; r < n; r++) {
        if (r > 0) {
          this.raceIndex++;
          await this.newRace();
        }
        const sim = this.sim;
        let respawns = 0;
        const lastMove = new Map<number, { p: number; t: number }>();
        sim.events.on('respawn', (e) => {
          respawns++;
          // После респауна машина откатывается к чекпойнту — отсчёт «без прогресса» начинаем заново.
          lastMove.delete(e.car.id);
        });
        let guard = 0;
        while (sim.phase !== 'finished' && guard++ < 400 * STEP_HZ) {
          sim.step();
          this.lifecycle();
          if (sim.phase === 'race') {
            for (const c of sim.cars) {
              const m = lastMove.get(c.id);
              if (!m || c.race.progress > m.p + 5 || c.race.finished)
                lastMove.set(c.id, { p: c.race.progress, t: sim.tick });
              else report.maxNoProgress = Math.max(report.maxNoProgress, (sim.tick - m.t) * STEP);
            }
          }
          if (guard % 1200 === 0) await new Promise((res) => setTimeout(res, 0));
        }
        const finished = sim.cars.filter((c) => c.race.finished).length;
        report.perRace.push({
          finished,
          cars: sim.cars.length,
          time: +sim.raceTime.toFixed(1),
          respawns,
          winner: sim.standings()[0]?.name ?? '',
        });
        report.respawns += respawns;
        if (finished !== sim.cars.length) report.allFinished = false;
        report.races++;
      }
    } finally {
      this.soaking = false;
    }
    return report;
  }
}
