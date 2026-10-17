import { Vector3 } from 'three';
import { STEP_HZ } from '../core/loop';
import type { SimCar, Simulation } from '../core/sim';
import type { Combat, EffectMeta, TrapHazard } from './combat';
import { EFFECTS } from './effects';

/**
 * Остальные эффекты раздела 7 ТЗ (этап 4): Мины, ЭМИ, Монстр, Армагеддон, Телепорт,
 * Гвозди, Призрак, Магнит, Шутка, Смена машины, Воскрешение.
 * Регистрируются в боевой системе симуляции; всё детерминированно.
 */
export function installArsenal(combat: Combat, sim: Simulation): void {
  const opponents = (car: SimCar): SimCar[] => sim.cars.filter((c) => c !== car && !c.race.out && !c.wrecked);

  // --- Мины ×3: позади машины с интервалом 0,5 с, 35 урона.
  combat.on('mines', (car, power) => {
    const n = Math.max(1, Math.round(3 * power));
    for (let i = 0; i < n; i++)
      combat.later(Math.round(i * 0.5 * STEP_HZ), () => {
        if (!car.race.out && !car.wrecked) dropMine(car);
      });
  });
  const dropMine = (car: SimCar): TrapHazard => {
    const fwd = car.phys.forward(new Vector3());
    const pos = car.cur.p.clone().addScaledVector(fwd, -(car.spec.dims.length / 2 + 2.2));
    const pr = sim.track.path.project(pos.x, pos.y, pos.z, car.hint);
    pos.y = sim.track.path.pointAt(pr.s, pr.d).y;
    const h: TrapHazard = {
      id: combat.newId(),
      kind: 'mine',
      ownerId: car.id,
      pos,
      s: pr.s,
      d: pr.d,
      radius: 1.9,
      until: sim.tick + 90 * STEP_HZ,
      ownerSafeUntil: sim.tick + 3 * STEP_HZ,
      damage: 35,
    };
    combat.traps.push(h);
    combat.events.emit('mine-drop', { hazard: h });
    return h;
  };
  combat.mineHook = (h, victim) => {
    const pos = h.pos.clone();
    pos.y += 0.3;
    combat.events.emit('impact', { pos, kind: 'mine', targetId: victim.id });
    const m = victim.spec.mass;
    if (!combat.invulnerable(victim)) {
      victim.phys.body.applyImpulse({ x: 0, y: m * 7, z: 0 }, true);
      victim.phys.body.applyTorqueImpulse({ x: m * 1.2, y: 0, z: m * 0.6 }, true);
    }
    combat.damage(victim, h.damage, 'mine', h.ownerId);
  };

  // --- ЭМИ: все соперники глохнут на 2,5 с.
  combat.on('emp', (car, power) => {
    for (const o of opponents(car)) combat.addTimed(o, 'emped', EFFECTS.emp.duration * power, power, car.id);
    combat.events.emit('emp', { car });
  });

  // --- Монстр: ×2 размер, ×3 масса, неуязвим, таран = 60 урона, 10 с.
  combat.on('monster', (car, power) => {
    combat.addTimed(car, 'monster', EFFECTS.monster.duration * power, power, car.id);
  });

  // --- Армагеддон: метеор в каждого соперника (50 урона), дарителю +1 позиция.
  combat.on('armageddon', (car) => {
    const targets = opponents(car);
    targets.forEach((t, i) => {
      combat.later(Math.round((0.3 + (i / Math.max(1, targets.length)) * 1.4) * STEP_HZ), () => {
        if (!t.race.out && !t.wrecked) combat.dropMeteor(t, car.id, 50);
      });
    });
    sim.teleportAhead(car);
    combat.addTimed(car, 'shield', 2.5, 1, car.id);
    combat.events.emit('armageddon', { car });
  });

  // --- Телепорт: +1 позиция.
  combat.on('teleport', (car) => {
    sim.teleportAhead(car);
  });

  // --- Гвозди: прокол у всех позади — −30 % скорости на 6 с.
  combat.on('nails', (car, power) => {
    for (const o of opponents(car))
      if (o.race.progress < car.race.progress)
        combat.addTimed(o, 'punctured', EFFECTS.nails.duration * power, power, car.id);
    combat.events.emit('nails', { car });
  });

  // --- Призрак: сквозь машины 5 с.
  combat.on('ghost', (car, power) => {
    combat.addTimed(car, 'ghost', EFFECTS.ghost.duration * power, power, car.id);
  });

  // --- Магнит: 3 с стягивает соперников в радиусе 45 м к себе.
  combat.on('magnet', (car, power) => {
    combat.addTimed(car, 'magnet', EFFECTS.magnet.duration * power, power, car.id);
  });

  // --- Шутка: соперники на газонокосилках 8 с (медленно и смешно).
  combat.on('joke', (car, power) => {
    const mower = sim.vehiclePool.find((v) => v.body === 'mower') ?? null;
    for (const o of opponents(car)) {
      o.jokeSpec = mower;
      combat.addTimed(o, 'mower', EFFECTS.joke.duration * power, power, car.id);
    }
  });

  // --- Смена машины: своя → случайная редкая.
  combat.on('swapcar', (car) => {
    const rare = sim.vehiclePool.filter((v) => v.rarity === 'rare' && v.id !== car.spec.id);
    const pool = rare.length ? rare : sim.vehiclePool.filter((v) => v.id !== car.spec.id);
    if (!pool.length) return;
    sim.swapVehicle(car, combat.pick(pool));
  });

  // --- Воскрешение: в «Выживании» вернуть себя в гонку; если ещё в гонке — запасная жизнь.
  combat.on('revive', (car, power, meta: EffectMeta) => {
    if (sim.config.mode !== 'survival') {
      // В «Гонке» выбывания нет — даём ремонт, чтобы подарок не пропал.
      car.hp = Math.min(car.maxHp, car.hp + 40 * power);
      return;
    }
    if (car.race.out) sim.revive(car);
    else car.spareLife = true;
    void meta;
  });

  // --- Множители физики от состояний этапа 4.
  combat.modifierHook = (car) => {
    const ph = car.phys;
    if (combat.has(car, 'emped')) {
      ph.stalled = true;
      ph.stability = 3;
    }
    if (combat.has(car, 'punctured')) {
      ph.maxSpeedMul *= 0.7;
      ph.powerMul *= 0.75;
      ph.gripMul *= 0.85;
    }
    if (combat.has(car, 'mower')) {
      ph.maxSpeedMul *= 0.45;
      ph.powerMul *= 0.55;
    }
    const monster = combat.has(car, 'monster');
    ph.setScale(monster ? 2 : 1);
    ph.setMassMul(monster ? 3 : 1);
    if (monster) ph.powerMul *= 2.6;
    const ghostNow = combat.has(car, 'ghost') || car.ghostUntil > sim.tick;
    ph.setGhost(ghostNow);
  };

  // --- Магнит — сила каждый шаг.
  combat.stepHook = () => {
    for (const car of sim.cars) {
      if (!combat.has(car, 'magnet') || car.race.out) continue;
      for (const o of opponents(car)) {
        const dir = car.cur.p.clone().sub(o.cur.p);
        dir.y = 0;
        const dist = dir.length();
        if (dist > 45 || dist < 3) continue;
        dir.normalize();
        const k = (o.spec.mass * 9 * (1 - dist / 45)) / STEP_HZ;
        o.phys.body.applyImpulse({ x: dir.x * k, y: 0, z: dir.z * k }, true);
      }
    }
  };
}
