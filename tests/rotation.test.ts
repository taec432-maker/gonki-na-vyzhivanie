import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/bridge/protocol';
import { STEP_HZ } from '../src/core/loop';
import { parseCarChoice } from '../src/race/carChoice';
import { Session, type SessionSettings } from '../src/race/session';
import { TRACKS } from '../src/tracks';
import { VEHICLES } from '../src/vehicles';

const chat = (userId: string, text: string): GameEvent => ({ kind: 'chat', userId, name: userId, text, test: true });
const gift = (userId: string): GameEvent => ({
  kind: 'gift',
  userId,
  name: userId,
  giftId: '5655',
  giftName: 'Rose',
  diamonds: 1,
  count: 1,
  total: 1,
  picture: null,
  test: true,
});

const make = (settings: Partial<SessionSettings> = {}) =>
  Session.create({ seed: 7, settings, tracks: TRACKS, vehiclesFor: () => VEHICLES });

/** Прогнать сессию до следующего лобби (короткие заезды). */
function nextLobby(s: Session): void {
  s.updateSettings({ lobbySeconds: 5, podiumSeconds: 3 });
  const start = s.raceIndex;
  for (let i = 0; i < 60 * 60 * STEP_HZ && s.raceIndex === start; i++) s.step();
}

describe('Выбор машины из чата', () => {
  it('понимает номер и название', () => {
    expect(parseCarChoice('машина 7', VEHICLES)?.id).toBe('jeep');
    expect(parseCarChoice('Машина №6', VEHICLES)?.id).toBe('pickup');
    expect(parseCarChoice('хочу машину 16!', VEHICLES)?.id).toBe('buggy');
    expect(parseCarChoice('тачка 2', VEHICLES)?.id).toBe('sports');
    expect(parseCarChoice('машина пикап', VEHICLES)?.id).toBe('pickup');
    expect(parseCarChoice('Машина Трактор пожалуйста', VEHICLES)?.id).toBe('tractor');
    expect(parseCarChoice('машина мусоровоз', VEHICLES)?.id).toBe('garbage');
    expect(parseCarChoice('машина мороженщика', VEHICLES)?.id).toBe('icecream');
  });

  it('не срабатывает на обычных сообщениях и несуществующих номерах', () => {
    expect(parseCarChoice('привет всем', VEHICLES)).toBeNull();
    expect(parseCarChoice('какая машина быстрее?', VEHICLES)).toBeNull();
    expect(parseCarChoice('машина 99', VEHICLES)).toBeNull();
    expect(parseCarChoice('машинально 5', VEHICLES)).toBeNull();
  });

  it('в лобби — машина меняется сразу; в заезде — со следующего', async () => {
    const s = await make();
    s.handle(chat('u1', 'машина 6'));
    const car = s.carForPlayer('u1');
    expect(car?.spec.id).toBe('pickup');
    // Старт гонки, затем смена выбора — применится в следующем заезде.
    for (let i = 0; i < 50 * STEP_HZ && s.phase !== 'race'; i++) s.step();
    expect(s.phase).toBe('race');
    const seen: string[] = [];
    s.events.on('car-choice', (e) => seen.push(e.when));
    s.handle(chat('u1', 'машина багги'));
    expect(seen).toEqual(['next']);
    expect(s.carForPlayer('u1')?.spec.id).toBe('pickup');
    nextLobby(s);
    expect(s.carForPlayer('u1')?.spec.id).toBe('buggy');
  });

  it('редкая машина — только тому, кто дарил подарок (настройка)', async () => {
    const s = await make();
    const seen: string[] = [];
    s.events.on('car-choice', (e) => seen.push(`${e.player.id}:${e.spec.id}:${e.when}`));
    s.handle(chat('u1', 'машина 1'));
    expect(seen.at(-1)).toBe('u1:formula:rare');
    expect(s.carForPlayer('u1')?.spec.id).not.toBe('formula');
    s.handle(gift('u1'));
    s.handle(chat('u1', 'машина 1'));
    expect(s.carForPlayer('u1')?.spec.id).toBe('formula');
    // «Всем»: редкая доступна без подарка.
    s.updateSettings({ rareCars: 'free' });
    s.handle(chat('u2', 'машина 3'));
    expect(s.carForPlayer('u2')?.spec.id).toBe('supercar');
  });

  it('выбор машины — это и заявка на участие (вход по ключевому слову)', async () => {
    const s = await make({ joinMode: 'keyword', keyword: 'го' });
    s.handle(chat('u1', 'привет'));
    expect(s.carForPlayer('u1')).toBeUndefined();
    s.handle(chat('u1', 'машина 4'));
    expect(s.carForPlayer('u1')?.spec.id).toBe('rally');
  });
});

describe('Ротация трасс и время суток', () => {
  it('по кругу: трассы идут по порядку, день и ночь чередуются', async () => {
    const s = await make({ rotation: 'cycle', time: 'alternate' });
    const seen: string[] = [`${s.sim.track.def.id}:${s.night ? 'n' : 'd'}`];
    for (let i = 0; i < TRACKS.length; i++) {
      nextLobby(s);
      seen.push(`${s.sim.track.def.id}:${s.night ? 'n' : 'd'}`);
    }
    const ids = TRACKS.map((t) => t.id);
    expect(seen.map((x) => x.split(':')[0])).toEqual([...ids, ids[0]]);
    expect(seen.map((x) => x.split(':')[1]).slice(0, 4)).toEqual(['d', 'n', 'd', 'n']);
  }, 120_000);

  it('случайно: без повтора подряд и одинаково при том же seed', async () => {
    const run = async (): Promise<string[]> => {
      const s = await make({ rotation: 'random' });
      const out = [s.sim.track.def.id];
      for (let i = 0; i < 4; i++) {
        nextLobby(s);
        out.push(s.sim.track.def.id);
      }
      return out;
    };
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) expect(a[i]).not.toBe(a[i - 1]);
  }, 120_000);

  it('вручную: всегда выбранная трасса', async () => {
    const s = await make({ rotation: 'manual', track: TRACKS[TRACKS.length - 1]!.id, time: 'night' });
    expect(s.sim.track.def.id).toBe(TRACKS[TRACKS.length - 1]!.id);
    expect(s.night).toBe(true);
    nextLobby(s);
    expect(s.sim.track.def.id).toBe(TRACKS[TRACKS.length - 1]!.id);
  }, 60_000);
});
