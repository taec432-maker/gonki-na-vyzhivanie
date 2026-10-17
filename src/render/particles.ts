import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DynamicDrawUsage,
  NormalBlending,
  Points,
  ShaderMaterial,
  type Blending,
  type Scene,
  type Texture,
} from 'three';

/**
 * Частицы на CPU + один Points на систему (один draw call): огонь, искры, дым, пыль.
 * Не симуляция (не влияет на гонку) — поэтому без seed; в кадре — только отрисовка.
 */
export interface EmitOptions {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Жизнь, с. */
  life: number;
  size0: number;
  size1: number;
  /** Цвет в начале и в конце жизни (RGB 0..1) и непрозрачность. */
  r0: number;
  g0: number;
  b0: number;
  r1?: number;
  g1?: number;
  b1?: number;
  a0?: number;
  a1?: number;
  /** Затухание скорости, 1/с. */
  drag?: number;
  /** Ускорение по Y (м/с²): дым вверх, искры вниз. */
  gravity?: number;
}

let softTex: Texture | null = null;
function softTexture(): Texture {
  if (softTex) return softTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  softTex = new CanvasTexture(c);
  return softTex;
}

const VERT = /* glsl */ `
  attribute float size;
  attribute vec4 rgba;
  varying vec4 vColor;
  uniform float scale;
  void main() {
    vColor = rgba;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D map;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
    if (gl_FragColor.a < 0.004) discard;
  }
`;

export class ParticleSystem {
  readonly points: Points;
  private readonly cap: number;
  private count = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly sizes: Float32Array;
  private readonly cols: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly outPos: Float32Array;
  private readonly outSize: Float32Array;
  private readonly outCol: Float32Array;
  private readonly geo: BufferGeometry;
  private readonly mat: ShaderMaterial;
  /** Множитель числа частиц (качество). */
  density = 1;

  constructor(scene: Scene, capacity: number, blending: Blending = AdditiveBlending) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.sizes = new Float32Array(capacity * 2);
    this.cols = new Float32Array(capacity * 8);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.outPos = new Float32Array(capacity * 3);
    this.outSize = new Float32Array(capacity);
    this.outCol = new Float32Array(capacity * 4);
    this.geo = new BufferGeometry();
    const pa = new BufferAttribute(this.outPos, 3).setUsage(DynamicDrawUsage);
    const sa = new BufferAttribute(this.outSize, 1).setUsage(DynamicDrawUsage);
    const ca = new BufferAttribute(this.outCol, 4).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('position', pa);
    this.geo.setAttribute('size', sa);
    this.geo.setAttribute('rgba', ca);
    this.geo.setDrawRange(0, 0);
    this.mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { map: { value: softTexture() }, scale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === NormalBlending ? 2 : 3;
    scene.add(this.points);
  }

  emit(o: EmitOptions): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = o.x;
    this.pos[i3 + 1] = o.y;
    this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx ?? 0;
    this.vel[i3 + 1] = o.vy ?? 0;
    this.vel[i3 + 2] = o.vz ?? 0;
    this.age[i] = 0;
    this.life[i] = o.life;
    this.sizes[i * 2] = o.size0;
    this.sizes[i * 2 + 1] = o.size1;
    const c = i * 8;
    this.cols[c] = o.r0;
    this.cols[c + 1] = o.g0;
    this.cols[c + 2] = o.b0;
    this.cols[c + 3] = o.a0 ?? 1;
    this.cols[c + 4] = o.r1 ?? o.r0;
    this.cols[c + 5] = o.g1 ?? o.g0;
    this.cols[c + 6] = o.b1 ?? o.b0;
    this.cols[c + 7] = o.a1 ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.grav[i] = o.gravity ?? 0;
  }

  /** Сколько частиц выпустить с учётом качества (дробная часть — вероятностно). */
  n(base: number): number {
    const v = base * this.density;
    const whole = Math.floor(v);
    return whole + (Math.random() < v - whole ? 1 : 0);
  }

  update(dt: number, viewportHeight: number, fovDeg: number): void {
    // Размер частицы в пикселях: size(м) × высота экрана / (2·tan(fov/2)).
    this.mat.uniforms.scale!.value = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.age[i] = (this.age[i] as number) + dt;
      if ((this.age[i] as number) >= (this.life[i] as number)) {
        // Удаление: на место умершей — последняя живая.
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const i3 = i * 3;
      const d = Math.exp(-(this.drag[i] as number) * dt);
      this.vel[i3] = (this.vel[i3] as number) * d;
      this.vel[i3 + 1] = (this.vel[i3 + 1] as number) * d + (this.grav[i] as number) * dt;
      this.vel[i3 + 2] = (this.vel[i3 + 2] as number) * d;
      this.pos[i3] = (this.pos[i3] as number) + (this.vel[i3] as number) * dt;
      this.pos[i3 + 1] = (this.pos[i3 + 1] as number) + (this.vel[i3 + 1] as number) * dt;
      this.pos[i3 + 2] = (this.pos[i3 + 2] as number) + (this.vel[i3 + 2] as number) * dt;
    }
    this.count = n;
    for (let i = 0; i < n; i++) {
      const t = (this.age[i] as number) / (this.life[i] as number);
      const i3 = i * 3;
      this.outPos[i3] = this.pos[i3] as number;
      this.outPos[i3 + 1] = this.pos[i3 + 1] as number;
      this.outPos[i3 + 2] = this.pos[i3 + 2] as number;
      this.outSize[i] =
        (this.sizes[i * 2] as number) + ((this.sizes[i * 2 + 1] as number) - (this.sizes[i * 2] as number)) * t;
      const c = i * 8;
      const o = i * 4;
      for (let k = 0; k < 4; k++)
        this.outCol[o + k] =
          (this.cols[c + k] as number) + ((this.cols[c + 4 + k] as number) - (this.cols[c + k] as number)) * t;
    }
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'size', 'rgba']) {
      const a = this.geo.getAttribute(name) as BufferAttribute;
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  private copy(from: number, to: number): void {
    if (from === to) return;
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k] as number;
      this.vel[to * 3 + k] = this.vel[from * 3 + k] as number;
    }
    this.age[to] = this.age[from] as number;
    this.life[to] = this.life[from] as number;
    this.sizes[to * 2] = this.sizes[from * 2] as number;
    this.sizes[to * 2 + 1] = this.sizes[from * 2 + 1] as number;
    for (let k = 0; k < 8; k++) this.cols[to * 8 + k] = this.cols[from * 8 + k] as number;
    this.drag[to] = this.drag[from] as number;
    this.grav[to] = this.grav[from] as number;
  }

  get alive(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }
}

export { AdditiveBlending, NormalBlending };
