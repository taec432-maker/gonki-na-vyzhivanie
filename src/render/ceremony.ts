import {
  BoxGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import type { Track } from '../tracks/track';
import { floorHeight } from '../physics/trackCollider';
import { headingOf } from '../tracks/track';

/**
 * Церемония победителя (этап 7 ТЗ): пьедестал на стартовой решётке,
 * три лучшие машины на ступенях, конфетти. Только картинка — симуляция не трогается.
 */
export interface PodiumSpot {
  pos: Vector3;
  quat: Quaternion;
}

const CONFETTI = 420;
const COLORS = ['#ffcc00', '#ff4f6d', '#4fd8ff', '#7dff6a', '#b48cff', '#ffffff'];

export class Ceremony {
  private readonly scene: Scene;
  private readonly group = new Group();
  private confetti: InstancedMesh | null = null;
  private readonly cPos = new Float32Array(CONFETTI * 3);
  private readonly cVel = new Float32Array(CONFETTI * 3);
  private readonly cRot = new Float32Array(CONFETTI * 3);
  private readonly dummy = new Object3D();
  private time = 0;
  active = false;
  /** Места 1, 2, 3: где стоят машины. */
  spots: PodiumSpot[] = [];
  readonly center = new Vector3();
  /** «Лицо» подиума: оттуда смотрит камера, туда смотрят машины. */
  readonly front = new Vector3();

  constructor(scene: Scene) {
    this.scene = scene;
    this.group.name = 'ceremony';
  }

  start(track: Track): void {
    this.stop();
    this.active = true;
    this.time = 0;
    // Пьедестал — на стартовой решётке в 30 м до линии старта (там ровно, нет декора,
    // а машины не из тройки на церемонии скрыты). Смотрит назад по трассе: камера стоит
    // ещё дальше от старта, и арка старта видна за подиумом, а не перекрывает его.
    // 2-е место слева, 1-е в центре, 3-е справа.
    const s = track.path.wrapS(track.startS - 30);
    const base = track.path.pointAt(s, 0);
    base.y = floorHeight(track, s, 0);
    const heading = headingOf(track.path.tangentAt(s));
    // Камера смотрит вдоль трассы (sin h, −cos h): её «право» — (cos h, sin h).
    const across = new Vector3(Math.cos(heading), 0, Math.sin(heading));
    // Машины — лицом к камере: курс h + 180°.
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -(heading + Math.PI));
    this.center.copy(base);
    this.front.set(-Math.sin(heading), 0, Math.cos(heading));
    const steps = [
      { place: 1, h: 1.4, off: 0, color: '#d4a62a' },
      { place: 2, h: 0.95, off: -5.6, color: '#b8bec6' },
      { place: 3, h: 0.6, off: 5.6, color: '#b8723a' },
    ];
    this.spots = [];
    for (const st of steps) {
      // Ступень уходит на 0,5 м в землю — на виражах не «висит» над асфальтом.
      const geo = new BoxGeometry(5.2, st.h + 0.5, 5.2);
      const m = new Mesh(geo, new MeshStandardMaterial({ color: st.color, metalness: 0.6, roughness: 0.35 }));
      const p = base.clone().addScaledVector(across, st.off);
      m.position.set(p.x, p.y + (st.h - 0.5) / 2, p.z);
      m.quaternion.copy(q);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      this.spots[st.place - 1] = { pos: new Vector3(p.x, p.y + st.h, p.z), quat: q.clone() };
    }
    // Конфетти: плоские кусочки, кружатся и падают.
    const mat = new MeshStandardMaterial({ color: '#ffffff', side: DoubleSide, roughness: 0.6, metalness: 0.2 });
    this.confetti = new InstancedMesh(new PlaneGeometry(0.16, 0.24), mat, CONFETTI);
    this.confetti.instanceMatrix.setUsage(DynamicDrawUsage);
    this.confetti.frustumCulled = false;
    const c = new Color();
    for (let i = 0; i < CONFETTI; i++) {
      this.confetti.setColorAt(i, c.set(COLORS[i % COLORS.length] as string));
      this.respawn(i, true);
    }
    this.group.add(this.confetti);
    this.scene.add(this.group);
  }

  private respawn(i: number, initial: boolean): void {
    const k = i * 3;
    this.cPos[k] = this.center.x + (Math.random() - 0.5) * 22;
    this.cPos[k + 1] = this.center.y + (initial ? 4 + Math.random() * 14 : 14 + Math.random() * 4);
    this.cPos[k + 2] = this.center.z + (Math.random() - 0.5) * 22;
    this.cVel[k] = (Math.random() - 0.5) * 1.2;
    this.cVel[k + 1] = -1.2 - Math.random() * 1.2;
    this.cVel[k + 2] = (Math.random() - 0.5) * 1.2;
    this.cRot[k] = Math.random() * 6;
    this.cRot[k + 1] = Math.random() * 6;
    this.cRot[k + 2] = 2 + Math.random() * 6;
  }

  update(dt: number): void {
    if (!this.active || !this.confetti) return;
    this.time += dt;
    const d = this.dummy;
    for (let i = 0; i < CONFETTI; i++) {
      const k = i * 3;
      this.cPos[k] = (this.cPos[k] as number) + ((this.cVel[k] as number) + Math.sin(this.time * 2 + i) * 0.6) * dt;
      this.cPos[k + 1] = (this.cPos[k + 1] as number) + (this.cVel[k + 1] as number) * dt;
      this.cPos[k + 2] = (this.cPos[k + 2] as number) + (this.cVel[k + 2] as number) * dt;
      if ((this.cPos[k + 1] as number) < this.center.y) this.respawn(i, false);
      const spin = this.time * (this.cRot[k + 2] as number);
      d.position.set(this.cPos[k] as number, this.cPos[k + 1] as number, this.cPos[k + 2] as number);
      d.rotation.set((this.cRot[k] as number) + spin, (this.cRot[k + 1] as number) + spin * 0.7, spin * 0.3);
      d.updateMatrix();
      this.confetti.setMatrixAt(i, d.matrix);
    }
    this.confetti.instanceMatrix.needsUpdate = true;
  }

  stop(): void {
    if (!this.active && this.group.children.length === 0) return;
    this.active = false;
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      const m = o as Mesh;
      m.geometry?.dispose();
      (m.material as MeshStandardMaterial | undefined)?.dispose();
    }
    this.confetti = null;
    this.spots = [];
    this.scene.remove(this.group);
  }
}
