import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Combat } from '../combat/combat';
import type { Simulation, SimCar } from '../core/sim';
import type { CarView } from './carView';
import { ParticleSystem } from './particles';

/**
 * Визуал боя и подарков: пламя нитро, щит, ракеты со шлейфом, масло, взрывы,
 * подсветка машины дарителя. Всё инстансингом — единицы draw calls.
 */
const SHIELD_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const SHIELD_FRAG = /* glsl */ `
  uniform float time;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    float pulse = 0.75 + 0.25 * sin(time * 6.0);
    gl_FragColor = vec4(vec3(0.25, 0.6, 1.0) * (f * 1.8 + 0.06) * pulse, 1.0);
  }
`;

function oilTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  // Неровная клякса.
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = 50 + Math.sin(a * 3) * 7 + Math.cos(a * 5) * 5;
    ctx.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  ctx.fill();
  return new CanvasTexture(c);
}

const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpQ = new Quaternion();
const up = new Vector3(0, 1, 0);

export class EffectsRenderer {
  readonly fire: ParticleSystem;
  readonly smoke: ParticleSystem;
  private readonly shields: InstancedMesh;
  private readonly shieldMat: ShaderMaterial;
  private readonly rockets: InstancedMesh;
  private readonly oil: InstancedMesh;
  private readonly rings: InstancedMesh;
  private readonly flash: PointLight;
  private flashLife = 0;
  private readonly dummy = new Object3D();
  private time = 0;
  /** Подсветка машин после подарка: id → секунд осталось, цвет. */
  private readonly highlight = new Map<number, { t: number; color: Color }>();
  private combat: Combat | null = null;
  private readonly unsub: (() => void)[] = [];
  /** Тряска камеры: сила, затухает. */
  shake = 0;

  constructor(scene: Scene) {
    this.fire = new ParticleSystem(scene, 3000, AdditiveBlending);
    this.smoke = new ParticleSystem(scene, 2500, NormalBlending);

    this.shieldMat = new ShaderMaterial({
      vertexShader: SHIELD_VERT,
      fragmentShader: SHIELD_FRAG,
      uniforms: { time: { value: 0 } },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    this.shields = new InstancedMesh(new SphereGeometry(1, 24, 16), this.shieldMat, 24);
    this.shields.count = 0;
    this.shields.frustumCulled = false;
    this.shields.instanceMatrix.setUsage(DynamicDrawUsage);
    scene.add(this.shields);

    const body = new CylinderGeometry(0.09, 0.09, 0.9, 10);
    body.rotateX(Math.PI / 2);
    const nose = new ConeGeometry(0.09, 0.28, 10);
    nose.rotateX(-Math.PI / 2);
    nose.translate(0, 0, -0.59);
    const fins = new PlaneGeometry(0.36, 0.2);
    fins.rotateX(Math.PI / 2);
    fins.translate(0, 0, 0.36);
    const rocketGeo = mergeGeometries([body.toNonIndexed(), nose.toNonIndexed(), fins.toNonIndexed()]);
    this.rockets = new InstancedMesh(
      rocketGeo ?? body,
      new MeshStandardMaterial({ color: '#d8dde3', metalness: 0.7, roughness: 0.35, emissive: '#331100' }),
      64,
    );
    this.rockets.count = 0;
    this.rockets.frustumCulled = false;
    this.rockets.castShadow = true;
    scene.add(this.rockets);

    const oilGeo = new PlaneGeometry(2, 2);
    oilGeo.rotateX(-Math.PI / 2);
    const oilTex = oilTexture();
    this.oil = new InstancedMesh(
      oilGeo,
      new MeshStandardMaterial({
        color: '#050505',
        roughness: 0.05,
        metalness: 0.4,
        alphaMap: oilTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        envMapIntensity: 1.6,
      }),
      64,
    );
    this.oil.count = 0;
    this.oil.frustumCulled = false;
    this.oil.receiveShadow = true;
    scene.add(this.oil);

    const ringGeo = new RingGeometry(0.75, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = new InstancedMesh(
      ringGeo,
      new MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: AdditiveBlending, depthWrite: false }),
      24,
    );
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    scene.add(this.rings);

    this.flash = new PointLight('#ffb366', 0, 40, 2);
    scene.add(this.flash);
  }

  /** Подписаться на события боя новой симуляции. */
  bind(sim: Simulation): void {
    for (const u of this.unsub) u();
    this.unsub.length = 0;
    this.combat = sim.combat;
    this.highlight.clear();
    this.fire.clear();
    this.smoke.clear();
    const ev = sim.combat.events;
    this.unsub.push(
      ev.on('impact', (e) => this.explosion(e.pos, e.kind === 'meteor' ? 1.6 : 1)),
      ev.on('oil-hit', (e) => this.splash(e.car.cur.p)),
      ev.on('applied', (e) => {
        if (e.meta.via === 'gift') this.highlightCar(e.car, '#ffd84a');
      }),
    );
  }

  highlightCar(car: SimCar, color: string, seconds = 2.2): void {
    this.highlight.set(car.id, { t: seconds, color: new Color(color) });
  }

  explosion(pos: Vector3, scale = 1): void {
    const f = this.fire;
    for (let i = 0, n = f.n(60 * scale); i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 0.9;
      const sp = 4 + Math.random() * 10 * scale;
      f.emit({
        x: pos.x,
        y: pos.y + 0.4,
        z: pos.z,
        vx: Math.cos(a) * Math.cos(e) * sp,
        vy: Math.sin(e) * sp + 2,
        vz: Math.sin(a) * Math.cos(e) * sp,
        life: 0.35 + Math.random() * 0.45,
        size0: 1.6 * scale,
        size1: 3.2 * scale,
        r0: 1,
        g0: 0.75,
        b0: 0.3,
        r1: 0.8,
        g1: 0.15,
        b1: 0.02,
        a0: 1,
        a1: 0,
        drag: 2.5,
        gravity: 1,
      });
    }
    // Искры.
    for (let i = 0, n = f.n(40 * scale); i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 8 + Math.random() * 14;
      f.emit({
        x: pos.x,
        y: pos.y + 0.5,
        z: pos.z,
        vx: Math.cos(a) * sp,
        vy: 3 + Math.random() * 8,
        vz: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.6,
        size0: 0.22,
        size1: 0.05,
        r0: 1,
        g0: 0.85,
        b0: 0.5,
        a1: 0.2,
        drag: 0.8,
        gravity: -14,
      });
    }
    const s = this.smoke;
    for (let i = 0, n = s.n(26 * scale); i < n; i++) {
      s.emit({
        x: pos.x + (Math.random() - 0.5) * 2,
        y: pos.y + 0.6,
        z: pos.z + (Math.random() - 0.5) * 2,
        vx: (Math.random() - 0.5) * 3,
        vy: 1.5 + Math.random() * 2.5,
        vz: (Math.random() - 0.5) * 3,
        life: 1.6 + Math.random() * 1.4,
        size0: 2 * scale,
        size1: 6 * scale,
        r0: 0.16,
        g0: 0.15,
        b0: 0.14,
        a0: 0.75,
        a1: 0,
        drag: 0.9,
        gravity: 0.6,
      });
    }
    this.flash.position.copy(pos).setY(pos.y + 2);
    this.flash.intensity = 120 * scale;
    this.flashLife = 0.25;
    this.shake = Math.min(1, this.shake + 0.5 * scale);
  }

  private splash(pos: Vector3): void {
    for (let i = 0, n = this.smoke.n(10); i < n; i++)
      this.smoke.emit({
        x: pos.x,
        y: pos.y - 0.2,
        z: pos.z,
        vx: (Math.random() - 0.5) * 5,
        vy: 1 + Math.random() * 2,
        vz: (Math.random() - 0.5) * 5,
        life: 0.6,
        size0: 0.5,
        size1: 1.2,
        r0: 0.04,
        g0: 0.04,
        b0: 0.05,
        a0: 0.9,
        a1: 0,
        drag: 2,
        gravity: -9,
      });
  }

  update(dt: number, camera: PerspectiveCamera, views: ReadonlyMap<number, CarView>, viewportH: number): void {
    this.time += dt;
    this.shieldMat.uniforms.time!.value = this.time;
    const combat = this.combat;
    let shieldCount = 0;
    let ringCount = 0;
    const d = this.dummy;
    for (const v of views.values()) {
      const car = v.car;
      if (!combat || !v.model.root.visible) continue;
      const k = car.phys.scale;
      tmpQ.copy(v.quat);
      // Нитро: пламя из выхлопа.
      if (combat.has(car, 'nitro')) {
        const back = tmpV.set(0, 0, 1).applyQuaternion(tmpQ);
        for (const side of [-0.3, 0.3]) {
          const ex = tmpV2
            .set(side * k, (car.spec.wheelRadius - 0.05) * k - 0.25, (car.spec.dims.length / 2 + 0.1) * k)
            .applyQuaternion(tmpQ)
            .add(v.pos);
          for (let i = 0, n = this.fire.n(3); i < n; i++)
            this.fire.emit({
              x: ex.x,
              y: ex.y,
              z: ex.z,
              vx: back.x * 9 + (Math.random() - 0.5),
              vy: back.y * 9 + Math.random() * 0.6,
              vz: back.z * 9 + (Math.random() - 0.5),
              life: 0.12 + Math.random() * 0.08,
              size0: 0.55 * k,
              size1: 0.15,
              r0: 0.5,
              g0: 0.75,
              b0: 1,
              r1: 1,
              g1: 0.45,
              b1: 0.1,
              a0: 1,
              a1: 0,
            });
        }
      }
      // Щит (и неуязвимость монстра): кокон.
      if (combat.has(car, 'shield') && shieldCount < 24) {
        d.position.copy(v.pos);
        d.quaternion.copy(tmpQ);
        d.scale.set(car.spec.dims.width * 0.85 * k, car.spec.dims.height * 1.1 * k, car.spec.dims.length * 0.66 * k);
        d.updateMatrix();
        this.shields.setMatrixAt(shieldCount++, d.matrix);
      }
      // Подсветка после подарка.
      const h = this.highlight.get(car.id);
      if (h) {
        h.t -= dt;
        if (h.t <= 0) this.highlight.delete(car.id);
        else if (ringCount < 24) {
          const pulse = 1 + 0.15 * Math.sin(this.time * 10);
          d.position.copy(v.pos).add(tmpV.set(0, -0.55 * k, 0));
          d.quaternion.identity();
          const r = (car.spec.dims.length * 0.62 + (2.2 - h.t) * 0.6) * k * pulse;
          d.scale.set(r, 1, r);
          d.updateMatrix();
          this.rings.setMatrixAt(ringCount, d.matrix);
          this.rings.setColorAt(ringCount, h.color.clone().multiplyScalar(Math.min(1, h.t)));
          ringCount++;
        }
      }
    }
    this.shields.count = shieldCount;
    this.shields.instanceMatrix.needsUpdate = true;
    this.rings.count = ringCount;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;

    // Ракеты и шлейф.
    let rc = 0;
    if (combat) {
      for (const p of combat.projectiles) {
        if (rc >= 64) break;
        d.position.copy(p.pos);
        d.quaternion.setFromUnitVectors(tmpV.set(0, 0, -1), tmpV2.copy(p.vel).normalize());
        d.scale.setScalar(p.kind === 'meteor' ? 4 : 1.4);
        d.updateMatrix();
        this.rockets.setMatrixAt(rc++, d.matrix);
        const back = tmpV2.copy(p.vel).normalize().multiplyScalar(-1);
        this.fire.emit({
          x: p.pos.x + back.x * 0.7,
          y: p.pos.y + back.y * 0.7,
          z: p.pos.z + back.z * 0.7,
          vx: back.x * 6,
          vy: back.y * 6,
          vz: back.z * 6,
          life: 0.15,
          size0: 0.7,
          size1: 0.2,
          r0: 1,
          g0: 0.7,
          b0: 0.3,
          a1: 0,
        });
        for (let i = 0, n = this.smoke.n(2); i < n; i++)
          this.smoke.emit({
            x: p.pos.x + back.x,
            y: p.pos.y + back.y,
            z: p.pos.z + back.z,
            vx: (Math.random() - 0.5) * 0.8,
            vy: 0.6,
            vz: (Math.random() - 0.5) * 0.8,
            life: 1.1,
            size0: 0.5,
            size1: 2.2,
            r0: 0.75,
            g0: 0.75,
            b0: 0.75,
            a0: 0.5,
            a1: 0,
            drag: 1.5,
          });
      }
    }
    this.rockets.count = rc;
    this.rockets.instanceMatrix.needsUpdate = true;

    // Масло.
    let oc = 0;
    if (combat) {
      const now = combat.sim.tick;
      for (const t of combat.traps) {
        if (t.kind !== 'oil' || oc >= 64) continue;
        const fade = Math.min(1, (t.until - now) / 60);
        d.position.copy(t.pos).setY(t.pos.y + 0.035);
        d.quaternion.setFromAxisAngle(up, t.id * 1.7);
        d.scale.set(t.radius * fade, 1, t.radius * 0.8 * fade);
        d.updateMatrix();
        this.oil.setMatrixAt(oc++, d.matrix);
      }
    }
    this.oil.count = oc;
    this.oil.instanceMatrix.needsUpdate = true;

    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flash.intensity = Math.max(0, this.flash.intensity * (1 - dt * 12));
      if (this.flashLife <= 0) this.flash.intensity = 0;
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.fire.update(dt, viewportH, camera.fov);
    this.smoke.update(dt, viewportH, camera.fov);
  }

  setDensity(k: number): void {
    this.fire.density = this.smoke.density = k;
  }
}
