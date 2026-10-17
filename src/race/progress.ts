import { crossesGate, type Track } from '../tracks/track';

/**
 * Учёт кругов и позиций (раздел 6 ТЗ): чекпойнты проходятся строго по порядку,
 * поэтому срезать нельзя; круг засчитывается на линии старта после всех чекпойнтов.
 */
export interface RacerProgress {
  id: number;
  /** Сколько ворот пройдено по порядку с начала гонки (первые — линия старта). */
  gatesPassed: number;
  /** Пройдено полных кругов. */
  lap: number;
  finished: boolean;
  /** Шаг симуляции, на котором финишировал. */
  finishTick: number;
  /** Непрерывный прогресс в метрах (для позиций). */
  progress: number;
  /** Шаг последнего пройденного чекпойнта. */
  lastGateTick: number;
  /** Сошёл с гонки (выбыл в «Выживании»). */
  out: boolean;
  outTick: number;
}

export class RaceTracker {
  readonly track: Track;
  readonly laps: number;
  private readonly racers = new Map<number, RacerProgress>();
  /** Расстояние от каждых ворот до следующих (м). */
  private readonly gaps: number[];
  private finishOrder = 0;

  constructor(track: Track, laps: number) {
    this.track = track;
    this.laps = laps;
    const g = track.gates;
    this.gaps = g.map((gate, i) => {
      const next = g[(i + 1) % g.length] ?? gate;
      const d = track.path.wrapS(next.s - gate.s);
      return d === 0 ? track.length : d;
    });
  }

  get gateCount(): number {
    return this.track.gates.length;
  }

  /** Ворот нужно пройти для финиша: старт + laps кругов. */
  get gatesToFinish(): number {
    return this.laps * this.gateCount + 1;
  }

  add(id: number): RacerProgress {
    const p: RacerProgress = {
      id,
      gatesPassed: 0,
      lap: 0,
      finished: false,
      finishTick: 0,
      progress: 0,
      lastGateTick: 0,
      out: false,
      outTick: 0,
    };
    this.racers.set(id, p);
    return p;
  }

  remove(id: number): void {
    this.racers.delete(id);
  }

  get(id: number): RacerProgress | undefined {
    return this.racers.get(id);
  }

  all(): RacerProgress[] {
    return [...this.racers.values()];
  }

  /** Индекс ворот, которые машина должна пройти следующими. */
  nextGateIndex(p: RacerProgress): number {
    return p.gatesPassed % this.gateCount;
  }

  /** Последние пройденные ворота (для респауна); до старта — линия старта. */
  lastGateIndex(p: RacerProgress): number {
    return p.gatesPassed === 0 ? 0 : (p.gatesPassed - 1) % this.gateCount;
  }

  /**
   * Обновить после шага: движение (px,pz)→(x,z), прогресс s на линии.
   * Возвращает 'gate' | 'lap' | 'finish' | null.
   */
  update(
    id: number,
    px: number,
    pz: number,
    x: number,
    z: number,
    s: number,
    tick: number,
  ): 'gate' | 'lap' | 'finish' | null {
    const p = this.racers.get(id);
    if (!p || p.finished || p.out) return null;
    let result: 'gate' | 'lap' | 'finish' | null = null;
    const gate = this.track.gates[this.nextGateIndex(p)];
    if (gate && crossesGate(gate, px, pz, x, z)) {
      // Только вперёд по ходу трассы.
      const dx = x - px;
      const dz = z - pz;
      const fwd = dx * Math.sin(gate.heading) - dz * Math.cos(gate.heading);
      if (fwd > 0) {
        p.gatesPassed++;
        p.lastGateTick = tick;
        result = 'gate';
        if (p.gatesPassed > 1 && (p.gatesPassed - 1) % this.gateCount === 0) {
          p.lap = (p.gatesPassed - 1) / this.gateCount;
          result = 'lap';
        }
        if (p.gatesPassed >= this.gatesToFinish) {
          p.finished = true;
          p.finishTick = tick;
          p.lap = this.laps;
          this.finishOrder++;
          result = 'finish';
        }
      }
    }
    p.progress = this.progressOf(p, s);
    return result;
  }

  /** Принудительно засчитать ворота (телепорт трассы или подарок «Телепорт»). */
  skipTo(id: number, s: number, tick: number): void {
    const p = this.racers.get(id);
    if (!p || p.finished) return;
    // Проходим все ворота между текущим положением и s (не дальше финиша).
    let guard = 0;
    while (guard++ < this.gateCount && p.gatesPassed < this.gatesToFinish - 1) {
      const gate = this.track.gates[this.nextGateIndex(p)];
      if (!gate) break;
      const ahead = this.track.path.deltaS(gate.s, s);
      if (ahead <= 0) break;
      p.gatesPassed++;
      p.lastGateTick = tick;
      if (p.gatesPassed > 1 && (p.gatesPassed - 1) % this.gateCount === 0) p.lap = (p.gatesPassed - 1) / this.gateCount;
    }
    p.progress = this.progressOf(p, s);
  }

  /** Непрерывный прогресс: дистанция до последних ворот + путь от них (не дальше следующих). */
  progressOf(p: RacerProgress, s: number): number {
    const path = this.track.path;
    const G = this.gateCount;
    if (p.gatesPassed === 0) {
      // До линии старта — отрицательный прогресс.
      return path.deltaS(this.track.gates[0]?.s ?? 0, s);
    }
    const lastIdx = (p.gatesPassed - 1) % G;
    const last = this.track.gates[lastIdx];
    const lapsDone = Math.floor((p.gatesPassed - 1) / G);
    let base = lapsDone * this.track.length;
    for (let i = 0; i < lastIdx; i++) base += this.gaps[i] as number;
    const gap = this.gaps[lastIdx] as number;
    // deltaS со знаком: откатилась за ворота — 0, а не «почти полный круг».
    const along = Math.max(0, Math.min(gap - 0.01, path.deltaS(last?.s ?? 0, s)));
    return base + along;
  }

  /**
   * Порядок мест: финишировавшие — по времени финиша; дальше — по прогрессу;
   * выбывшие — в конце, кто выбыл позже — выше.
   */
  standings(): RacerProgress[] {
    return this.all().sort((a, b) => {
      if (a.out !== b.out) return a.out ? 1 : -1;
      if (a.out && b.out) return b.outTick - a.outTick;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTick - b.finishTick || a.id - b.id;
      return b.progress - a.progress || a.id - b.id;
    });
  }

  get finishedCount(): number {
    return this.finishOrder;
  }
}
