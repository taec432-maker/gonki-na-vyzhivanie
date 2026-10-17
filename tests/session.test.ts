import { describe, expect, it } from 'vitest';
import { Session } from '../src/race/session';
import { labelName } from '../src/race/names';
import { EventNormalizer } from '../src/bridge/normalize';
import { MockViewers } from '../src/bridge/mock';
import { trackById } from '../src/tracks';
import { VEHICLES } from '../src/vehicles';

const make = (settings = {}) =>
  Session.create({ seed: 42, settings, trackFor: () => trackById('port'), vehiclesFor: () => VEHICLES });

function addViewers(s: Session, n: number, mock = new MockViewers(1)): void {
  const norm = new EventNormalizer();
  for (let i = 0; i < n; i++) {
    const v = mock.viewer();
    const ev = norm.normalize(mock.chat(v.userId, v.name));
    if (ev) s.handle(ev);
  }
}

describe('Session — зрители и очередь', () => {
  it('без зрителей — 6 ботов-заполнителей', async () => {
    const s = await make();
    expect(s.sim.cars.length).toBe(6);
    expect(s.bots.length).toBe(6);
    expect(s.bots.every((b) => b.name.startsWith('Бот '))).toBe(true);
  });

  it('+20 игроков: 12 на трассе, 8 в очереди, ботов нет', async () => {
    const s = await make();
    addViewers(s, 20);
    expect(s.roster.length).toBe(12);
    expect(s.queue.length).toBe(8);
    expect(s.sim.cars.length).toBe(12);
    expect(s.bots.length).toBe(0);
  });

  it('зритель вытесняет бота, пока зрителей меньше минимума', async () => {
    const s = await make();
    const mock = new MockViewers(2);
    addViewers(s, 4, mock);
    expect(s.sim.cars.length).toBe(6);
    expect(s.bots.length).toBe(2);
    addViewers(s, 3, mock);
    expect(s.sim.cars.length).toBe(7);
    expect(s.bots.length).toBe(0);
  });

  it('один игрок — одна машина (повторные сообщения не добавляют машин)', async () => {
    const s = await make();
    const norm = new EventNormalizer();
    const m = new MockViewers(3);
    for (let i = 0; i < 5; i++) s.handle(norm.normalize(m.chat('u1', 'Alex', `сообщение ${i}`))!);
    expect(s.roster.length).toBe(1);
    expect(s.sim.cars.filter((c) => c.playerId === 'u1').length).toBe(1);
  });

  it('режим «ключевое слово»: входят только написавшие его', async () => {
    const s = await make({ joinMode: 'keyword', keyword: 'го' });
    const norm = new EventNormalizer();
    const m = new MockViewers(4);
    s.handle(norm.normalize(m.chat('a', 'A', 'привет'))!);
    s.handle(norm.normalize(m.chat('b', 'B', 'ГО гонять'))!);
    expect(s.roster.map((p) => p.id)).toEqual(['b']);
  });

  it('подарок поднимает зрителя в начало очереди', async () => {
    const s = await make();
    addViewers(s, 15);
    const last = s.queue.at(-1)!;
    const norm = new EventNormalizer();
    const ev = norm.normalize(new MockViewers(5).gift(last.id, last.name, 'Rose', 1, 1).at(-1)!)!;
    s.handle(ev);
    expect(s.queue[0]).toBe(last);
  });

  it('полный цикл: лобби → отсчёт → гонка → подиум → лобби; очередь заходит', async () => {
    const s = await make({ lobbySeconds: 5, podiumSeconds: 3, laps: 1 });
    addViewers(s, 20);
    const firstRoster = s.roster.map((p) => p.id);
    const queued = s.queue.map((p) => p.id);
    const phases: string[] = [];
    s.events.on('phase', (e) => phases.push(e.phase));
    let guard = 0;
    while (s.raceIndex === 0 && guard++ < 60 * 200) s.step();
    expect(phases).toEqual(['countdown', 'race', 'podium', 'lobby']);
    expect(s.lastResults.length).toBe(12);
    // В новом заезде — все 8 из очереди, остальные места — по ротации из прошлого заезда.
    const now = s.roster.map((p) => p.id);
    for (const id of queued) expect(now).toContain(id);
    expect(now.length).toBe(12);
    expect(s.queue.length).toBe(8);
    expect(s.queue.every((p) => firstRoster.includes(p.id))).toBe(true);
  });

  it('удалить игрока: из лобби — его машину заменяет бот', async () => {
    const s = await make();
    addViewers(s, 6);
    expect(s.bots.length).toBe(0);
    s.removePlayer(s.roster[0]!.id);
    expect(s.sim.cars.length).toBe(6);
    expect(s.bots.length).toBe(1);
  });
});

describe('Ники', () => {
  it('обрезка до 16 символов, без эмодзи и служебных символов', () => {
    expect(labelName('alex_2010🔥')).toBe('alex_2010');
    expect(labelName('Очень-очень длинный ник зрителя')).toBe('Очень-очень длин');
    expect([...labelName('Очень-очень длинный ник зрителя')].length).toBeLessThanOrEqual(16);
    expect(labelName('😎😎😎')).toBe('Игрок');
    expect(labelName('  Маша  ✨ ')).toBe('Маша');
    expect(labelName('<script>')).toBe('script');
  });
});

describe('Разбор событий Bridge', () => {
  it('комбо начисляется один раз — на repeatEnd, количество и стоимость верные', () => {
    const norm = new EventNormalizer();
    const series = new MockViewers(1).gift('u', 'U', 'Rose', 1, 5);
    const out = series.map((m) => norm.normalize(m)).filter(Boolean);
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({ kind: 'gift', count: 5, total: 5, diamonds: 1, test: true });
  });

  it('дубликат eventId игнорируется', () => {
    const norm = new EventNormalizer();
    const m = new MockViewers(1).chat('u', 'U');
    expect(norm.normalize(m)).not.toBeNull();
    expect(norm.normalize(m)).toBeNull();
  });

  it('пустой userId в чате — ключ username; прочие события — молча мимо', () => {
    const norm = new EventNormalizer();
    expect(
      norm.normalize({ event: 'chat', eventId: '1', data: { username: 'Alex', userId: '', text: 'hi' } }),
    ).toMatchObject({
      userId: 'Alex',
    });
    for (const e of ['media', 'game_action', 'status', 'welcome', 'catchup'])
      expect(norm.normalize({ event: e, eventId: e })).toBeNull();
  });
});
