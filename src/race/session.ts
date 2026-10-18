import { EventBus } from '../core/events';
import { STEP_HZ } from '../core/loop';
import { Rng, hashString } from '../core/rng';
import { Simulation, type RaceResult, type SimCar } from '../core/sim';
import { initPhysics } from '../physics/world';
import type { GameEvent, GiftEvent } from '../bridge/protocol';
import type { EffectId } from '../combat/effects';
import { DEFAULT_MAPPING, resolveGift, type GiftMapping, type Resolved } from '../gifts/mapping';
import type { TrackDef } from '../tracks/types';
import type { VehicleSpec } from '../vehicles/types';
import { parseCarChoice } from './carChoice';
import { labelName, originalName } from './names';
import { Leaderboard } from './scores';

/**
 * Сессия эфира (раздел 6 ТЗ): зрители, очередь, боты-заполнители и жизненный цикл
 * lobby → countdown → race → podium → lobby без участия стримера.
 * Ничего не знает о рендере — проверяется в Node так же, как в браузере.
 */
export type SessionPhase = 'lobby' | 'countdown' | 'race' | 'podium';

export interface Player {
  id: string;
  /** Подпись над машиной (фильтр, ≤ 16 символов). */
  name: string;
  /** Оригинальный ник — для лидерборда. */
  rawName: string;
  /** Порядковый номер заявки — очередь идёт по нему. */
  seq: number;
  lastActiveTick: number;
  races: number;
  test: boolean;
  /** Выбранная машина (id) — «машина N» в чате; null — случайная. */
  vehicle: string | null;
  /** Дарил подарки в этой сессии — может выбрать редкую машину. */
  gifted: boolean;
}

export interface SessionSettings {
  /** Машин на трассе: 6–16 (ТЗ, по умолчанию 12). */
  maxCars: number;
  /** Меньше зрителей — добиваем ботами до этого числа. */
  minCars: number;
  laps: number;
  lobbySeconds: number;
  podiumSeconds: number;
  timeLimit: number;
  joinMode: 'any' | 'keyword';
  keyword: string;
  /** Зритель выбывает из ротации, если молчит столько минут и уже прокатился. */
  inactiveMinutes: number;
  /** «Гонка» (возрождение) или «Выживание» (выбывание). */
  mode: 'race' | 'survival';
  /** Ротация трасс: по кругу, случайно (без повтора подряд) или одна выбранная. */
  rotation: 'cycle' | 'random' | 'manual';
  /** Трасса для ручного выбора (id). */
  track: string;
  /** Время суток: день, ночь или по очереди. */
  time: 'day' | 'night' | 'alternate';
  /** Редкие машины: только тем, кто дарил подарок, или всем. */
  rareCars: 'gift' | 'free';
}

export const DEFAULT_SETTINGS: SessionSettings = {
  maxCars: 12,
  minCars: 6,
  laps: 3,
  lobbySeconds: 45,
  podiumSeconds: 15,
  timeLimit: 240,
  joinMode: 'any',
  keyword: 'го',
  inactiveMinutes: 15,
  mode: 'race',
  rotation: 'cycle',
  track: '',
  time: 'alternate',
  rareCars: 'gift',
};

export function clampSettings(s: Partial<SessionSettings>, base: SessionSettings = DEFAULT_SETTINGS): SessionSettings {
  const n = (v: unknown, lo: number, hi: number, d: number): number => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d;
  };
  const maxCars = n(s.maxCars, 6, 16, base.maxCars);
  return {
    maxCars,
    minCars: Math.min(maxCars, n(s.minCars, 1, 16, base.minCars)),
    laps: n(s.laps, 1, 10, base.laps),
    lobbySeconds: n(s.lobbySeconds, 5, 300, base.lobbySeconds),
    podiumSeconds: n(s.podiumSeconds, 3, 60, base.podiumSeconds),
    timeLimit: n(s.timeLimit, 60, 900, base.timeLimit),
    joinMode: s.joinMode === 'keyword' || s.joinMode === 'any' ? s.joinMode : base.joinMode,
    keyword: typeof s.keyword === 'string' && s.keyword.trim() ? s.keyword.trim().slice(0, 24) : base.keyword,
    inactiveMinutes: n(s.inactiveMinutes, 1, 240, base.inactiveMinutes),
    mode: s.mode === 'survival' || s.mode === 'race' ? s.mode : base.mode,
    rotation: s.rotation === 'cycle' || s.rotation === 'random' || s.rotation === 'manual' ? s.rotation : base.rotation,
    track: typeof s.track === 'string' ? s.track.slice(0, 40) : base.track,
    time: s.time === 'day' || s.time === 'night' || s.time === 'alternate' ? s.time : base.time,
    rareCars: s.rareCars === 'gift' || s.rareCars === 'free' ? s.rareCars : base.rareCars,
  };
}

export interface SessionEvents {
  'race-created': { sim: Simulation };
  'car-added': { car: SimCar };
  'car-removed': { car: SimCar };
  phase: { phase: SessionPhase };
  joined: { player: Player; where: 'race' | 'queue' };
  /** Подарок разобран: эффект применён сейчас, отложен до старта или зритель в очереди. */
  gift: {
    ev: GiftEvent;
    resolved: Resolved | null;
    outcome: 'now' | 'pending' | 'queue' | 'none';
    carId: number | null;
  };
  /** Нитро-бар лайков: полный — всем нитро. */
  likes: { bar: number; target: number; bursts: number; burst: boolean };
  results: { results: RaceResult[]; raceIndex: number };
  /** Уничтожение соперника (очки за килл). */
  kill: { killer: SimCar; victim: SimCar };
  /** Зритель выбрал машину в чате: сразу (лобби), со следующего заезда или отказ (редкая). */
  'car-choice': { player: Player; spec: VehicleSpec; when: 'now' | 'next' | 'rare' };
  event: { ev: GameEvent };
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
  '#e63946',
  '#1d6fd8',
  '#f5b800',
  '#2fbf71',
  '#f2f2f2',
  '#ff7a00',
  '#9b5de5',
  '#00c2d1',
  '#ff4fa3',
  '#a8e10c',
  '#8d99ae',
  '#c1121f',
  '#40e0d0',
  '#ffd166',
  '#3a0ca3',
  '#7f5539',
];

export interface SessionOptions {
  seed: number;
  settings?: Partial<SessionSettings>;
  /** Все трассы для ротации (раздел 9 ТЗ). */
  tracks?: TrackDef[];
  /** Принудительно: трасса для заезда №i (тесты, просмотр с ?track=). */
  trackFor?: (raceIndex: number) => TrackDef;
  /** Ростер машин для трассы. */
  vehiclesFor: (track: TrackDef) => VehicleSpec[];
}

export class Session {
  readonly events = new EventBus<SessionEvents>();
  readonly players = new Map<string, Player>();
  /** Участники текущего заезда (зрители; боты — только в sim). */
  roster: Player[] = [];
  queue: Player[] = [];
  settings: SessionSettings;
  sim!: Simulation;
  phase: SessionPhase = 'lobby';
  phaseTick = 0;
  tick = 0;
  raceIndex = 0;
  /** Ночь в текущем заезде (время суток — настройка). */
  night = false;
  /** Пауза (кнопка «Стоп» в панели). */
  paused = false;
  lastResults: RaceResult[] = [];
  /** Лидерборд сессии (очки за места и уничтожения). */
  readonly leaderboard = new Leaderboard();
  /** Маппинг подарков (хранит игра, сюда — копия). */
  mapping: GiftMapping = DEFAULT_MAPPING;
  /** Нитро-бар лайков. */
  likeBar = 0;
  likeBursts = 0;
  /** Эффекты, подаренные до старта, — сработают на старте (не больше 3 на зрителя). */
  private readonly pending = new Map<string, { effect: EffectId; power: number; giftName: string }[]>();
  private readonly rng: Rng;
  private readonly opts: SessionOptions;
  private seq = 0;
  /** Машина каждого игрока в текущем заезде. */
  private readonly carOf = new Map<string, SimCar>();

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.rng = new Rng(opts.seed).fork('session');
    this.settings = clampSettings(opts.settings ?? {});
    this.newLobby('first');
  }

  /** Создать сессию (инициализирует физику). */
  static async create(opts: SessionOptions): Promise<Session> {
    await initPhysics();
    return new Session(opts);
  }

  /** Seed заезда — от seed сессии и номера: вся сессия воспроизводима. */
  raceSeed(index: number): number {
    return (hashString(`${this.opts.seed}:${index}`) ^ this.opts.seed) >>> 0;
  }

  updateSettings(patch: Partial<SessionSettings>): void {
    this.settings = clampSettings(patch, this.settings);
  }

  get bots(): SimCar[] {
    return this.sim.cars.filter((c) => c.playerId === null);
  }

  carForPlayer(id: string): SimCar | undefined {
    return this.carOf.get(id);
  }

  private pickColor(): string {
    const used = new Set(this.sim.cars.map((c) => c.color));
    return CAR_COLORS.find((c) => !used.has(c)) ?? this.rng.pick(CAR_COLORS);
  }

  private pickVehicle(player: Player | null): VehicleSpec {
    const list = this.opts.vehiclesFor(this.sim.track.def);
    const common = list.filter((v) => v.rarity === 'common');
    if (player?.vehicle) {
      const chosen = list.find((v) => v.id === player.vehicle);
      if (chosen) return chosen;
    }
    return this.rng.pick(common.length ? common : list);
  }

  private addPlayerCar(p: Player): SimCar {
    const car = this.sim.addCar({ name: p.name, color: this.pickColor(), spec: this.pickVehicle(p), playerId: p.id });
    this.carOf.set(p.id, car);
    this.events.emit('car-added', { car });
    return car;
  }

  private addBot(): SimCar {
    const used = new Set(this.bots.map((b) => b.name));
    const free = BOT_NAMES.filter((n) => !used.has(`Бот ${n}`));
    const name = `Бот ${free.length ? this.rng.pick(free) : this.rng.pick(BOT_NAMES)}`;
    const car = this.sim.addCar({ name, color: this.pickColor(), spec: this.pickVehicle(null), playerId: null });
    this.events.emit('car-added', { car });
    return car;
  }

  private removeCar(car: SimCar): void {
    this.sim.removeCar(car);
    if (car.playerId) this.carOf.delete(car.playerId);
    this.events.emit('car-removed', { car });
  }

  /** Трасса заезда: по настройке ротации; случайная — по seed сессии, без повтора подряд. */
  private pickTrack(index: number, prev: string | undefined): TrackDef {
    if (this.opts.trackFor) return this.opts.trackFor(index);
    const list = this.opts.tracks ?? [];
    if (list.length === 0) throw new Error('Нет трасс для сессии');
    const rot = this.settings.rotation;
    if (rot === 'manual') return list.find((t) => t.id === this.settings.track) ?? (list[0] as TrackDef);
    if (rot === 'cycle') return list[index % list.length] as TrackDef;
    const rng = new Rng(hashString(`${this.opts.seed}:track:${index}`));
    const pool = list.length > 1 ? list.filter((t) => t.id !== prev) : list;
    return rng.pick(pool);
  }

  /** Выбор машины из чата: в лобби — сразу, во время заезда — со следующего. */
  private chooseCar(p: Player, spec: VehicleSpec): void {
    if (spec.rarity === 'rare' && this.settings.rareCars === 'gift' && !p.gifted) {
      this.events.emit('car-choice', { player: p, spec, when: 'rare' });
      return;
    }
    p.vehicle = spec.id;
    const car = this.carOf.get(p.id);
    const now = !!car && this.phase === 'lobby' && this.sim.phase === 'grid';
    if (now && car && car.spec.id !== spec.id) this.sim.swapVehicle(car, spec);
    this.events.emit('car-choice', { player: p, spec, when: now || !car ? 'now' : 'next' });
  }

  /** Боты до минимума; лишние боты уходят, если зрителей уже хватает. */
  private balanceBots(): void {
    const s = this.settings;
    while (this.sim.cars.length < s.minCars) this.addBot();
    let bots = this.bots;
    while (this.sim.cars.length > Math.max(s.minCars, this.roster.length) && bots.length > 0) {
      this.removeCar(bots[bots.length - 1] as SimCar);
      bots = this.bots;
    }
  }

  /** Новое лобби: новая симуляция, в заезд — очередь по порядку заявок. */
  private newLobby(mode: 'first' | 'next' | 'restart' | 'reset' = 'next'): void {
    const old = this.sim;
    if (mode === 'restart') {
      // Те же участники — обратно в начало очереди, в том же порядке.
      this.queue.unshift(...this.roster);
    } else if (mode === 'next') {
      this.raceIndex++;
      // Кто ехал — в конец очереди (ротация), кто давно молчит — выбывает.
      const idleTicks = this.settings.inactiveMinutes * 60 * STEP_HZ;
      for (const p of this.roster) {
        p.races++;
        if (this.tick - p.lastActiveTick < idleTicks && this.players.has(p.id)) this.queue.push(p);
      }
      // Кто давно молчит в очереди — ушёл с эфира: машину ему не даём.
      this.queue = this.queue.filter((p) => this.tick - p.lastActiveTick < idleTicks);
      this.forgetIdle();
    }
    this.roster = [];
    this.carOf.clear();
    if (mode !== 'restart') this.pending.clear();
    if (old) {
      for (const c of [...old.cars]) this.events.emit('car-removed', { car: c });
      old.dispose();
    }
    const track = mode === 'restart' && old ? old.track.def : this.pickTrack(this.raceIndex, old?.track.def.id);
    this.night = this.settings.time === 'night' || (this.settings.time === 'alternate' && this.raceIndex % 2 === 1);
    this.sim = Simulation.createSync({
      seed: this.raceSeed(this.raceIndex),
      track,
      laps: this.settings.laps,
      timeLimit: this.settings.timeLimit,
      mode: this.settings.mode,
      vehicles: this.opts.vehiclesFor(track),
    });
    this.sim.events.on('explode', ({ car, killer }) => {
      if (killer?.playerId && killer !== car) {
        this.leaderboard.addKill(killer.playerId, this.players.get(killer.playerId)?.rawName ?? killer.name);
        this.events.emit('kill', { killer, victim: car });
      }
    });
    this.events.emit('race-created', { sim: this.sim });
    while (this.roster.length < this.settings.maxCars && this.queue.length > 0) {
      const p = this.queue.shift() as Player;
      this.roster.push(p);
      this.addPlayerCar(p);
    }
    this.balanceBots();
    this.setPhase('lobby');
  }

  private setPhase(p: SessionPhase): void {
    this.phase = p;
    this.phaseTick = 0;
    this.events.emit('phase', { phase: p });
  }

  /** Заявка зрителя: в текущее лобби, если есть место, иначе — в очередь. */
  join(id: string, rawName: string, test = false): Player {
    let p = this.players.get(id);
    if (!p) {
      p = {
        id,
        name: labelName(rawName),
        rawName: originalName(rawName) || labelName(rawName),
        seq: ++this.seq,
        lastActiveTick: this.tick,
        races: 0,
        test,
        vehicle: null,
        gifted: false,
      };
      this.players.set(id, p);
    }
    p.lastActiveTick = this.tick;
    if (this.roster.includes(p) || this.queue.includes(p)) return p;
    if (this.phase === 'lobby' && this.roster.length < this.settings.maxCars) {
      this.roster.push(p);
      // Сначала уступает место бот, потом добавляется машина.
      const bot = this.bots.at(-1);
      if (bot && this.sim.cars.length >= Math.max(this.settings.minCars, this.roster.length)) this.removeCar(bot);
      this.addPlayerCar(p);
      this.balanceBots();
      this.events.emit('joined', { player: p, where: 'race' });
    } else {
      this.queue.push(p);
      this.events.emit('joined', { player: p, where: 'queue' });
    }
    return p;
  }

  /**
   * Долгий эфир: зрителей, которые молчат больше часа и не стоят в очереди, забываем
   * (очки в лидерборде остаются). Иначе за 10 часов эфира копились бы тысячи записей.
   */
  private forgetIdle(): void {
    const limit = Math.max(60, this.settings.inactiveMinutes * 4) * 60 * STEP_HZ;
    const keep = new Set([...this.roster, ...this.queue]);
    for (const [id, p] of this.players)
      if (!keep.has(p) && this.tick - p.lastActiveTick > limit && !this.pending.has(id)) this.players.delete(id);
  }

  /** Убрать зрителя (кнопка в панели): из очереди, лобби или с трассы. */
  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.queue = this.queue.filter((q) => q !== p);
    if (this.roster.includes(p)) {
      this.roster = this.roster.filter((q) => q !== p);
      const car = this.carOf.get(id);
      if (car) this.removeCar(car);
      if (this.phase === 'lobby') this.balanceBots();
    }
  }

  /** Подарок от зрителя в очереди поднимает его в начало очереди (ТЗ). */
  bump(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    const i = this.queue.indexOf(p);
    if (i > 0) {
      this.queue.splice(i, 1);
      this.queue.unshift(p);
    }
  }

  /** Событие чата/подарка/лайка (реальное или мок — один путь). */
  handle(ev: GameEvent): void {
    this.events.emit('event', { ev });
    const known = this.players.get(ev.userId);
    if (known) known.lastActiveTick = this.tick;
    if (ev.kind === 'chat') {
      const choice = parseCarChoice(ev.text, this.opts.vehiclesFor(this.sim.track.def));
      // Выбор машины — тоже заявка на участие (даже если вход по ключевому слову).
      const wants =
        !!choice ||
        this.settings.joinMode === 'any' ||
        ev.text.toLowerCase().includes(this.settings.keyword.toLowerCase());
      if (wants && !known) this.join(ev.userId, ev.name, ev.test);
      else if (wants && known && !this.roster.includes(known) && !this.queue.includes(known))
        this.join(ev.userId, ev.name, ev.test);
      const p = this.players.get(ev.userId);
      if (choice && p) this.chooseCar(p, choice);
    } else if (ev.kind === 'gift') {
      if (!known) this.join(ev.userId, ev.name, ev.test);
      const giver = this.players.get(ev.userId);
      if (giver) giver.gifted = true;
      this.bump(ev.userId);
      this.applyGift(ev);
    } else if (ev.kind === 'like') {
      this.addLikes(ev.count);
    }
  }

  /** Подарок → эффект на машине дарителя (раздел 7 ТЗ). */
  private applyGift(ev: GiftEvent): void {
    const resolved = resolveGift(this.mapping, ev);
    const car = this.carOf.get(ev.userId);
    let outcome: 'now' | 'pending' | 'queue' | 'none' = 'none';
    if (!resolved) outcome = 'none';
    else if (car && (this.phase === 'race' || this.phase === 'countdown') && !car.race.finished) {
      this.sim.combat.enqueue(car.id, resolved.effect, resolved.power, {
        from: ev.name,
        giftName: ev.giftName,
        via: 'gift',
      });
      outcome = 'now';
    } else if (car && this.phase === 'lobby') {
      const list = this.pending.get(ev.userId) ?? [];
      if (list.length < 3) list.push({ effect: resolved.effect, power: resolved.power, giftName: ev.giftName });
      this.pending.set(ev.userId, list);
      outcome = 'pending';
    } else outcome = 'queue';
    this.events.emit('gift', { ev, resolved, outcome, carId: car?.id ?? null });
  }

  /** Лайки копятся в общий нитро-бар; полный — всем машинам нитро. */
  addLikes(n: number): void {
    const target = this.mapping.likes.target;
    this.likeBar += n;
    let burst = false;
    if (this.likeBar >= target && this.phase === 'race') {
      this.likeBar -= target;
      if (this.likeBar > target) this.likeBar = target - 1;
      this.likeBursts++;
      burst = true;
      for (const car of this.sim.cars)
        if (!car.race.out)
          this.sim.combat.enqueue(car.id, 'nitro', this.mapping.likes.nitroSeconds / 2, { via: 'likes' });
    } else if (this.likeBar > target) this.likeBar = target;
    this.events.emit('likes', { bar: this.likeBar, target, bursts: this.likeBursts, burst });
  }

  /** Отложенные до старта подарки — в очередь эффектов. */
  private releasePending(): void {
    for (const [userId, list] of this.pending) {
      const car = this.carOf.get(userId);
      if (!car) continue;
      for (const e of list)
        this.sim.combat.enqueue(car.id, e.effect, e.power, { from: car.name, giftName: e.giftName, via: 'gift' });
    }
    this.pending.clear();
  }

  /** Старт вручную (из панели): лобби сразу в отсчёт. */
  startNow(): void {
    if (this.phase === 'lobby') this.beginCountdown();
    this.paused = false;
  }

  /** Перезапуск заезда: новое лобби с теми же участниками. */
  restart(): void {
    this.newLobby('restart');
  }

  /** Сразу к следующему заезду (участники уходят в ротацию). */
  skip(): void {
    this.newLobby();
  }

  /**
   * «Сброс сессии» (панель): как новый эфир — нет зрителей, очереди, очков,
   * подарков до старта и лайков; ротация трасс — с начала. Настройки не трогаются.
   */
  resetSession(): void {
    this.players.clear();
    this.queue = [];
    this.roster = [];
    this.leaderboard.reset();
    this.likeBar = 0;
    this.likeBursts = 0;
    this.lastResults = [];
    this.raceIndex = 0;
    this.paused = false;
    this.newLobby('reset');
  }

  private beginCountdown(): void {
    this.balanceBots();
    // Решётка: зрители впереди в случайном порядке, боты — сзади.
    const players = this.rng.shuffle(this.sim.cars.filter((c) => c.playerId !== null));
    const bots = this.sim.cars.filter((c) => c.playerId === null);
    this.sim.arrangeGrid([...players, ...bots]);
    this.sim.startCountdown();
    this.setPhase('countdown');
  }

  /** Один шаг 1/60 с. */
  step(): void {
    this.tick++;
    if (this.paused && this.phase !== 'race' && this.phase !== 'countdown') return;
    this.sim.running = !this.paused;
    this.sim.step();
    this.phaseTick++;
    const s = this.settings;
    switch (this.phase) {
      case 'lobby':
        if (this.phaseTick >= s.lobbySeconds * STEP_HZ) this.beginCountdown();
        break;
      case 'countdown':
        if (this.sim.phase === 'race') {
          this.setPhase('race');
          this.releasePending();
          // Бар заполнился в лобби — взрыв нитро прямо на старте.
          if (this.likeBar >= this.mapping.likes.target) this.addLikes(0);
        }
        break;
      case 'race':
        if (this.sim.phase === 'finished') {
          this.lastResults = this.sim.results();
          this.leaderboard.addRace(this.lastResults, (id) => this.players.get(id)?.rawName ?? id);
          this.events.emit('results', { results: this.lastResults, raceIndex: this.raceIndex });
          this.setPhase('podium');
        }
        break;
      case 'podium':
        if (this.phaseTick >= s.podiumSeconds * STEP_HZ) this.newLobby();
        break;
    }
  }

  /** Секунд до конца лобби/подиума (для экрана). */
  get secondsLeft(): number {
    const s = this.settings;
    if (this.phase === 'lobby') return Math.max(0, s.lobbySeconds - this.phaseTick / STEP_HZ);
    if (this.phase === 'podium') return Math.max(0, s.podiumSeconds - this.phaseTick / STEP_HZ);
    return 0;
  }

  dispose(): void {
    this.sim.dispose();
    this.events.clear();
  }
}
