import { FixedStepper, STEP, STEP_HZ } from './core/loop';
import { LinkChannel, relayUrlFor } from './core/channel';
import type { UrlParams } from './core/params';
import { loadSettings, sanitizeSettings, saveSettings, type GameSettings } from './core/settings';
import type { Simulation } from './core/sim';
import { EventNormalizer } from './bridge/normalize';
import { MockViewers } from './bridge/mock';
import { BridgeClient, type BridgeStatus } from './bridge/client';
import { Sfx } from './audio/sfx';
import { sanitizeMapping } from './gifts/mapping';
import { EffectsRenderer } from './render/fx';
import { BridgeIndicator, EventFeed, LikeBar } from './hud/feed';
import { readableColor } from './hud/nameTags';
import type { BridgeEnvelope } from './bridge/protocol';
import { Session, type SessionSettings } from './race/session';
import { CarView } from './render/carView';
import { CameraDirector } from './render/director';
import { presetById } from './render/presets';
import { buildProps } from './render/props';
import { isQualityLevel } from './render/quality';
import { Renderer, type FrameStats } from './render/renderer';
import { buildTrackVisual, type TrackVisual } from './render/trackMesh';
import { WheelRenderer } from './render/wheels';
import { LobbyScreen } from './hud/lobby';
import { NameTags } from './hud/nameTags';
import { RaceHud } from './hud/raceHud';
import { FrameStatsMeter } from './hud/stats';
import { trackById } from './tracks';
import type { TrackDef } from './tracks/types';
import { VEHICLES } from './vehicles';
import type { Group } from 'three';

export interface GameStatus {
  state: 'loading' | 'running' | 'stopped';
  /** Фаза сессии: lobby | countdown | race | podium. */
  phase: string;
  simPhase: string;
  secondsLeft: number;
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
  standings: { id: number; name: string; color: string; lap: number; finished: boolean; playerId: string | null }[];
  roster: { id: string; name: string }[];
  queue: { id: string; name: string }[];
  settings: GameSettings;
  bridge: BridgeStatus | null;
  likes: { bar: number; target: number; bursts: number };
  feed: { name: string; what: string; effect: string | null; test: boolean }[];
}

export interface SoakReport {
  races: number;
  allFinished: boolean;
  respawns: number;
  /** Худший случай: сколько секунд машина не продвигалась. */
  maxNoProgress: number;
  perRace: { finished: number; cars: number; time: number; respawns: number; winner: string }[];
}

/** Страница игры: сессия (симуляция) + рендер + HUD + связь с панелью. */
export class Game {
  readonly params: UrlParams;
  session!: Session;
  readonly renderer: Renderer;
  readonly stepper = new FixedStepper();
  readonly meter = new FrameStatsMeter();
  readonly channel: LinkChannel;
  readonly director = new CameraDirector();
  readonly normalizer = new EventNormalizer();
  readonly mock: MockViewers;
  settings: GameSettings;
  private views = new Map<number, CarView>();
  private wheels!: WheelRenderer;
  private hud!: RaceHud;
  private lobby!: LobbyScreen;
  nameTags!: NameTags;
  fx!: EffectsRenderer;
  feed!: EventFeed;
  private likeBar!: LikeBar;
  private bridgeInd!: BridgeIndicator;
  bridge: BridgeClient | null = null;
  readonly sfx = new Sfx();
  private trackVisual: { id: string; visual: TrackVisual; props: Group } | null = null;
  private loadingTrack: Promise<void> | null = null;
  private last = 0;
  private lastStats: FrameStats = { drawCalls: 0, triangles: 0, textures: 0, geometries: 0 };
  private statusTimer = 0;
  private hudSpeed: HTMLElement;
  private hudFps: HTMLElement;
  private simMsAvg = 0;
  private cpuMsAvg = 0;
  private soaking = false;
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
    this.mock = new MockViewers(params.seed);
    this.stepper.timeScale = params.turbo;
    this.settings = loadSettings(params.fresh);
    // Параметры адреса — для тестов и просмотра; в сохранённые настройки не попадают.
    const s = this.settings.session;
    if (params.bots !== null) s.minCars = s.maxCars = Math.max(1, Math.min(16, params.bots));
    if (params.laps !== null) s.laps = Math.max(1, Math.min(10, params.laps));
    if (params.quick) {
      s.lobbySeconds = 2;
      s.podiumSeconds = 3;
    }
    const q = params.quality && isQualityLevel(params.quality) ? params.quality : this.settings.quality;
    this.renderer.setQuality(q);
    this.renderer.setResolutionScale(this.settings.resolution);
    window.addEventListener('resize', () => this.renderer.resize());
    this.channel.on((msg) => this.onCommand(msg.type, msg.payload));
  }

  get sim(): Simulation {
    return this.session.sim;
  }

  private trackFor = (_raceIndex: number): TrackDef => trackById(this.params.track ?? 'port');

  async start(onProgress: (k: number, label: string) => void): Promise<void> {
    onProgress(0.1, 'Физика');
    const hudRoot = document.getElementById('hud') as HTMLElement;
    this.nameTags = new NameTags(hudRoot);
    this.hud = new RaceHud(hudRoot);
    this.lobby = new LobbyScreen(hudRoot);
    this.feed = new EventFeed(hudRoot);
    this.likeBar = new LikeBar(hudRoot);
    this.bridgeInd = new BridgeIndicator(hudRoot);
    this.wheels = new WheelRenderer(this.renderer.scene);
    this.fx = new EffectsRenderer(this.renderer.scene);
    this.fx.setDensity(this.renderer.quality.particles);
    this.session = await Session.create({
      seed: this.params.seed,
      settings: this.settings.session,
      trackFor: this.trackFor,
      vehiclesFor: () => VEHICLES,
    });
    this.session.mapping = this.settings.gifts;
    this.bindSession();
    this.fx.bind(this.sim);
    this.startBridge();
    onProgress(0.3, 'Трасса и освещение');
    await this.ensureTrack(this.sim.track.def);
    this.syncViews();
    onProgress(1, 'Готово');
    this.ready = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private bindSession(): void {
    const ev = this.session.events;
    ev.on('race-created', ({ sim }) => {
      this.director.reset();
      this.fx?.bind(sim);
      sim.events.on('finish', (e) => this.director.hotspot(e.car.id, e.car.cur.p, 2.5));
      if (this.trackVisual?.id !== sim.track.def.id) this.loadingTrack = this.ensureTrack(sim.track.def);
    });
    ev.on('gift', ({ ev: g, resolved, outcome, carId }) => {
      const car = carId !== null ? this.sim.carById(carId) : undefined;
      const note =
        outcome === 'pending'
          ? 'сработает на старте'
          : outcome === 'queue'
            ? 'в очереди на заезд'
            : outcome === 'none'
              ? ''
              : undefined;
      this.feed.push({
        name: g.name,
        what: g.count > 1 ? `${g.giftName} ×${g.count}` : g.giftName,
        icon: g.picture,
        effect: resolved?.effect ?? null,
        ...(note ? { note } : {}),
        test: g.test,
        ...(car ? { color: readableColor(car.color) } : {}),
      });
      this.sfx.gift();
    });
    ev.on('likes', (e) => {
      if (e.burst) {
        this.likeBar.burst();
        this.sfx.nitro();
        this.feed.push({
          name: 'Зрители',
          what: 'лайки',
          icon: null,
          effect: 'nitro',
          note: 'всем машинам',
          test: false,
        });
      }
    });
    ev.on('car-added', ({ car }) => {
      if (!this.views.has(car.id)) this.views.set(car.id, new CarView(this.renderer.scene, car));
    });
    ev.on('car-removed', ({ car }) => {
      const v = this.views.get(car.id);
      if (v) {
        v.dispose(this.renderer.scene);
        this.views.delete(car.id);
      }
    });
  }

  /** Привести набор CarView к машинам текущей симуляции. */
  private syncViews(): void {
    const ids = new Set(this.sim.cars.map((c) => c.id));
    for (const [id, v] of this.views)
      if (!ids.has(id) || v.car !== this.sim.carById(id)) {
        v.dispose(this.renderer.scene);
        this.views.delete(id);
      }
    for (const c of this.sim.cars) if (!this.views.has(c.id)) this.views.set(c.id, new CarView(this.renderer.scene, c));
  }

  private async ensureTrack(def: TrackDef): Promise<void> {
    if (this.trackVisual?.id === def.id) return;
    if (this.trackVisual) this.renderer.scene.remove(this.trackVisual.visual.group, this.trackVisual.props);
    await this.renderer.applyPreset(presetById(def.lighting));
    const visual = buildTrackVisual(this.sim.track);
    const props = buildProps(this.sim.track);
    this.renderer.scene.add(visual.group, props.group);
    this.trackVisual = { id: def.id, visual, props: props.group };
    this.loadingTrack = null;
  }

  /** Сообщение в формате Bridge (настоящее или мок) → разбор → сессия. Один путь для всех. */
  ingest(raw: BridgeEnvelope): void {
    const ev = this.normalizer.normalize(raw);
    if (ev) this.session.handle(ev);
  }

  /** Подключение к TikTok Bridge по настройкам (раздел 5 ТЗ). */
  startBridge(): void {
    this.bridge?.stop();
    this.bridge = null;
    const b = this.settings.bridge;
    const local = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
    const want =
      this.params.bridge === 'off'
        ? false
        : this.params.bridge === 'on' || b.enabled === 'on' || (b.enabled === 'auto' && local);
    if (!want) {
      this.bridgeInd?.set('off', null);
      return;
    }
    this.bridge = new BridgeClient({
      host: b.host,
      port: b.port,
      fallbackPort: b.port === 3100 ? 3101 : undefined,
      onEvent: (m) => this.ingest(m),
      onStatus: (s) => this.bridgeInd?.set(s.state, s.live),
    });
    this.bridge.start();
  }

  /** Мок: подарок от зрителя (серия комбо как в TikTok). */
  mockGift(userId: string | null, diamonds: number, count: number, giftName = 'Тестовый подарок'): void {
    const roster = this.session.roster;
    let id = userId;
    let name = '';
    if (!id) {
      const p = roster.length ? roster[Math.floor(Math.random() * roster.length)] : null;
      if (!p) {
        const v = this.mock.viewer();
        this.ingest(this.mock.chat(v.userId, v.name));
        id = v.userId;
        name = v.name;
      } else {
        id = p.id;
        name = p.rawName;
      }
    } else name = this.session.players.get(id)?.rawName ?? id;
    for (const m of this.mock.gift(id, name, giftName, diamonds, count)) this.ingest(m);
  }

  /** Мок: n новых зрителей пишут в чат. */
  mockViewers(n: number): void {
    for (let i = 0; i < n; i++) {
      const v = this.mock.viewer();
      this.ingest(this.mock.chat(v.userId, v.name));
    }
  }

  private persist(): void {
    this.settings.session = { ...this.session.settings };
    saveSettings(this.settings, this.params.fresh);
  }

  private onCommand(type: string, payload: unknown): void {
    const p = (payload ?? {}) as Record<string, unknown>;
    switch (type) {
      case 'start':
        this.session.startNow();
        break;
      case 'stop':
        this.session.paused = true;
        break;
      case 'restart':
        this.session.restart();
        break;
      case 'next-race':
        this.session.skip();
        break;
      case 'quality':
        if (isQualityLevel(payload)) {
          this.renderer.setQuality(payload);
          this.settings.quality = payload;
          this.persist();
        }
        break;
      case 'resolution':
        if (typeof payload === 'number') {
          this.renderer.setResolutionScale(payload);
          this.settings.resolution = this.renderer.resolutionScale;
          this.persist();
        }
        break;
      case 'settings':
        this.session.updateSettings(payload as Partial<SessionSettings>);
        this.persist();
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
      case 'mock-viewers':
        this.mockViewers(Math.max(1, Math.min(50, Number(p.count ?? 1))));
        break;
      case 'mock-chat': {
        const id = String(p.userId ?? '');
        if (id) this.ingest(this.mock.chat(id, String(p.name ?? id), String(p.text ?? 'привет')));
        break;
      }
      case 'mock-gift':
        this.mockGift(
          typeof p.userId === 'string' && p.userId ? p.userId : null,
          Math.max(1, Number(p.diamonds ?? 1)),
          Math.max(1, Math.min(99, Number(p.count ?? 1))),
          typeof p.giftName === 'string' && p.giftName ? p.giftName : 'Тестовый подарок',
        );
        break;
      case 'mock-likes':
        this.ingest(this.mock.like('mock-likes', 'Зрители', Math.max(1, Number(p.count ?? 50))));
        break;
      case 'bridge':
        this.settings.bridge = sanitizeSettings({ bridge: { ...this.settings.bridge, ...(p as object) } }).bridge;
        this.persist();
        this.startBridge();
        break;
      case 'gifts':
        this.settings.gifts = sanitizeMapping(payload);
        this.session.mapping = this.settings.gifts;
        this.persist();
        break;
      case 'remove-player':
        if (typeof p.id === 'string') this.session.removePlayer(p.id);
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
    const ses = this.session;
    const sim = ses?.sim;
    return {
      state: !this.ready ? 'loading' : ses.paused ? 'stopped' : 'running',
      phase: ses?.phase ?? 'lobby',
      simPhase: sim?.phase ?? 'grid',
      secondsLeft: +(ses?.secondsLeft ?? 0).toFixed(1),
      raceTime: +(sim?.raceTime ?? 0).toFixed(2),
      race: ses?.raceIndex ?? 0,
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
        playerId: c.playerId,
      })),
      roster: (ses?.roster ?? []).map((p) => ({ id: p.id, name: p.rawName })),
      queue: (ses?.queue ?? []).map((p) => ({ id: p.id, name: p.rawName })),
      settings: { ...this.settings, session: ses?.settings ?? this.settings.session },
      bridge: this.bridge ? { ...this.bridge.status } : null,
      likes: { bar: ses?.likeBar ?? 0, target: this.settings.gifts.likes.target, bursts: ses?.likeBursts ?? 0 },
      feed: (this.feed?.history ?? [])
        .slice(-12)
        .map((f) => ({ name: f.name, what: f.what, effect: f.effect, test: f.test })),
    };
  }

  private sendStatus(): void {
    this.channel.send('status', this.status());
  }

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.meter.push(now - this.last);
    this.last = now;
    if (this.soaking || this.loadingTrack) return;
    try {
      const t0 = performance.now();
      const steps = this.stepper.advance(dt);
      for (let i = 0; i < steps; i++) this.session.step();
      const t1 = performance.now();
      if (steps > 0) this.simMsAvg += ((t1 - t0) / steps - this.simMsAvg) * 0.05;
      this.syncViews();
      const alpha = this.stepper.alpha;
      this.wheels.begin();
      for (const v of this.views.values()) v.update(alpha, this.wheels);
      this.wheels.end();
      this.director.lobbyOffset = this.session.phase === 'lobby';
      this.director.winnerId = this.session.phase === 'podium' ? (this.sim.standings()[0]?.id ?? null) : null;
      const focus = this.director.update(dt, this.renderer.camera, this.sim, this.views);
      this.renderer.updateSun(focus, this.director.shot === 'overview' ? 220 : 70);
      const target = this.views.get(this.director.targetId);
      const racing = this.session.phase === 'race' || this.session.phase === 'countdown';
      this.hudSpeed.textContent =
        target && racing ? `${Math.round(Math.abs(target.car.phys.forwardSpeed()) * 3.6)} км/ч` : '';
      this.hud.setRaceVisible(racing);
      this.hud.update(dt, this.sim, this.director.targetId);
      this.lobby.update(dt, this.session);
      this.likeBar.update(
        this.session.likeBar,
        this.settings.gifts.likes.target,
        this.session.likeBursts,
        racing || this.session.phase === 'lobby',
      );
      document.getElementById('feed')?.classList.toggle('in-lobby', this.session.phase === 'lobby');
      this.fx.update(
        dt,
        this.renderer.camera,
        this.views,
        this.renderer.renderer.domElement.clientHeight || window.innerHeight,
      );
      if (this.fx.shake > 0 && this.director.shot !== 'overview') {
        const k = this.fx.shake * this.fx.shake * 0.35;
        this.renderer.camera.position.x += (Math.random() - 0.5) * k;
        this.renderer.camera.position.y += (Math.random() - 0.5) * k;
      }
      this.nameTags.sync(this.views);
      this.nameTags.update(dt, this.renderer.camera, this.views, [
        document.getElementById('standings'),
        document.getElementById('race-info'),
        document.getElementById('lobby'),
        document.getElementById('podium'),
      ]);
      this.cpuMsAvg += (performance.now() - t0 - this.cpuMsAvg) * 0.05;
      this.lastStats = this.renderer.render(dt);
      this.frameCount++;
      this.hudFps.textContent = `${Math.round(this.meter.fps())} fps · ${this.meter.median().toFixed(1)} мс`;
      // Статус панели — по настоящим часам (dt кадра ограничен 0,1 с и на медленном GPU «отстаёт»).
      if (now - this.statusTimer > 500) {
        this.statusTimer = now;
        this.sendStatus();
      }
    } catch (e) {
      this.errors.push(String(e));
      console.error(e);
    }
  };

  /** Для тестов: проиграть n шагов сессии синхронно. */
  advance(n: number): void {
    for (let i = 0; i < n; i++) this.session.step();
  }

  /** Перемотать до фазы сессии (lobby/countdown/race/podium) или симуляции (finished). */
  async advanceUntil(phase: string, maxSeconds = 600): Promise<boolean> {
    const limit = maxSeconds * STEP_HZ;
    const hit = (): boolean => this.session.phase === phase || this.sim.phase === phase;
    for (let i = 0; i < limit; i++) {
      if (hit()) return true;
      this.session.step();
      if (i % 600 === 599) await new Promise((r) => setTimeout(r, 0));
    }
    return hit();
  }

  /**
   * Soak-тест: n заездов подряд без отрисовки, теми же функциями, что и в эфире
   * (лобби и подиум сокращены). Возвращает, все ли финишировали и сколько было респаунов.
   */
  async soak(n: number): Promise<SoakReport> {
    this.soaking = true;
    const report: SoakReport = { races: 0, allFinished: true, respawns: 0, maxNoProgress: 0, perRace: [] };
    const ses = this.session;
    const saved = { ...ses.settings };
    ses.updateSettings({ lobbySeconds: 5, podiumSeconds: 3 });
    try {
      for (let r = 0; r < n; r++) {
        const sim = ses.sim;
        let respawns = 0;
        const lastMove = new Map<number, { p: number; t: number }>();
        sim.events.on('respawn', (e) => {
          respawns++;
          // После респауна машина откатывается к чекпойнту — отсчёт «без прогресса» начинаем заново.
          lastMove.delete(e.car.id);
        });
        const startIndex = ses.raceIndex;
        let guard = 0;
        while (ses.phase !== 'podium' && guard++ < 420 * STEP_HZ) {
          ses.step();
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
        // Подиум → новое лобби.
        while (ses.raceIndex === startIndex && guard++ < 440 * STEP_HZ) ses.step();
      }
    } finally {
      ses.updateSettings(saved);
      this.soaking = false;
    }
    return report;
  }
}
