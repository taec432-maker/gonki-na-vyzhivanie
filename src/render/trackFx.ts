import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BREAKABLE_SIZE } from '../core/features';
import type { Simulation } from '../core/sim';
import { floorHeight } from '../physics/trackCollider';
import { headingOf } from '../tracks/track';
import type { BreakableType } from '../tracks/types';
import type { CarView } from './carView';

/**
 * Видимая часть особенностей трассы: сбиваемые препятствия (из тел физики),
 * порталы телепортов, стрелки ускорителей и свет фар ночью.
 */
const BILLBOARD_ADS = ['ГОНКИ НА ВЫЖИВАНИЕ', 'ШИНОМОНТАЖ 24', 'КОФЕ В ДОРОГУ', 'АВТОМОЙКА «ЛУЖА»', 'БЕНЗИН ДЁШЕВО'];

const adMaterials = new Map<number, MeshStandardMaterial>();

/** Материал рекламного щита №i (вымышленная реклама; на ногах — тёмный металл по краю текстуры). */
function adMaterial(i: number): MeshStandardMaterial {
  const k = i % BILLBOARD_ADS.length;
  let m = adMaterials.get(k);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const colors = ['#e63946', '#1d6fd8', '#f5b800', '#2fbf71', '#9b5de5'];
  ctx.fillStyle = colors[k] as string;
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 54px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const words = (BILLBOARD_ADS[k] as string).split(' ');
  const mid = Math.ceil(words.length / 2);
  ctx.fillText(words.slice(0, mid).join(' '), 256, 90);
  ctx.fillText(words.slice(mid).join(' '), 256, 170);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  m = new MeshStandardMaterial({ map: t, roughness: 0.6 });
  adMaterials.set(k, m);
  return m;
}

function breakableKind(type: BreakableType): { geo: BufferGeometry; mat: Material; colors?: string[] } {
  const sz = BREAKABLE_SIZE[type];
  switch (type) {
    case 'barrel':
      return {
        geo: new CylinderGeometry(sz.hx, sz.hx, sz.hy * 2, 16),
        mat: new MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.5 }),
        colors: ['#1d4fa3', '#b2221b', '#d6a514', '#2a6e3a'],
      };
    case 'cone': {
      const g = new ConeGeometry(sz.hx, sz.hy * 2, 16);
      return { geo: g, mat: new MeshStandardMaterial({ color: '#ff6a10', roughness: 0.5 }) };
    }
    case 'crate':
      return {
        geo: new BoxGeometry(sz.hx * 2, sz.hy * 2, sz.hz * 2),
        mat: new MeshStandardMaterial({ color: '#a0703f', roughness: 0.85 }),
      };
    case 'billboard': {
      // Щит на двух ногах; реклама — вымышленная (никаких настоящих марок), материал — у каждого щита свой.
      const board = new BoxGeometry(sz.hx * 2, sz.hy * 1.3, sz.hz * 2);
      board.translate(0, sz.hy * 0.35, 0);
      const parts = [board.toNonIndexed()];
      for (const x of [-sz.hx * 0.7, sz.hx * 0.7]) {
        const leg = new BoxGeometry(0.1, sz.hy * 0.8, 0.1);
        leg.translate(x, -sz.hy * 0.6, 0);
        parts.push(leg.toNonIndexed());
      }
      return { geo: mergeGeometries(parts) ?? board, mat: adMaterial(0) };
    }
  }
}

const PORTAL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const PORTAL_FRAG = /* glsl */ `
  uniform float time;
  uniform vec3 color;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    float swirl = sin(a * 5.0 + time * 4.0 - r * 9.0) * 0.5 + 0.5;
    float ring = smoothstep(1.0, 0.85, r) * (0.35 + 0.65 * swirl) * smoothstep(0.0, 0.5, r);
    gl_FragColor = vec4(color * (1.2 + swirl), ring * 0.85);
  }
`;
const BOOST_FRAG = /* glsl */ `
  uniform float time;
  varying vec2 vUv;
  void main() {
    // Шевроны «>>>» бегут вперёд.
    float v = fract(vUv.y * 6.0 - time * 1.6);
    float x = abs(vUv.x - 0.5) * 2.0;
    float chevron = step(abs(v - 0.5 - x * 0.35), 0.12);
    float edge = smoothstep(1.0, 0.8, x);
    gl_FragColor = vec4(vec3(0.2, 0.9, 1.0) * 2.0 * chevron, chevron * edge * 0.9);
  }
`;

export class TrackFxView {
  private readonly scene: Scene;
  private readonly group = new Group();
  private sim: Simulation | null = null;
  private breakMeshes = new Map<BreakableType, InstancedMesh>();
  /** Рекламные щиты — отдельными мешами (у каждого своя реклама). */
  private boards: { mesh: Mesh; id: number }[] = [];
  private readonly mats: ShaderMaterial[] = [];
  private beams: InstancedMesh | null = null;
  private time = 0;
  private readonly dummy = new Object3D();
  private readonly q = new Quaternion();

  constructor(scene: Scene) {
    this.scene = scene;
    this.group.name = 'track-fx';
    scene.add(this.group);
  }

  /** Новая гонка: построить препятствия, порталы, ускорители; ночью — свет фар. */
  bind(sim: Simulation, night: boolean): void {
    this.clear();
    this.sim = sim;
    const f = sim.features;
    const byType = new Map<BreakableType, number>();
    for (const b of f.breakables) {
      if (b.type === 'billboard') {
        const mesh = new Mesh(breakableKind('billboard').geo, adMaterial(b.id));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.boards.push({ mesh, id: b.id });
        this.group.add(mesh);
      } else byType.set(b.type, (byType.get(b.type) ?? 0) + 1);
    }
    for (const [type, count] of byType) {
      const k = breakableKind(type);
      const m = new InstancedMesh(k.geo, k.mat, count);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      if (k.colors) {
        let i = 0;
        for (const b of f.breakables)
          if (b.type === type) m.setColorAt(i++, new Color(k.colors[b.id % k.colors.length] as string));
      }
      this.breakMeshes.set(type, m);
      this.group.add(m);
    }
    const track = sim.track;
    for (const p of f.portals) {
      for (const [s, color] of [
        [p.fromS, '#b14bff'],
        [p.toS, '#2ee6ff'],
      ] as const) {
        const pos = track.path.pointAt(s, p.d);
        pos.y = floorHeight(track, s, p.d);
        const heading = headingOf(track.path.tangentAt(s));
        const R = p.halfWidth + 0.8;
        const mat = new ShaderMaterial({
          vertexShader: PORTAL_VERT,
          fragmentShader: PORTAL_FRAG,
          uniforms: { time: { value: 0 }, color: { value: new Color(color) } },
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: DoubleSide,
        });
        this.mats.push(mat);
        const disc = new Mesh(new PlaneGeometry(R * 2, R * 2), mat);
        disc.position.set(pos.x, pos.y + R * 0.9, pos.z);
        disc.rotation.y = -heading;
        const arch = new Mesh(
          new TorusGeometry(R, 0.18, 10, 40),
          new MeshStandardMaterial({ color: '#202028', emissive: color, emissiveIntensity: 2.5, metalness: 0.6 }),
        );
        arch.position.copy(disc.position);
        arch.rotation.y = -heading;
        this.group.add(disc, arch);
      }
    }
    for (const b of f.boosts) {
      const len = track.path.deltaS(b.fromS, b.toS);
      const mid = track.path.wrapS(b.fromS + len / 2);
      const pos = track.path.pointAt(mid, b.d);
      pos.y = floorHeight(track, mid, b.d) + 0.04;
      const mat = new ShaderMaterial({
        vertexShader: PORTAL_VERT,
        fragmentShader: BOOST_FRAG,
        uniforms: { time: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      });
      this.mats.push(mat);
      const geo = new PlaneGeometry(b.halfWidth * 2, len);
      geo.rotateX(-Math.PI / 2);
      const m = new Mesh(geo, mat);
      m.position.copy(pos);
      m.rotation.y = -headingOf(track.path.tangentAt(mid));
      m.renderOrder = 2;
      this.group.add(m);
    }
    if (night) this.beams = this.makeBeams();
  }

  private makeBeams(): InstancedMesh {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(32, 128, 4, 32, 90, 90);
    g.addColorStop(0, 'rgba(255,240,210,0.9)');
    g.addColorStop(0.5, 'rgba(255,235,200,0.35)');
    g.addColorStop(1, 'rgba(255,230,190,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(26, 128);
    ctx.lineTo(0, 0);
    ctx.lineTo(64, 0);
    ctx.lineTo(38, 128);
    ctx.closePath();
    ctx.fill();
    const geo = new PlaneGeometry(7, 16);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -8);
    const m = new InstancedMesh(
      geo,
      new MeshBasicMaterial({
        map: new CanvasTexture(c),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
      24,
    );
    m.frustumCulled = false;
    m.renderOrder = 1;
    this.group.add(m);
    return m;
  }

  update(dt: number, views: ReadonlyMap<number, CarView>): void {
    const sim = this.sim;
    if (!sim) return;
    this.time += dt;
    for (const m of this.mats) m.uniforms.time!.value = this.time;
    const counters = new Map<BreakableType, number>();
    const d = this.dummy;
    for (const b of sim.features.breakables) {
      if (b.type === 'billboard') {
        const board = this.boards.find((x) => x.id === b.id);
        if (!board) continue;
        const t = b.body.translation();
        const r = b.body.rotation();
        board.mesh.position.set(t.x, t.y, t.z);
        board.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        continue;
      }
      const mesh = this.breakMeshes.get(b.type);
      if (!mesh) continue;
      const i = counters.get(b.type) ?? 0;
      counters.set(b.type, i + 1);
      const t = b.body.translation();
      const r = b.body.rotation();
      d.position.set(t.x, t.y, t.z);
      d.quaternion.set(r.x, r.y, r.z, r.w);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    }
    for (const m of this.breakMeshes.values()) m.instanceMatrix.needsUpdate = true;
    if (this.beams) {
      let n = 0;
      for (const v of views.values()) {
        if (!v.model.root.visible || n >= 24) continue;
        d.position.copy(v.pos);
        const fwd = new Vector3(0, 0, -1).applyQuaternion(v.quat);
        d.position.addScaledVector(fwd, v.car.spec.dims.length / 2);
        d.position.y = v.pos.y - v.car.spec.wheelRadius - 0.2;
        this.q.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(-fwd.x, -fwd.z));
        d.quaternion.copy(this.q);
        d.scale.setScalar(v.car.phys.scale);
        d.updateMatrix();
        this.beams.setMatrixAt(n++, d.matrix);
      }
      d.scale.setScalar(1);
      this.beams.count = n;
      this.beams.instanceMatrix.needsUpdate = true;
    }
  }

  private clear(): void {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      const m = o as Mesh;
      m.geometry?.dispose();
    }
    for (const m of this.mats) m.dispose();
    this.mats.length = 0;
    this.breakMeshes.clear();
    this.boards = [];
    this.beams = null;
    this.sim = null;
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group);
  }
}
