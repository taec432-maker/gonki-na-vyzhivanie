import {
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  FogExp2,
  HalfFloatType,
  HemisphereLight,
  Matrix4,
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
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { GradeEffect } from './grade';
import { CameraMotionBlur } from './motionBlur';
import type { LightingPreset } from './presets';
import { QUALITY, type QualityLevel, type QualitySettings } from './quality';

const ORIGIN = new Vector3();
const UP = new Vector3(0, 1, 0);

export interface FrameStats {
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
}

/**
 * Сцена, камера, свет, HDRI и пост-обработка (pmndrs/postprocessing):
 * AO (N8AO) → размытие в движении → bloom → тонемаппинг ACES → цветокоррекция локации →
 * виньетка; MSAA или SMAA. Тень солнца — одна карта, вписанная в видимую часть трассы.
 * Что включено — решает переключатель качества (quality.ts).
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
  preset: LightingPreset | null = null;
  private bloom: BloomEffect | null = null;
  private grade: GradeEffect | null = null;
  private ao: N8AOPostPass | null = null;
  private blur: CameraMotionBlur | null = null;
  private readonly sunOffset = new Vector3();
  private readonly sunCenter = new Vector3();
  private readonly sunFwd = new Vector3();
  private readonly sunLs = new Vector3();
  private readonly sunInv = new Matrix4();
  private readonly sunRot = new Matrix4();
  private readonly base: string;
  /** Выключенные части картинки (профиль кадра): ao, blur, bloom. */
  readonly off = new Set<string>();

  constructor(canvas: HTMLCanvasElement, base: string, off: readonly string[] = []) {
    this.base = base;
    for (const o of off) this.off.add(o);
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
    this.sun.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.buildComposer();
  }

  private buildComposer(): void {
    this.composer?.dispose();
    const q = this.quality;
    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType, multisampling: q.msaa });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = null;
    if (q.ao && !this.off.has('ao')) {
      const ao = new N8AOPostPass(this.scene, this.camera, 1920, 1080);
      ao.autoDetectTransparency = false;
      ao.configuration.transparencyAware = false;
      ao.configuration.aoRadius = 2.2;
      ao.configuration.distanceFalloff = 1.2;
      ao.configuration.intensity = 2.4;
      ao.configuration.halfRes = q.aoHalfRes;
      ao.configuration.depthAwareUpsampling = true;
      ao.configuration.gammaCorrection = false;
      ao.setQualityMode(q.aoHalfRes ? 'Low' : 'Medium');
      this.composer.addPass(ao);
      this.ao = ao;
    }
    this.blur = q.motionBlur && !this.off.has('blur') ? new CameraMotionBlur(0.5) : null;
    if (this.blur) this.composer.addPass(new EffectPass(this.camera, this.blur));
    this.bloom =
      q.bloom && !this.off.has('bloom')
        ? new BloomEffect({
            intensity: 0.55,
            luminanceThreshold: 0.9,
            luminanceSmoothing: 0.2,
            mipmapBlur: true,
            radius: 0.7,
          })
        : null;
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.grade = new GradeEffect();
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.45 });
    const effects = [...(this.bloom ? [this.bloom] : []), tone, this.grade, vignette];
    this.composer.addPass(new EffectPass(this.camera, ...effects));
    if (q.msaa === 0) this.composer.addPass(new EffectPass(this.camera, new SMAAEffect()));
    if (this.preset) this.grade.apply(this.preset.grade);
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
      .multiplyScalar(200);
    this.hemi.color.set(p.hemi.sky);
    this.hemi.groundColor.set(p.hemi.ground);
    this.hemi.intensity = p.hemi.intensity;
    this.scene.fog = new FogExp2(new Color(p.fog.color), p.fog.density);
    this.renderer.toneMappingExposure = p.exposure;
    this.grade?.apply(p.grade);
  }

  /**
   * Тень солнца — одна карта высокого разрешения, вписанная в видимую часть трассы:
   * квадрат вокруг точки впереди камеры (на «Высоком» 4096 на ~180 м — 4,4 см на тексель).
   * Привязка к текселям — тень не «дрожит» при движении камеры.
   */
  updateSun(focus: Vector3, overview = false): void {
    const radius = overview ? 220 : this.quality.shadowRadius;
    const center = this.sunCenter;
    if (overview) center.copy(focus);
    else {
      const fwd = this.camera.getWorldDirection(this.sunFwd).setY(0).normalize();
      // Центр — между машиной в кадре и точкой впереди камеры: тени и у машины, и вдали.
      center
        .copy(this.camera.position)
        .addScaledVector(fwd, radius * 0.55)
        .lerp(focus, 0.35);
    }
    const cam = this.sun.shadow.camera;
    if (cam.right !== radius) {
      cam.left = cam.bottom = -radius;
      cam.right = cam.top = radius;
      cam.near = 1;
      cam.far = 500;
      cam.updateProjectionMatrix();
    }
    const texel = (radius * 2) / this.sun.shadow.mapSize.x;
    // Округление в системе света: сдвиг ровно на целые тексели вдоль осей карты.
    const rot = this.sunRot.lookAt(this.sunOffset, ORIGIN, UP);
    const ls = this.sunLs.copy(center).applyMatrix4(this.sunInv.copy(rot).transpose());
    ls.x = Math.round(ls.x / texel) * texel;
    ls.y = Math.round(ls.y / texel) * texel;
    ls.applyMatrix4(rot);
    this.sun.target.position.copy(ls);
    this.sun.position.copy(ls).add(this.sunOffset);
  }

  /** Что сейчас включено в картинке (для статуса панели и профиля кадра). */
  get features(): string[] {
    const q = this.quality;
    return [
      `тени ${q.shadowSize} на ${q.shadowRadius * 2} м`,
      ...(this.ao ? [q.aoHalfRes ? 'AO ½' : 'AO'] : []),
      ...(this.blur ? ['motion blur'] : []),
      ...(this.bloom ? ['bloom'] : []),
      q.msaa ? `MSAA×${q.msaa}` : 'SMAA',
    ];
  }

  /** Резкая смена плана камеры: без размытия «перелёта». */
  cut(): void {
    this.blur?.cut();
  }

  render(dt: number): FrameStats {
    this.renderer.info.reset();
    this.blur?.updateCamera(this.camera, dt);
    this.composer.render(dt);
    const i = this.renderer.info;
    return {
      drawCalls: i.render.calls,
      triangles: i.render.triangles,
      textures: i.memory.textures,
      geometries: i.memory.geometries,
    };
  }

  dispose(): void {
    this.composer.dispose();
    this.renderer.dispose();
  }
}
