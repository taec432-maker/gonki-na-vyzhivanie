import { FixedStepper, STEP, STEP_HZ } from './core/loop';
import { LinkChannel, relayUrlFor } from './core/channel';
import type { UrlParams } from './core/params';
import { importSettings, loadSettings, sanitizeSettings, saveSettings, type GameSettings } from './core/settings';
import type { Simulation } from './core/sim';
import { EventNormalizer } from './bridge/normalize';
import { MockViewers } from './bridge/mock';
import { BridgeClient, type BridgeStatus } from './bridge/client';
import { SoundSystem, giftTier, type EngineSource, type Volumes } from './audio/sound';
import { sanitizeMapping } from './gifts/mapping';
import { EffectsRenderer } from './render/fx';
import { preloadCarModels } from './render/glbCar';
import { Weather, type WeatherKind } from './render/weather';
import { WheelFx } from './render/wheelFx';
import { TrackFxView } from './render/trackFx';
import { Aurora } from './render/aurora';
import { Ceremony } from './render/ceremony';
import { makeWet } from './render/wet';
import { disposeObject } from './render/dispose';
import { BridgeIndicator, EventFeed, LikeBar } from './hud/feed';
import { readableColor } from './hud/nameTags';
import type { BridgeEnvelope } from './bridge/protocol';
import { Session, type SessionSettings } from './race/session';
import { CarView } from './render/carView';
import { CameraDirector } from './render/director';
import { PRESETS, presetById, type LightingPreset } from './render/presets';
import { buildProps } from './render/props';
import { isQualityLevel } from './render/quality';
import { Renderer, type FrameStats } from './render/renderer';
import { buildTrackVisual, type TrackVisual } from './render/trackMesh';
import { WheelRenderer } from './render/wheels';
import { LobbyScreen } from './hud/lobby';
import { NameTags } from './hud/nameTags';
import { RaceHud } from './hud/raceHud';
import { FrameStatsMeter } from './hud/stats';
import { TRACKS, trackById } from './tracks';
import type { TrackDef } from './tracks/types';
import { VEHICLES } from './vehicles';
import { Vector3, type Group, type Mesh } from 'three';

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
  /** Время вызова отрисовки, мс (на программном GPU это и есть растеризация). */
  renderMs: number;
  /** Что включено в картинке (тени, AO, размытие…). */
  features: string[];
  trackName: string;
  night: boolean;
  /** Все трассы ротации (для выбора в панели). */
  tracks: { id: string; name: string }[];
  triangles: number;
  camera: { manualId: number | null; targetId: number; shot: string };
  standings: {
    id: number;
    name: string;
    color: string;
    lap: number;
    finished: boolean;
    playerId: string | null;
    /** Машина (id из ростера). */
    vehicle: string;
  }[];
  roster: { id: string; name: string }[];
  queue: { id: string; name: string }[];
  settings: GameSettings;
  bridge: BridgeStatus | null;
  likes: { bar: number; target: number; bursts: number };
  feed: { name: string; what: string; effect: string | null; test: boolean; at: number }[];
  leaderboard: { name: string; points: number; wins: number; kills: number; races: number }[];
  eliminated: string[];
  /** Окно игры (случайный id): панель видит, если игра открыта в двух местах сразу. */
  instance: string;
  /** Игра в OBS (браузер OBS называет себя в User-Agent). */
  obs: boolean;
  /** Звук: состояние (running — играет; suspended — ждёт щелчка) и сколько моторов слышно. */
  audio: { state: string; engines: number };
}

export interface SoakReport {
  races: number;
  allFinished: boolean;
  respawns: number;
  /** Из них — возвраты после вылета с обрыва или недолёта трамплина (это часть трассы, не застревание). */
  falls: number;
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
  /** Ростер машин (для панели, витрин и тестов). */
  readonly vehicles = VEHICLES;
  settings: GameSettings;
  private views = new Map<number, CarView>();
  private wheels!: WheelRenderer;
  private hud!: RaceHud;
  private lobby!: LobbyScreen;
  nameTags!: NameTags;
  fx!: EffectsRenderer;
  private weather!: Weather;
  private wheelFx!: WheelFx;
  private trackFx!: TrackFxView;
  private aurora!: Aurora;
  private lastShot = '';
  private lastTarget = -1;
  feed!: EventFeed;
  private likeBar!: LikeBar;
  private bridgeInd!: BridgeIndicator;
  bridge: BridgeClient | null = null;
  readonly sound = new SoundSystem();
  private ceremony!: Ceremony;
  /** Источники моторов (переиспользуются каждый кадр — без мусора для сборщика). */
  private readonly engineSources: EngineSource[] = [];
  private readonly camRight = new Vector3();
  private lastCount = 0;
  /** Обломки кузова на сцене: id обломка → меш. */
  private readonly debrisMeshes = new Map<number, Mesh>();
  private trackVisual: { key: string; visual: TrackVisual; props: Group } | null = null;
  private loadingTrack: Promise<void> | null = null;
  private last = 0;
  private lastStats: FrameStats = { drawCalls: 0, triangles: 0, textures: 0, geometries: 0 };
  private statusTimer = 0;
  private hudSpeed: HTMLElement;
  private hudFps: HTMLElement;
  private simMsAvg = 0;
  private cpuMsAvg = 0;
  private renderMsAvg = 0;
  private soaking = false;
  /** Сколько кадров отрисовано (тесты ждут кадры, а не секунды — SwiftShader медленный). */
  frameCount = 0;
  ready = false;
  readonly errors: string[] = [];
  /** Id этого окна игры — для предупреждения «игра открыта дважды». */
  readonly instance = Math.random().toString(36).slice(2, 10);

  constructor(canvas: HTMLCanvasElement, params: UrlParams) {
    this.params = params;
    const base = import.meta.env.BASE_URL;
    this.renderer = new Renderer(canvas, base, params.off);
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

  async start(onProgress: (k: number, label: string) => void): Promise<void> {
    onProgress(0.1, 'Физика');
    const hudRoot = document.getElementById('hud') as HTMLElement;
    this.nameTags = new NameTags(hudRoot);
    this.hud = new RaceHud(hudRoot);
    this.lobby = new LobbyScreen(hudRoot);
    this.lobby.vehicles = VEHICLES.map((v) => ({ number: v.number, name: v.name, rare: v.rarity === 'rare' }));
    this.feed = new EventFeed(hudRoot);
    this.likeBar = new LikeBar(hudRoot);
    this.bridgeInd = new BridgeIndicator(hudRoot);
    this.wheels = new WheelRenderer(this.renderer.scene);
    this.fx = new EffectsRenderer(this.renderer.scene);
    this.fx.setDensity(this.renderer.quality.particles);
    this.weather = new Weather(this.renderer.scene);
    this.wheelFx = new WheelFx(this.renderer.scene, this.fx.smoke);
    this.trackFx = new TrackFxView(this.renderer.scene);
    this.aurora = new Aurora(this.renderer.scene);
    this.ceremony = new Ceremony(this.renderer.scene);
    this.sound.setVolumes(this.settings.audio);
    this.bindAudioUnlock();
    onProgress(0.2, 'Машины');
    await preloadCarModels(VEHICLES, import.meta.env.BASE_URL);
    this.session = await Session.create({
      seed: this.params.seed,
      settings: this.settings.session,
      tracks: TRACKS,
      // ?track= в адресе — всегда эта трасса (просмотр, тесты).
      trackFor: this.params.track ? () => trackById(this.params.track as string) : undefined,
      vehiclesFor: () => {
        const only = VEHICLES.filter((v) => v.id === this.params.car);
        return only.length ? only : VEHICLES;
      },
    });
    this.session.mapping = this.settings.gifts;
    this.loadLeaderboard();
    this.nameTags.showHp = true;
    this.bindSession();
    this.fx.bind(this.sim);
    this.trackFx.bind(this.sim, this.session.night);
    this.bindSimEvents(this.sim);
    this.startBridge();
    onProgress(0.3, 'Трасса и освещение');
    await this.ensureTrack(this.sim.track.def);
    this.syncViews();
    onProgress(1, 'Готово');
    this.ready = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  /**
   * Звук: в OBS играет сразу; в обычном браузере — после первого щелчка или клавиши
   * (так браузеры защищают от внезапного звука). ?mute — без звука (тесты).
   */
  private bindAudioUnlock(): void {
    if (this.params.mute) return;
    this.sound.unlock();
    const unlock = (): void => this.sound.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  /** События трассы: телепорт (вспышка и звук), сбитое препятствие (искры и стук). */
  private bindSimEvents(sim: Simulation): void {
    sim.events.on('portal', ({ car, from, to }) => {
      this.sound.portal();
      this.fx.sparks(from, 6);
      this.fx.highlightCar(car, '#c58bff', 1.2);
      this.director.hotspot(car.id, to, 2);
    });
    sim.events.on('prop-hit', ({ pos }) => {
      this.sound.thump();
      this.fx.sparks(pos, 3);
    });
  }

  private bindSession(): void {
    const ev = this.session.events;
    ev.on('race-created', ({ sim }) => {
      this.director.reset();
      this.fx?.bind(sim);
      this.trackFx?.bind(sim, this.session.night);
      this.bindSimEvents(sim);
      this.wheelFx?.setTrack(sim.track);
      for (const m of this.debrisMeshes.values()) {
        this.renderer.scene.remove(m);
        m.geometry.dispose();
      }
      this.debrisMeshes.clear();
      sim.events.on('part', ({ car, debris }) => {
        const mesh = this.views.get(car.id)?.detachPart(debris.part);
        if (!mesh) return;
        this.renderer.scene.add(mesh);
        this.debrisMeshes.set(debris.id, mesh);
      });
      sim.events.on('explode', ({ car, killer }) => {
        this.sound.boom(car.cur.p, this.renderer.camera.position);
        this.director.hotspot(car.id, car.cur.p, 3);
        if (!killer)
          this.feed.push({
            name: car.name,
            what: 'взорвался',
            icon: null,
            emoji: '🔥',
            effect: null,
            test: false,
            color: readableColor(car.color),
          });
      });
      sim.events.on('out', ({ car }) =>
        this.feed.push({ name: car.name, what: 'выбыл из гонки', icon: null, emoji: '💀', effect: null, test: false }),
      );
      sim.events.on('finish', (e) => {
        this.director.hotspot(e.car.id, e.car.cur.p, 2.5);
        if (e.place === 1) this.sound.fanfare();
      });
      sim.events.on('crash', (e) => this.sound.hit(e.amount, e.pos, this.renderer.camera.position));
      if (this.trackVisual?.key !== this.trackKey(sim.track.def)) this.loadingTrack = this.ensureTrack(sim.track.def);
    });
    ev.on('car-choice', ({ player, spec, when }) => {
      const car = this.session.carForPlayer(player.id);
      this.feed.push({
        name: player.name,
        what:
          when === 'rare'
            ? `${spec.name} ★ — редкая, нужен подарок`
            : when === 'next'
              ? `выбрал «${spec.name}» (со следующего заезда)`
              : `выбрал «${spec.name}»`,
        icon: null,
        emoji: when === 'rare' ? '🔒' : '🚗',
        effect: null,
        test: player.test,
        color: car ? readableColor(car.color) : undefined,
      });
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
      this.sound.gift(giftTier(g.total));
    });
    ev.on('kill', ({ killer, victim }) => {
      this.feed.push({
        name: killer.name,
        what: `уничтожил ${victim.name}`,
        icon: null,
        emoji: '💥',
        effect: null,
        note: '+2 очка',
        test: false,
        color: readableColor(killer.color),
      });
      this.saveLeaderboard();
    });
    ev.on('results', () => this.saveLeaderboard());
    ev.on('likes', (e) => {
      if (e.burst) {
        this.likeBar.burst();
        this.sound.nitro();
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

  /** Трасса + время суток: смена любого — пересборка декора и света. */
  private trackKey(def: TrackDef): string {
    return `${def.id}|${this.session.night ? 'night' : 'day'}`;
  }

  private async ensureTrack(def: TrackDef): Promise<void> {
    if (this.trackVisual?.key === this.trackKey(def)) return;
    if (this.trackVisual) {
      this.renderer.scene.remove(this.trackVisual.visual.group, this.trackVisual.props);
      // Старая трасса больше не нужна — освободить видеокарту (иначе за часы эфира копится).
      disposeObject(this.trackVisual.visual.group);
      disposeObject(this.trackVisual.props);
      this.trackVisual = null;
    }
    const preset = this.presetFor(def);
    await this.renderer.applyPreset(preset);
    const visual = buildTrackVisual(this.sim.track);
    if (preset.wet > 0) for (const m of visual.wetMaterials) makeWet(m, preset.wet);
    const props = buildProps(this.sim.track, preset.night);
    const w = this.params.weather;
    const kind: WeatherKind = w === 'rain' || w === 'snow' || w === 'dust' || w === 'none' ? w : preset.weather;
    this.weather.set(kind, this.renderer.quality.particles);
    this.wheelFx.setTrack(this.sim.track);
    this.wheelFx.wet = preset.wet > 0;
    this.fx.smoke.setLight(preset.smokeLight);
    this.aurora.set(!!preset.aurora);
    this.renderer.scene.add(visual.group, props.group);
    this.trackVisual = { key: this.trackKey(def), visual, props: props.group };
    this.director.chase.occluders = [props.group];
    this.loadingTrack = null;
  }

  /** Освещение трассы; ?light= в адресе — посмотреть трассу в другом пресете. */
  private presetFor(def: TrackDef): LightingPreset {
    const id = this.params.light;
    if (id && PRESETS[id]) return PRESETS[id] as LightingPreset;
    return presetById(this.session.night && def.lightingNight ? def.lightingNight : def.lighting);
  }

  /** Сообщение в формате Bridge (настоящее или мок) → разбор → сессия. Один путь для всех. */
  ingest(raw: BridgeEnvelope): void {
    const ev = this.normalizer.normalize(raw);
    if (ev) this.session.handle(ev);
  }

  private loadLeaderboard(): void {
    if (this.params.fresh) return;
    try {
      const raw = localStorage.getItem('gonki:leaderboard');
      if (raw) this.session.leaderboard.load(JSON.parse(raw));
    } catch {
      // Испорченная запись — начинаем с чистого листа.
    }
  }

  private saveLeaderboard(): void {
    if (this.params.fresh) return;
    try {
      localStorage.setItem('gonki:leaderboard', JSON.stringify(this.session.leaderboard.toJSON()));
    } catch {
      // Нет места — лидерборд живёт до перезагрузки.
    }
  }

  /** Обломки следуют за телами в симуляции и исчезают вместе с ними. */
  private updateDebris(alpha: number): void {
    const alive = new Set<number>();
    for (const d of this.sim.debris) {
      const m = this.debrisMeshes.get(d.id);
      if (!m) continue;
      alive.add(d.id);
      m.position.lerpVectors(d.prev.p, d.cur.p, alpha);
      m.quaternion.slerpQuaternions(d.prev.q, d.cur.q, alpha);
    }
    for (const [id, m] of this.debrisMeshes)
      if (!alive.has(id)) {
        this.renderer.scene.remove(m);
        m.geometry.dispose();
        this.debrisMeshes.delete(id);
      }
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

  /** Загрузка всех настроек из файла: заезд, качество, Bridge, подарки, звук. */
  private applyAllSettings(next: GameSettings): void {
    this.settings = next;
    this.session.updateSettings(next.session);
    this.session.mapping = next.gifts;
    this.renderer.setQuality(next.quality);
    this.fx.setDensity(this.renderer.quality.particles);
    this.weather.set(this.weather.kind, this.renderer.quality.particles);
    this.renderer.setResolutionScale(next.resolution);
    this.sound.setVolumes(next.audio);
    this.persist();
    this.startBridge();
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
          this.fx.setDensity(this.renderer.quality.particles);
          this.weather.set(this.weather.kind, this.renderer.quality.particles);
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
        else if (payload === 'closeup') this.director.closeUp = !this.director.closeUp;
        else if (payload === 'auto' || payload === null) {
          this.director.forceOverview = false;
          this.director.closeUp = false;
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
      case 'volume':
        this.sound.setVolumes(p as Partial<Volumes>);
        this.settings.audio = sanitizeSettings({ audio: this.sound.volumes }).audio;
        this.sound.setVolumes(this.settings.audio);
        this.persist();
        break;
      case 'settings-import':
        try {
          this.applyAllSettings(importSettings(String(p.text ?? '')));
          this.channel.send('settings-imported', { ok: true });
        } catch (e) {
          this.channel.send('settings-imported', { ok: false, error: (e as Error).message });
        }
        break;
      case 'session-reset':
        this.session.resetSession();
        this.saveLeaderboard();
        this.feed.clear();
        break;
      case 'leaderboard-reset':
        this.session.leaderboard.reset();
        this.saveLeaderboard();
        break;
      case 'leaderboard-get':
        this.channel.send('leaderboard', this.session.leaderboard.toJSON());
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
      renderMs: +this.renderMsAvg.toFixed(2),
      features: this.renderer.features,
      trackName: sim?.track.def.name ?? '',
      night: ses?.night ?? false,
      tracks: TRACKS.map((t) => ({ id: t.id, name: t.name })),
      triangles: this.lastStats.triangles,
      camera: { manualId: this.director.manualId, targetId: this.director.targetId, shot: this.director.shot },
      standings: (sim?.standings() ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        lap: c.race.lap,
        finished: c.race.finished,
        playerId: c.playerId,
        vehicle: c.spec.id,
      })),
      roster: (ses?.roster ?? []).map((p) => ({ id: p.id, name: p.rawName })),
      queue: (ses?.queue ?? []).map((p) => ({ id: p.id, name: p.rawName })),
      settings: { ...this.settings, session: ses?.settings ?? this.settings.session },
      bridge: this.bridge ? { ...this.bridge.status } : null,
      likes: { bar: ses?.likeBar ?? 0, target: this.settings.gifts.likes.target, bursts: ses?.likeBursts ?? 0 },
      feed: (this.feed?.history ?? [])
        .slice(-12)
        .map((f) => ({ name: f.name, what: f.what, effect: f.effect, test: f.test, at: f.at ?? 0 })),
      leaderboard: (ses?.leaderboard.top(10) ?? []).map((r) => ({
        name: r.name,
        points: r.points,
        wins: r.wins,
        kills: r.kills,
        races: r.races,
      })),
      eliminated: (sim?.cars ?? []).filter((c) => c.race.out).map((c) => c.name),
      audio: this.sound.info(),
      instance: this.instance,
      obs: /OBS\//.test(navigator.userAgent),
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
      this.updateCeremony();
      const alpha = this.stepper.alpha;
      this.wheels.begin();
      for (const v of this.views.values()) v.update(alpha, this.wheels, this.sim.combat);
      this.updateDebris(alpha);
      this.wheels.end();
      this.director.lobbyOffset = this.session.phase === 'lobby';
      this.director.winnerId = this.session.phase === 'podium' ? (this.sim.standings()[0]?.id ?? null) : null;
      const focus = this.director.update(dt, this.renderer.camera, this.sim, this.views);
      if (this.director.shot !== this.lastShot || this.director.targetId !== this.lastTarget) {
        this.renderer.cut();
        this.lastShot = this.director.shot;
        this.lastTarget = this.director.targetId;
      }
      this.renderer.updateSun(focus, this.director.shot === 'overview');
      this.ceremony.update(dt);
      this.updateAudio();
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
      // LOD машин: дальше 45 м — без мелких деталей.
      const camPos = this.renderer.camera.position;
      for (const v of this.views.values()) v.setNear(v.pos.distanceToSquared(camPos) < 45 * 45);
      this.wheelFx.update(dt, this.views);
      this.trackFx.update(dt, this.views);
      this.weather.update(dt, this.renderer.camera);
      this.aurora.update(dt, this.renderer.camera);
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
      const r0 = performance.now();
      this.lastStats = this.renderer.render(dt);
      this.renderMsAvg += (performance.now() - r0 - this.renderMsAvg) * 0.1;
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

  /**
   * Церемония: на подиуме тройка встаёт на ступени, остальные машины скрыты,
   * камера ходит дугой перед подиумом. Симуляция при этом не меняется.
   */
  private updateCeremony(): void {
    const on = this.session.phase === 'podium' && !this.loadingTrack;
    if (on && !this.ceremony.active) {
      this.ceremony.start(this.sim.track);
      const top = this.session.lastResults.slice(0, 3);
      const ids = new Map(top.map((r, i) => [r.id, i]));
      for (const v of this.views.values()) {
        const i = ids.get(v.car.id);
        const spot = i !== undefined ? this.ceremony.spots[i] : undefined;
        v.pose = spot ?? null;
        v.hidden = !spot;
      }
      this.director.podium = { center: this.ceremony.center, front: this.ceremony.front };
      this.renderer.cut();
      this.sound.fanfare();
    } else if (!on && this.ceremony.active) {
      this.ceremony.stop();
      for (const v of this.views.values()) {
        v.pose = null;
        v.hidden = false;
      }
      this.director.podium = null;
    }
  }

  /** Моторы ближайших машин, отсчёт 3-2-1, громкость музыки по фазе. */
  private updateAudio(): void {
    const cam = this.renderer.camera;
    this.camRight.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const src = this.engineSources;
    src.length = 0;
    const ceremony = this.ceremony.active;
    if (!ceremony)
      for (const v of this.views.values()) {
        const c = v.car;
        if (c.race.out || c.wrecked) continue;
        const speed = Math.abs(c.phys.forwardSpeed());
        src.push({
          id: c.id,
          pos: v.pos,
          speed,
          frac: Math.min(1, speed / c.phys.vmax),
          throttle: Math.max(0, c.controls.throttle),
          mass: c.spec.mass,
        });
      }
    this.sound.updateEngines(src, cam.position, this.camRight);
    // Отсчёт: по одному сигналу на 3, 2, 1 и высокий — на старт.
    const sim = this.sim;
    const count = sim.phase === 'countdown' ? Math.ceil(-sim.raceTime) : sim.phase === 'race' ? 0 : -1;
    if (count !== this.lastCount) {
      if (count > 0 && count <= 3) this.sound.countdown(false);
      else if (count === 0 && this.lastCount > 0) this.sound.countdown(true);
      this.lastCount = count;
    }
    const ph = this.session.phase;
    this.sound.setMusicLevel(ph === 'podium' ? 0.55 : ph === 'countdown' ? 0.6 : ph === 'race' ? 0.75 : 1);
  }

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
    const report: SoakReport = { races: 0, allFinished: true, respawns: 0, falls: 0, maxNoProgress: 0, perRace: [] };
    const ses = this.session;
    const saved = { ...ses.settings };
    ses.updateSettings({ lobbySeconds: 5, podiumSeconds: 3 });
    try {
      for (let r = 0; r < n; r++) {
        const sim = ses.sim;
        let respawns = 0;
        const lastMove = new Map<number, { p: number; t: number }>();
        sim.events.on('revive', (e) => lastMove.delete(e.car.id));
        sim.events.on('respawn', (e) => {
          respawns++;
          if (e.reason === 'fall') report.falls++;
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
              // Взорванная машина 3 с стоит до возрождения — это не застревание.
              if (!m || c.race.progress > m.p + 5 || c.race.finished || c.wrecked || c.race.out)
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
