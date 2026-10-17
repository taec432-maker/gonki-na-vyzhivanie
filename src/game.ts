import { Vector3 } from 'three';
import { FixedStepper, STEP } from './core/loop';
import { LinkChannel, relayUrlFor } from './core/channel';
import type { UrlParams } from './core/params';
import { Simulation } from './core/sim';
import { ChaseCamera } from './render/cameraRig';
import { CarView } from './render/carView';
import { presetById } from './render/presets';
import { isQualityLevel } from './render/quality';
import { Renderer, type FrameStats } from './render/renderer';
import { buildTrackVisual } from './render/trackMesh';
import { WheelRenderer } from './render/wheels';
import { FrameStatsMeter } from './hud/stats';
import { trackById } from './tracks';
import { vehicleById } from './vehicles';

export interface GameStatus {
  state: 'loading' | 'running' | 'stopped';
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
}

/** Страница игры: симуляция + рендер + HUD + связь с панелью. */
export class Game {
  readonly params: UrlParams;
  sim!: Simulation;
  readonly renderer: Renderer;
  readonly stepper = new FixedStepper();
  readonly meter = new FrameStatsMeter();
  readonly channel: LinkChannel;
  private views: CarView[] = [];
  private wheels!: WheelRenderer;
  private readonly chase = new ChaseCamera();
  /** Режим камеры: за машиной или общий план трассы. */
  cameraMode: 'chase' | 'overview' = 'chase';
  private last = 0;
  private lastStats: FrameStats = { drawCalls: 0, triangles: 0, textures: 0, geometries: 0 };
  private statusTimer = 0;
  private hudSpeed: HTMLElement;
  private hudFps: HTMLElement;
  private simMsAvg = 0;
  private cpuMsAvg = 0;
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
    if (params.quality && isQualityLevel(params.quality)) this.renderer.setQuality(params.quality);
    window.addEventListener('resize', () => this.renderer.resize());
    this.channel.on((msg) => this.onCommand(msg.type, msg.payload));
  }

  async start(onProgress: (k: number, label: string) => void): Promise<void> {
    onProgress(0.1, 'Физика');
    const trackDef = trackById(this.params.track ?? 'test-oval');
    this.sim = await Simulation.create({ seed: this.params.seed, track: trackDef });
    onProgress(0.35, 'Освещение');
    await this.renderer.applyPreset(presetById(trackDef.lighting));
    onProgress(0.7, 'Трасса');
    const tv = buildTrackVisual(this.sim.track);
    this.renderer.scene.add(tv.group);
    this.wheels = new WheelRenderer(this.renderer.scene);
    onProgress(0.9, 'Машины');
    const car = this.sim.addCar(vehicleById('sports'), 'Тест', '#c8102e', 0);
    this.views.push(new CarView(this.renderer.scene, car));
    onProgress(1, 'Готово');
    this.ready = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private onCommand(type: string, payload: unknown): void {
    switch (type) {
      case 'start':
        this.sim.running = true;
        break;
      case 'stop':
        this.sim.running = false;
        break;
      case 'restart':
        this.restart();
        break;
      case 'quality':
        if (isQualityLevel(payload)) this.renderer.setQuality(payload);
        break;
      case 'resolution':
        if (typeof payload === 'number') this.renderer.setResolutionScale(payload);
        break;
      case 'camera':
        if (payload === 'chase' || payload === 'overview') this.setCameraMode(payload);
        break;
      case 'hello':
        this.sendStatus();
        break;
    }
  }

  setCameraMode(mode: 'chase' | 'overview'): void {
    this.cameraMode = mode;
    this.chase.snap();
  }

  /** Общий план: камера высоко над трассой, смотрит на центр и чуть в сторону машины. */
  private updateOverview(focus: Vector3): void {
    const path = this.sim.track.path;
    let cx = 0;
    let cz = 0;
    let r = 0;
    for (const sm of path.samples) {
      cx += sm.pos.x;
      cz += sm.pos.z;
    }
    cx /= path.samples.length;
    cz /= path.samples.length;
    for (const sm of path.samples) r = Math.max(r, Math.hypot(sm.pos.x - cx, sm.pos.z - cz));
    const cam = this.renderer.camera;
    cam.position.set(cx + r * 0.9, r * 0.75, cz + r * 1.1);
    cam.lookAt(cx * 0.7 + focus.x * 0.3, 0, cz * 0.7 + focus.z * 0.3);
  }

  private restart(): void {
    for (const v of this.views) {
      const slot = this.sim.track.gridSlots(1)[0];
      if (slot) v.car.phys.teleport(slot.pos, slot.heading);
    }
    this.chase.snap();
    this.sim.running = true;
  }

  status(): GameStatus {
    return {
      state: !this.ready ? 'loading' : this.sim.running ? 'running' : 'stopped',
      fps: Math.round(this.meter.fps()),
      frameMs: +this.meter.median().toFixed(2),
      tick: this.sim?.tick ?? 0,
      drawCalls: this.lastStats.drawCalls,
      quality: this.renderer.quality.level,
      resolution: this.renderer.resolutionScale,
      cars: this.sim?.cars.length ?? 0,
      simMs: +this.simMsAvg.toFixed(3),
      cpuMs: +this.cpuMsAvg.toFixed(3),
      triangles: this.lastStats.triangles,
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
    try {
      const t0 = performance.now();
      const steps = this.stepper.advance(dt);
      for (let i = 0; i < steps; i++) this.sim.step();
      const t1 = performance.now();
      if (steps > 0) this.simMsAvg += ((t1 - t0) / steps - this.simMsAvg) * 0.05;
      const alpha = this.stepper.alpha;
      this.wheels.begin();
      for (const v of this.views) v.update(alpha, this.wheels);
      this.wheels.end();
      const focus = this.views[0];
      if (focus) {
        if (this.cameraMode === 'overview') {
          this.updateOverview(focus.pos);
          this.renderer.updateSun(focus.pos, 160);
        } else {
          const ph = focus.car.phys;
          this.chase.update(dt, this.renderer.camera, focus.pos, focus.quat, ph.forwardSpeed(), ph.scale);
          this.renderer.updateSun(focus.pos);
        }
        this.hudSpeed.textContent = `${Math.round(Math.abs(focus.car.phys.forwardSpeed()) * 3.6)} км/ч`;
      }
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
    for (let i = 0; i < n; i++) this.sim.step();
  }

  get stepSeconds(): number {
    return STEP;
  }

  focusPosition(): Vector3 {
    return this.views[0]?.pos.clone() ?? new Vector3();
  }
}
