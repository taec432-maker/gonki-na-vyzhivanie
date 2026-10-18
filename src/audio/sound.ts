import type { Vector3 } from 'three';
import { MusicLoop } from './music';

/**
 * Звук эфира (раздел 12 и этап 7 ТЗ): моторы по оборотам с затуханием по дистанции,
 * удары, взрывы, стингеры подарков, отсчёт, музыка-подложка. Всё синтезируется
 * WebAudio прямо в браузере — без звуковых файлов, поэтому лицензия — как у кода.
 * Громкость: общая, музыка, эффекты (настройки игры, панель).
 */
export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

export const DEFAULT_VOLUMES: Volumes = { master: 0.8, music: 0.35, sfx: 0.8 };

/** Источник мотора: позиция, скорость, доля от максимума, «размер» мотора. */
export interface EngineSource {
  id: number;
  pos: Vector3;
  /** Скорость, м/с. */
  speed: number;
  /** Скорость / максимум машины, 0..1. */
  frac: number;
  throttle: number;
  /** Масса, кг — тяжёлые машины звучат ниже. */
  mass: number;
}

interface Voice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  id: number;
}

const ENGINE_VOICES = 6;

/** Тир стингера подарка по сумме алмазов: 1 → 0, 5 → 1 … 5000+ → 7. */
const GIFT_TIERS = [1, 5, 20, 60, 100, 300, 1000, 5000];
export function giftTier(diamonds: number): number {
  let t = 0;
  for (let i = 0; i < GIFT_TIERS.length; i++) if (diamonds >= (GIFT_TIERS[i] as number)) t = i;
  return t;
}

export class SoundSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private engineBus!: GainNode;
  private noise!: AudioBuffer;
  private voices: Voice[] = [];
  private music: MusicLoop | null = null;
  volumes: Volumes = { ...DEFAULT_VOLUMES };
  /** Музыка звучит (лобби и гонка); на подиуме — тише. */
  private musicLevel = 1;

  /** Создать звук. Браузер разрешает его после жеста; OBS — сразу. */
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctx = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    // Мягкий лимитер, чтобы 50 подарков в секунду не «рвали» звук.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    comp.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(comp);
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0.55;
    this.engineBus.connect(this.sfxBus);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (s / 0x7fffffff) * 2 - 1;
    }
    for (let i = 0; i < ENGINE_VOICES; i++) this.voices.push(this.makeVoice(ctx));
    this.music = new MusicLoop(ctx, this.musicBus);
    this.applyVolumes();
    return ctx;
  }

  /** Вызвать по первому жесту пользователя (в обычном браузере звук заблокирован до клика). */
  unlock(): void {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    this.music?.start();
  }

  /** Для панели и тестов: работает ли звук и сколько моторов сейчас звучит. */
  info(): { state: string; engines: number } {
    return { state: this.ctx?.state ?? 'off', engines: this.voices.filter((v) => v.id >= 0).length };
  }

  setVolumes(v: Partial<Volumes>): void {
    this.volumes = { ...this.volumes, ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const c = (x: number): number => Math.max(0, Math.min(1, x));
    this.master.gain.setTargetAtTime(c(this.volumes.master), t, 0.05);
    this.sfxBus.gain.setTargetAtTime(c(this.volumes.sfx), t, 0.05);
    this.musicBus.gain.setTargetAtTime(c(this.volumes.music) * this.musicLevel, t, 0.3);
  }

  /** Музыка тише на подиуме и во время отсчёта. */
  setMusicLevel(k: number): void {
    if (Math.abs(k - this.musicLevel) < 0.01) return;
    this.musicLevel = k;
    this.applyVolumes();
  }

  private makeVoice(ctx: AudioContext): Voice {
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const g2 = ctx.createGain();
    g2.gain.value = 0.45;
    osc1.connect(filter);
    osc2.connect(g2).connect(filter);
    filter.connect(gain).connect(pan).connect(this.engineBus);
    osc1.start();
    osc2.start();
    return { osc1, osc2, filter, gain, pan, id: -1 };
  }

  /**
   * Моторы: ближайшие к камере машины получают «голос». Обороты — по скорости
   * с переключением 5 передач, громкость — по дистанции, панорама — по стороне.
   */
  updateEngines(sources: readonly EngineSource[], camPos: Vector3, camRight: Vector3): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const near = [...sources]
      .map((s) => ({ s, d: s.pos.distanceTo(camPos) }))
      .filter((x) => x.d < 140)
      .sort((a, b) => a.d - b.d)
      .slice(0, ENGINE_VOICES);
    this.voices.forEach((v, i) => {
      const n = near[i];
      if (!n) {
        v.gain.gain.setTargetAtTime(0, t, 0.1);
        v.id = -1;
        return;
      }
      const { s, d } = n;
      const gears = 5;
      const g = Math.min(gears - 1, Math.floor(s.frac * gears));
      const inGear = s.frac * gears - g;
      const rpm = 0.25 + 0.75 * inGear * (0.85 + 0.15 * s.throttle);
      // Тяжёлые машины — ниже (мусоровоз ~35 Гц, спорткар ~70 Гц на холостых).
      const base = 70 * Math.pow(1300 / Math.max(300, s.mass), 0.35);
      const f = base * (1 + rpm * 2.6);
      v.osc1.frequency.setTargetAtTime(f, t, 0.04);
      v.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
      v.filter.frequency.setTargetAtTime(300 + rpm * 1800 + s.throttle * 600, t, 0.05);
      const vol = (0.12 + 0.18 * s.throttle) / (1 + d / 12);
      v.gain.gain.setTargetAtTime(vol, t, v.id === s.id ? 0.05 : 0.2);
      const rel = s.pos.clone().sub(camPos).normalize().dot(camRight);
      v.pan.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, rel)), t, 0.1);
      v.id = s.id;
    });
  }

  private distGain(pos: Vector3 | null, camPos: Vector3 | null): number {
    if (!pos || !camPos) return 1;
    return 1 / (1 + pos.distanceTo(camPos) / 25);
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    slide = 1,
    delay = 0,
    bus?: AudioNode,
  ): void {
    const ctx = this.ensure();
    // Пока браузер не разрешил звук, время стоит — не копим звуки, иначе после щелчка они грянут разом.
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(
    dur: number,
    freq: number,
    q: number,
    gain: number,
    delay = 0,
    type: BiquadFilterType = 'bandpass',
  ): void {
    const ctx = this.ensure();
    // Пока браузер не разрешил звук, время стоит — не копим звуки, иначе после щелчка они грянут разом.
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.6 + Math.random() * 0.8;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** Удар машин: сила 0..60 HP. */
  hit(amount: number, pos: Vector3 | null = null, camPos: Vector3 | null = null): void {
    const k = Math.min(1, amount / 30) * this.distGain(pos, camPos);
    if (k < 0.03) return;
    this.burst(0.18 + k * 0.2, 900 - k * 500, 1.2, 0.5 * k);
    this.tone(70 + Math.random() * 30, 0.2, 'sine', 0.4 * k, 0.5);
  }

  boom(pos: Vector3 | null = null, camPos: Vector3 | null = null): void {
    const k = Math.max(0.25, this.distGain(pos, camPos));
    this.burst(1.4, 300, 0.7, 0.9 * k, 0, 'lowpass');
    this.tone(90, 1.0, 'sine', 0.7 * k, 0.3);
    this.burst(0.3, 2500, 0.8, 0.25 * k);
  }

  thump(): void {
    this.burst(0.12, 400, 1.5, 0.25);
  }

  nitro(): void {
    this.burst(0.6, 1500, 0.6, 0.18, 0, 'highpass');
    this.tone(180, 0.5, 'sawtooth', 0.08, 2.4);
  }

  portal(): void {
    this.tone(260, 0.5, 'sine', 0.2, 4);
    this.tone(520, 0.4, 'triangle', 0.1, 3, 0.05);
  }

  /** Стингер подарка: чем дороже, тем богаче (тир 0..7). */
  gift(tier = 0): void {
    const roots = [523, 587, 659, 698, 784, 880, 988, 1047];
    const root = roots[Math.max(0, Math.min(7, tier))] as number;
    const notes = tier >= 6 ? [1, 1.26, 1.5, 2, 2.52] : tier >= 3 ? [1, 1.26, 1.5, 2] : [1, 1.5];
    notes.forEach((m, i) => this.tone(root * m, 0.25 + tier * 0.03, 'triangle', 0.22, 1, i * 0.07));
    if (tier >= 6) this.burst(0.8, 6000, 0.5, 0.12, 0.05, 'highpass');
  }

  /** Отсчёт: 3-2-1 — короткие, «СТАРТ» — высокий длинный. */
  countdown(go: boolean): void {
    this.tone(go ? 1320 : 660, go ? 0.5 : 0.18, 'square', 0.18);
  }

  /** Финиш победителя и церемония. */
  fanfare(): void {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.22, 1, i * 0.12));
  }

  dispose(): void {
    this.music?.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
