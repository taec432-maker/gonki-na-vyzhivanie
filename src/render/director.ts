import { Vector3, type PerspectiveCamera } from 'three';
import type { Simulation } from '../core/sim';
import { ChaseCamera, spring } from './cameraRig';
import type { CarView } from './carView';

export type Shot = 'orbit' | 'chase' | 'tv' | 'overview' | 'winner';

/**
 * Камера-режиссёр (раздел 9 ТЗ): облёт решётки на старте, дальше — за лидером
 * с плавными переключениями, иногда «телекамера» у трассы; горячие моменты
 * (взрыв, финиш) перехватывают кадр; из панели можно выбрать машину вручную.
 */
export class CameraDirector {
  readonly chase = new ChaseCamera();
  shot: Shot = 'orbit';
  targetId = -1;
  /** null — авто, иначе id машины, выбранной в панели. */
  manualId: number | null = null;
  /** Сдвиг облёта влево (в лобби справа панель со списком). */
  lobbyOffset = false;
  /** id победителя на подиуме — камера облетает его машину. */
  winnerId: number | null = null;
  /** Принудительный режим (тесты, панель): общий план. */
  forceOverview = false;
  private shotTime = 0;
  private sinceSwitch = 0;
  private sinceTv = 0;
  private orbitAngle = 0;
  private readonly tvPos = new Vector3();
  private readonly look = new Vector3();
  private readonly lookVel = new Vector3();
  private hot: { pos: Vector3; until: number; carId: number } | null = null;
  private time = 0;
  readonly focus = new Vector3();

  /** Горячий момент: камера на несколько секунд переключается на эту машину. */
  hotspot(carId: number, pos: Vector3, seconds = 3): void {
    if (this.manualId !== null) return;
    this.hot = { pos: pos.clone(), until: this.time + seconds, carId };
  }

  reset(): void {
    this.shot = 'orbit';
    this.targetId = -1;
    this.shotTime = 0;
    this.sinceSwitch = 0;
    this.sinceTv = 0;
    this.hot = null;
    this.winnerId = null;
    this.chase.snap();
  }

  private setShot(s: Shot): void {
    if (this.shot === s) return;
    this.shot = s;
    this.shotTime = 0;
    if (s === 'chase') this.chase.snap();
  }

  update(dt: number, cam: PerspectiveCamera, sim: Simulation, views: ReadonlyMap<number, CarView>): Vector3 {
    this.time += dt;
    this.shotTime += dt;
    this.sinceSwitch += dt;
    if (this.hot && this.time > this.hot.until) this.hot = null;

    const standings = sim.standings();
    const leader = standings[0];
    // Кого показываем.
    let wanted = this.manualId ?? this.hot?.carId ?? leader?.id ?? -1;
    if (!views.has(wanted)) wanted = leader?.id ?? -1;
    if (wanted !== this.targetId) {
      // Смена лидера — не чаще раза в 5 с (кроме ручного выбора и горячих моментов).
      const urgent = this.manualId !== null || this.hot !== null || !views.has(this.targetId);
      if (urgent || this.sinceSwitch > 5) {
        this.targetId = wanted;
        this.sinceSwitch = 0;
        if (this.shot === 'chase') this.chase.snap();
      }
    }
    const view = views.get(this.targetId);

    if (this.forceOverview) this.setShot('overview');
    else if (this.winnerId !== null && views.has(this.winnerId) && this.manualId === null) this.setShot('winner');
    else if (sim.phase === 'grid' || sim.phase === 'countdown') this.setShot('orbit');
    else if (this.shot === 'orbit' || this.shot === 'overview') this.setShot('chase');

    if (this.shot === 'chase' && this.manualId === null && !this.hot) {
      this.sinceTv += dt;
      if (this.sinceTv > 16 && view && sim.phase === 'race') {
        // Телекамера: точка у трассы впереди цели.
        const path = sim.track.path;
        const s = view.car.s + 55;
        const side = path.curvatureAt(s) > 0 ? -1 : 1;
        this.tvPos.copy(path.pointAt(s, side * (path.widthAt(s) / 2 + sim.track.def.shoulder.width + 1.5)));
        this.tvPos.y += 2.2;
        this.setShot('tv');
        this.sinceTv = 0;
      }
    }
    if (this.shot === 'tv' && view) {
      const passed =
        sim.track.path.deltaS(sim.track.path.project(this.tvPos.x, this.tvPos.y, this.tvPos.z).s, view.car.s) > 18;
      if (passed || this.shotTime > 6 || this.manualId !== null || this.hot) this.setShot('chase');
    }

    switch (this.shot) {
      case 'orbit': {
        // Облёт стартовой решётки.
        const slot = sim.track.gridSlots(Math.max(1, sim.cars.length));
        const c = new Vector3();
        for (const sl of slot) c.add(sl.pos);
        c.multiplyScalar(1 / slot.length);
        this.orbitAngle += dt * 0.15;
        // Решётка вытянута вдоль трассы: радиус по её длине; камера низко — машины крупно.
        let len = 0;
        for (const sl of slot) len = Math.max(len, sl.pos.distanceTo(c));
        const r = 10 + len * 1.35;
        cam.position.set(c.x + Math.cos(this.orbitAngle) * r, c.y + 3 + r * 0.3, c.z + Math.sin(this.orbitAngle) * r);
        cam.lookAt(c.x, c.y - 1, c.z);
        // В лобби справа панель — сдвигаем кадр, чтобы решётка была левее центра.
        if (this.lobbyOffset) cam.translateX(r * 0.17);
        this.focus.copy(c);
        break;
      }
      case 'winner': {
        const wv = views.get(this.winnerId ?? -1);
        if (!wv) break;
        this.orbitAngle += dt * 0.3;
        const r = 8.5 * Math.sqrt(wv.car.phys.scale);
        const target = wv.pos;
        cam.position.set(
          target.x + Math.cos(this.orbitAngle) * r,
          target.y + 2.6,
          target.z + Math.sin(this.orbitAngle) * r,
        );
        // Смотрим выше машины — она в нижней части кадра, сверху экран подиума.
        cam.lookAt(target.x, target.y + 3.4, target.z);
        this.focus.copy(target);
        this.targetId = this.winnerId ?? this.targetId;
        break;
      }
      case 'overview': {
        const path = sim.track.path;
        let cx = 0;
        let cz = 0;
        let r = 0;
        for (const sm of path.samples) {
          cx += sm.pos.x;
          cz += sm.pos.z;
        }
        cx /= path.samples.length;
        cz /= path.samples.length;
        for (const sm of path.samples) r = Math.max(r, Math.hypot(sm.pos.x - cx, sm.pos.z - cz));
        cam.position.set(cx + r * 0.55, r * 0.95, cz + r * 1.05);
        cam.lookAt(cx, 0, cz);
        this.focus.set(cx, 0, cz);
        break;
      }
      case 'tv': {
        if (!view) break;
        spring(this.look, this.lookVel, view.pos, 9, dt);
        if (this.shotTime < dt * 1.5) this.look.copy(view.pos);
        cam.position.copy(this.tvPos);
        cam.lookAt(this.look);
        // Лёгкий зум: чем дальше машина, тем уже угол.
        const dist = this.tvPos.distanceTo(view.pos);
        cam.fov = Math.max(22, Math.min(55, 1400 / Math.max(10, dist)));
        cam.updateProjectionMatrix();
        this.focus.copy(view.pos);
        break;
      }
      case 'chase':
      default: {
        if (cam.fov !== 55) {
          cam.fov = 55;
          cam.updateProjectionMatrix();
        }
        if (!view) break;
        this.chase.update(dt, cam, view.pos, view.quat, view.car.phys.forwardSpeed(), view.car.phys.scale);
        this.focus.copy(view.pos);
        break;
      }
    }
    if (this.shot !== 'tv' && cam.fov !== 55) {
      cam.fov = 55;
      cam.updateProjectionMatrix();
    }
    return this.focus;
  }
}
