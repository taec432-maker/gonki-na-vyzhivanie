import {
  AdditiveBlending,
  InstancedBufferAttribute,
  InstancedMesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';

/**
 * Погода по локации (раздел 9 ТЗ): дождь, снег, пыль — один InstancedMesh,
 * анимация целиком на GPU (капли «живут» в кубе вокруг камеры и бесконечно падают).
 */
export type WeatherKind = 'none' | 'rain' | 'snow' | 'dust';

const VERT = /* glsl */ `
  attribute vec4 seed;
  uniform float time;
  uniform vec3 center;
  uniform float box;
  uniform float speed;
  uniform float stretch;
  uniform float wobble;
  uniform vec3 wind;
  varying float vAlpha;
  void main() {
    vec3 p = seed.xyz * box;
    p.y = mod(p.y - time * speed * (0.8 + seed.w * 0.4), box);
    p.xz += wind.xz * time;
    p.x += sin(time * 1.3 + seed.w * 40.0) * wobble;
    p.z += cos(time * 1.1 + seed.w * 30.0) * wobble;
    // Куб вокруг камеры: координаты по модулю, чтобы частицы не кончались.
    vec3 rel = mod(p - center + box * 0.5, box) - box * 0.5;
    vec3 world = center + rel;
    // Билборд к камере, вытянутый вдоль падения.
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(0.0, 1.0, 0.0);
    world += camRight * position.x * 0.012 + up * position.y * stretch;
    // Дальние гаснут (край куба), самые ближние тоже — иначе «палки» перед объективом.
    vAlpha = (1.0 - smoothstep(box * 0.32, box * 0.5, length(rel))) * smoothstep(1.5, 5.0, length(rel));
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(color, opacity * vAlpha);
  }
`;

const PRESETS: Record<
  Exclude<WeatherKind, 'none'>,
  {
    count: number;
    box: number;
    speed: number;
    stretch: number;
    wobble: number;
    color: [number, number, number];
    opacity: number;
    size: number;
    additive: boolean;
  }
> = {
  rain: {
    count: 12000,
    box: 60,
    speed: 22,
    stretch: 0.7,
    wobble: 0,
    color: [0.7, 0.75, 0.85],
    opacity: 0.28,
    size: 1,
    additive: true,
  },
  snow: {
    count: 6000,
    box: 50,
    speed: 1.6,
    stretch: 0.06,
    wobble: 0.6,
    color: [1, 1, 1],
    opacity: 0.8,
    size: 6,
    additive: false,
  },
  dust: {
    count: 2500,
    box: 60,
    speed: 0.4,
    stretch: 0.05,
    wobble: 1.4,
    color: [0.85, 0.7, 0.5],
    opacity: 0.35,
    size: 4,
    additive: false,
  },
};

export class Weather {
  private mesh: InstancedMesh | null = null;
  private mat: ShaderMaterial | null = null;
  private readonly scene: Scene;
  private time = 0;
  kind: WeatherKind = 'none';
  /** Множитель количества (качество). */
  density = 1;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  set(kind: WeatherKind, density = this.density): void {
    this.density = density;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mat?.dispose();
      this.mesh = null;
    }
    this.kind = kind;
    if (kind === 'none') return;
    const p = PRESETS[kind];
    const count = Math.max(200, Math.round(p.count * density));
    const geo = new PlaneGeometry(p.size, 1);
    geo.translate(0, 0.5, 0);
    const seeds = new Float32Array(count * 4);
    let s = 1234567;
    const rnd = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = rnd() - 0.5;
      seeds[i * 4 + 1] = rnd();
      seeds[i * 4 + 2] = rnd() - 0.5;
      seeds[i * 4 + 3] = rnd();
    }
    geo.setAttribute('seed', new InstancedBufferAttribute(seeds, 4));
    this.mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        time: { value: 0 },
        center: { value: new Vector3() },
        box: { value: p.box },
        speed: { value: p.speed },
        stretch: { value: p.stretch },
        wobble: { value: p.wobble },
        wind: { value: new Vector3(kind === 'dust' ? 2 : 0.6, 0, kind === 'dust' ? 1 : 0.3) },
        color: { value: new Vector3(...p.color) },
        opacity: { value: p.opacity },
      },
      transparent: true,
      depthWrite: false,
      blending: p.additive ? AdditiveBlending : NormalBlending,
    });
    this.mesh = new InstancedMesh(geo, this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.scene.add(this.mesh);
  }

  update(dt: number, camera: PerspectiveCamera): void {
    if (!this.mat) return;
    this.time += dt;
    this.mat.uniforms.time!.value = this.time;
    (this.mat.uniforms.center!.value as Vector3).copy(camera.position);
  }
}
