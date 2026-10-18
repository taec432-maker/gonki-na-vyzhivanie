/**
 * Короткие синтезированные звуки (подарок, нитро, взрыв) на WebAudio — без файлов.
 * Полноценный звук с моторами и музыкой — этап 7.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  volume = 0.5;
  enabled = true;

  private ac(): AudioContext | null {
    if (!this.enabled || typeof AudioContext === 'undefined') return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slide = 0, delay = 0): void {
    const ac = this.ac();
    if (!ac || ac.state !== 'running') return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * this.volume, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  gift(): void {
    this.tone(880, 0.12, 'triangle', 0.25);
    this.tone(1320, 0.18, 'triangle', 0.2, 1, 0.08);
  }

  nitro(): void {
    this.tone(220, 0.4, 'sawtooth', 0.12, 2.5);
  }

  portal(): void {
    this.tone(300, 0.35, 'sine', 0.2, 4);
  }

  thump(): void {
    this.tone(90, 0.15, 'square', 0.12, 0.5);
  }

  boom(): void {
    this.tone(120, 0.5, 'square', 0.18, 0.25);
  }
}
