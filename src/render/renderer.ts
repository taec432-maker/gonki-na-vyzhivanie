import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  FogExp2,
  HalfFloatType,
  HemisphereLight,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import {
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import type { LightingPreset } from './presets';
import { QUALITY, type QualityLevel, type QualitySettings } from './quality';

export interface FrameStats {
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
}

/**
 * Сцена, камера, свет, HDRI и пост-обработка (pmndrs/postprocessing):
 * bloom → тонемаппинг ACES → цветокоррекция → виньетка; SMAA/MSAA по качеству.
 */
export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(55, 16 / 9, 0.3, 2500);
  readonly sun = new DirectionalLight('#ffffff', 3);
  readonly hemi = new HemisphereLight('#ffffff', '#444444', 0.3);
  private composer!: EffectComposer;
  private pmrem: PMREMGenerator;
  private hdriCache = new Map<string, Texture>();
  private envCache = new Map<string, Texture>();
  quality: QualitySettings = QUALITY.high;
  /** Доп. множитель разрешения с ползунка панели (0.5..1). */
  resolutionScale = 1;
  private preset: LightingPreset | null = null;
  private bloom: BloomEffect | null = null;
  private hue: HueSaturationEffect | null = null;
  private bc: BrightnessContrastEffect | null = null;
  private readonly sunOffset = new Vector3();
  private readonly base: string;

  constructor(canvas: HTMLCanvasElement, base: string) {
    this.base = base;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.pmrem = new PMREMGenerator(this.renderer);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.buildComposer();
  }

  private buildComposer(): void {
    this.composer?.dispose();
    const q = this.quality;
    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType, multisampling: q.msaa });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = q.bloom
      ? new BloomEffect({
          intensity: 0.55,
          luminanceThreshold: 0.9,
          luminanceSmoothing: 0.2,
          mipmapBlur: true,
          radius: 0.7,
        })
      : null;
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.hue = new HueSaturationEffect({ saturation: 0 });
    this.bc = new BrightnessContrastEffect({ contrast: 0 });
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.45 });
    const effects = [...(this.bloom ? [this.bloom] : []), tone, this.bc, this.hue, vignette];
    this.composer.addPass(new EffectPass(this.camera, ...effects));
    if (q.msaa === 0) this.composer.addPass(new EffectPass(this.camera, new SMAAEffect()));
    if (this.preset) this.applyGrade(this.preset);
    this.resize();
  }

  setQuality(level: QualityLevel): void {
    if (this.quality.level === level) return;
    this.quality = QUALITY[level];
    this.sun.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.buildComposer();
  }

  setResolutionScale(k: number): void {
    this.resolutionScale = Math.max(0.4, Math.min(1, k));
    this.resize();
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const pr =
      Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio) *
      this.quality.renderScale *
      this.resolutionScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private async loadHdri(file: string): Promise<{ bg: Texture; env: Texture }> {
    let bg = this.hdriCache.get(file);
    let env = this.envCache.get(file);
    if (!bg || !env) {
      const tex = await new HDRLoader().loadAsync(`${this.base}assets/hdri/${file}`);
      tex.mapping = EquirectangularReflectionMapping;
      bg = tex;
      env = this.pmrem.fromEquirectangular(tex).texture;
      this.hdriCache.set(file, bg);
      this.envCache.set(file, env);
    }
    return { bg, env };
  }

  async applyPreset(p: LightingPreset): Promise<void> {
    const { bg, env } = await this.loadHdri(p.hdri);
    this.preset = p;
    this.scene.environment = env;
    this.scene.environmentIntensity = p.envIntensity;
    this.scene.background = bg;
    this.scene.backgroundIntensity = p.backgroundIntensity;
    this.scene.backgroundBlurriness = p.backgroundBlur;
    this.sun.color.set(p.sun.color);
    this.sun.intensity = p.sun.intensity;
    this.sunOffset
      .set(...p.sun.dir)
      .normalize()
      .multiplyScalar(120);
    this.hemi.color.set(p.hemi.sky);
    this.hemi.groundColor.set(p.hemi.ground);
    this.hemi.intensity = p.hemi.intensity;
    this.scene.fog = new FogExp2(new Color(p.fog.color), p.fog.density);
    this.renderer.toneMappingExposure = p.exposure;
    this.applyGrade(p);
  }

  private applyGrade(p: LightingPreset): void {
    if (this.hue) this.hue.saturation = p.grade.saturation;
    if (this.bc) {
      this.bc.contrast = p.grade.contrast;
      this.bc.brightness = p.grade.brightness;
    }
  }

  /** Тень от солнца следует за точкой интереса камеры. */
  updateSun(focus: Vector3, radius = 70): void {
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -radius;
    cam.right = cam.top = radius;
    cam.near = 1;
    cam.far = 400;
    cam.updateProjectionMatrix();
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(this.sunOffset);
    // Привязка к текселям — тень не «дрожит» при движении камеры.
    const texel = (radius * 2) / this.sun.shadow.mapSize.x;
    this.sun.position.x = Math.round(this.sun.position.x / texel) * texel;
    this.sun.position.z = Math.round(this.sun.position.z / texel) * texel;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
  }

  render(dt: number): FrameStats {
    this.renderer.info.reset();
    this.composer.render(dt);
    const i = this.renderer.info;
    return {
      drawCalls: i.render.calls,
      triangles: i.render.triangles,
      textures: i.memory.textures,
      geometries: i.memory.geometries,
    };
  }

  /** Тонемаппинг ACES делает пост-обработка; это нужно, если пост выключен. */
  static readonly fallbackToneMapping = ACESFilmicToneMapping;

  dispose(): void {
    this.composer.dispose();
    this.renderer.dispose();
  }
}
