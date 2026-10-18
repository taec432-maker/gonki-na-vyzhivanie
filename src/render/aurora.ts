import {
  AdditiveBlending,
  BackSide,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  type PerspectiveCamera,
  type Scene,
} from 'three';

/**
 * Северное сияние (зимний лес ночью, раздел 9 ТЗ): купол вокруг камеры, «занавеси»
 * из шума в шейдере, медленно колышутся. Один draw call, без текстур.
 */
const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  uniform float time;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    float h = vDir.y;
    if (h < 0.05) discard;
    float az = atan(vDir.z, vDir.x);
    // Занавеси: полосы по азимуту, волна по высоте.
    float wave = noise(vec2(az * 3.0 + time * 0.05, time * 0.08)) * 1.6;
    float band = noise(vec2(az * 9.0 + wave * 2.0, h * 1.5 - time * 0.12));
    float curtain = smoothstep(0.45, 0.95, band) * smoothstep(0.08, 0.3, h) * (1.0 - smoothstep(0.55, 0.85, h));
    vec3 green = vec3(0.15, 1.0, 0.55);
    vec3 violet = vec3(0.55, 0.25, 1.0);
    vec3 col = mix(green, violet, smoothstep(0.35, 0.75, h + band * 0.2));
    gl_FragColor = vec4(col * curtain * 1.4, curtain * 0.7);
  }
`;

export class Aurora {
  private mesh: Mesh | null = null;
  private mat: ShaderMaterial | null = null;
  private time = 0;
  private readonly scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  set(on: boolean): void {
    if (on === !!this.mesh) return;
    if (!on && this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mat?.dispose();
      this.mesh = null;
      return;
    }
    this.mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { time: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: BackSide,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(900, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.scene.add(this.mesh);
  }

  update(dt: number, camera: PerspectiveCamera): void {
    if (!this.mesh || !this.mat) return;
    this.time += dt;
    this.mat.uniforms.time!.value = this.time;
    this.mesh.position.copy(camera.position);
  }
}
