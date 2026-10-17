import { describe, expect, it } from 'vitest';
import { RAM, hitZone, ramDamage, wallDamage } from '../src/combat/damage';

describe('Урон от тарана (раздел 6 ТЗ)', () => {
  const base = { massSelf: 1300, massOther: 1300, zoneSelf: 'side' as const, zoneOther: 'front' as const };
  it('мелкие касания — 0', () => {
    expect(ramDamage({ ...base, closing: RAM.threshold - 0.5 })).toBe(0);
  });
  it('растёт с относительной скоростью', () => {
    expect(ramDamage({ ...base, closing: 20 })).toBeGreaterThan(ramDamage({ ...base, closing: 10 }));
  });
  it('тяжёлый соперник бьёт сильнее, лёгкий — слабее (масса соперника / масса жертвы)', () => {
    const heavy = ramDamage({ ...base, closing: 12, massOther: 2600 });
    const light = ramDamage({ ...base, closing: 12, massOther: 650 });
    expect(heavy).toBeCloseTo(light * 4, 0);
  });
  it('в зад и в бок больнее, чем лоб в лоб', () => {
    const c = 14;
    const rear = ramDamage({ ...base, closing: c, zoneSelf: 'rear' });
    const side = ramDamage({ ...base, closing: c, zoneSelf: 'side' });
    const head = ramDamage({ ...base, closing: c, zoneSelf: 'front', zoneOther: 'front' });
    expect(rear).toBeGreaterThan(side);
    expect(side).toBeGreaterThan(head);
  });
  it('атакующий носом получает меньше, чем жертва в зад', () => {
    const victim = ramDamage({ ...base, closing: 15, zoneSelf: 'rear', zoneOther: 'front' });
    const attacker = ramDamage({ ...base, closing: 15, zoneSelf: 'front', zoneOther: 'rear' });
    expect(attacker).toBeLessThan(victim / 2);
  });
  it('один удар не больше потолка', () => {
    expect(ramDamage({ ...base, closing: 200, massOther: 9000 })).toBe(RAM.cap);
  });
  it('зоны удара по направлению в системе машины', () => {
    expect(hitZone(0, -2)).toBe('front');
    expect(hitZone(0, 2)).toBe('rear');
    expect(hitZone(2, 0.3)).toBe('side');
  });
  it('стены: медленно — 0, быстро — небольшой урон', () => {
    expect(wallDamage(5)).toBe(0);
    expect(wallDamage(20)).toBeGreaterThan(0);
    expect(wallDamage(80)).toBeLessThanOrEqual(25);
  });
});
