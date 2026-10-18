/**
 * Музыка-подложка: синтезированный электронный луп (бас, аккорды, бочка, хэт),
 * 112 ударов в минуту, 8 тактов по кругу. Своя (создаётся кодом), поэтому без
 * лицензий на чужую музыку — можно спокойно ставить в эфир. Планировщик с запасом
 * 0,3 с вперёд — звук не «плывёт», даже если кадр долгий.
 */
const BPM = 112;
const STEP = 60 / BPM / 4; // шестнадцатая
// Аккорды: Am — F — C — G (каждый на 2 такта).
const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];
const BASS = [45, 41, 36, 43];

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

export class MusicLoop {
  private readonly ctx: AudioContext;
  private readonly out: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  /** Шум для хэта и малого барабана — один буфер на весь луп. */
  private readonly noise: AudioBuffer;

  constructor(ctx: AudioContext, bus: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.5;
    this.out.connect(bus);
    const len = Math.floor(ctx.sampleRate * 0.5);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 987654321;
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (s / 0x7fffffff) * 2 - 1;
    }
  }

  start(): void {
    if (this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 100);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    // Вкладка в фоне или звук ещё не разрешён — не догоняем пропущенное.
    if (this.ctx.state !== 'running') return;
    if (this.nextTime < this.ctx.currentTime) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + 0.3) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % (16 * 8);
    }
  }

  private playStep(step: number, t: number): void {
    const bar = Math.floor(step / 16);
    const chord = Math.floor(bar / 2) % CHORDS.length;
    const s16 = step % 16;
    if (s16 % 4 === 0) this.kick(t);
    if (s16 % 2 === 1) this.hat(t, s16 % 4 === 3 ? 0.05 : 0.03);
    if (s16 === 4 || s16 === 12) this.snare(t);
    // Бас — восьмыми.
    if (s16 % 2 === 0) this.note(midi(BASS[chord] as number), t, STEP * 1.8, 'sawtooth', 0.11, 420);
    // Аккорд — раз в такт, мягко.
    if (s16 === 0)
      for (const n of CHORDS[chord] as number[]) this.note(midi(n), t, STEP * 15, 'triangle', 0.045, 2200, 0.08);
    // Арпеджио на второй половине лупа.
    if (bar >= 4 && s16 % 3 === 0) {
      const notes = CHORDS[chord] as number[];
      this.note(midi((notes[(s16 / 3) % 3] as number) + 12), t, STEP * 1.2, 'square', 0.025, 3000);
    }
  }

  private note(
    freq: number,
    t: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    cutoff: number,
    attack = 0.01,
  ): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.3);
  }

  private noiseHit(t: number, dur: number, freq: number, gain: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    // Каждый удар — с другого места буфера, чтобы хэт не звучал «одним сэмплом».
    src.start(t, (this.step * 0.037) % 0.4, dur + 0.02);
  }

  private hat(t: number, gain: number): void {
    this.noiseHit(t, 0.04, 7000, gain);
  }

  private snare(t: number): void {
    this.noiseHit(t, 0.16, 1500, 0.09);
  }
}
