import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/bridge/protocol';
import { STEP_HZ } from '../src/core/loop';
import { giftTier } from '../src/audio/sound';
import { importSettings, sanitizeSettings } from '../src/core/settings';
import { exportSettings } from '../src/core/settingsFile';
import { Session } from '../src/race/session';
import { TRACKS } from '../src/tracks';
import { VEHICLES } from '../src/vehicles';

/** Этап 7: сброс сессии, долгий эфир, настройки файлом, стингеры подарков. */
const chat = (userId: string): GameEvent => ({ kind: 'chat', userId, name: userId, text: 'го', test: true });
const make = () =>
  Session.create({
    seed: 3,
    settings: { maxCars: 6, inactiveMinutes: 1 },
    tracks: TRACKS,
    vehiclesFor: () => VEHICLES,
  });
const MIN = 60 * STEP_HZ;

describe('Сессия эфира', () => {
  it('«Сброс сессии»: нет зрителей, очереди, очков; ротация — с первой трассы', async () => {
    const s = await make();
    for (let i = 0; i < 10; i++) s.handle(chat(`u${i}`));
    s.skip();
    s.leaderboard.addKill('u1', 'u1');
    s.likeBar = 40;
    expect(s.raceIndex).toBe(1);
    s.resetSession();
    expect(s.players.size).toBe(0);
    expect(s.roster.length + s.queue.length).toBe(0);
    expect(s.leaderboard.top()).toEqual([]);
    expect(s.likeBar).toBe(0);
    expect(s.raceIndex).toBe(0);
    expect(s.sim.track.def.id).toBe(TRACKS[0]?.id);
    expect(s.sim.cars.every((c) => c.playerId === null)).toBe(true);
    expect(s.phase).toBe('lobby');
  });

  it('ушедшие зрители не получают машину и со временем забываются', async () => {
    const s = await make();
    for (let i = 0; i < 10; i++) s.handle(chat(`u${i}`));
    expect(s.queue.length).toBe(4);
    // Двое из очереди продолжают писать, остальные молчат больше минуты.
    s.tick += 2 * MIN;
    s.handle(chat('u8'));
    s.handle(chat('u9'));
    s.skip();
    expect(s.roster.map((p) => p.id).sort()).toEqual(['u8', 'u9']);
    expect(s.queue.length).toBe(0);
    expect(s.players.size).toBe(10);
    // Через час молчания запись о зрителе удаляется (очки в лидерборде — нет).
    s.leaderboard.addKill('u0', 'u0');
    s.tick += 61 * MIN;
    s.handle(chat('u9'));
    s.skip();
    // u8 ехал в только что закончившемся заезде — его забудут в следующий раз.
    expect([...s.players.keys()].sort()).toEqual(['u8', 'u9']);
    expect(s.leaderboard.top().map((r) => r.id)).toContain('u0');
  });
});

describe('Настройки одним файлом', () => {
  it('сохраняются и загружаются без потерь', () => {
    const a = sanitizeSettings({ quality: 'medium', audio: { master: 0.4, music: 0.1, sfx: 0.9 } });
    a.session.laps = 5;
    a.bridge.port = 3101;
    expect(importSettings(exportSettings(a))).toEqual(a);
  });

  it('чужой или битый файл — понятная ошибка, мусор в полях — значения по умолчанию', () => {
    expect(() => importSettings('не json')).toThrow('не удалось прочитать');
    expect(() => importSettings('{"a":1}')).toThrow('не файл настроек');
    const s = importSettings(
      JSON.stringify({
        app: 'gonki-na-vyzhivanie/settings',
        settings: { audio: { master: 7, music: 'x' }, quality: 'ultra' },
      }),
    );
    expect(s.audio.master).toBe(1);
    expect(s.audio.music).toBe(sanitizeSettings({}).audio.music);
    expect(s.quality).toBe('high');
  });
});

describe('Стингеры подарков', () => {
  it('дороже подарок — богаче звук', () => {
    expect(giftTier(1)).toBe(0);
    expect(giftTier(5)).toBe(1);
    expect(giftTier(99)).toBe(3);
    expect(giftTier(1000)).toBe(6);
    expect(giftTier(30000)).toBe(7);
  });
});
