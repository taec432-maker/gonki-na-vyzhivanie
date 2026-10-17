import { Matrix4, Uniform, Vector3, type PerspectiveCamera } from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

/**
 * Лёгкое размытие в движении от камеры (раздел 2 ТЗ): по глубине восстанавливаем
 * мировую точку, проецируем прошлой матрицей камеры и размываем вдоль сдвига.
 * Ближе ~10 м не размываем: машина в кадре едет вместе с камерой и должна быть чёткой.
 */
const FRAG = /* glsl */ `
uniform mat4 invViewProj;
uniform mat4 prevViewProj;
uniform float strength;
uniform vec3 camPos;
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 world = invViewProj * ndc;
  world /= world.w;
  vec4 prev = prevViewProj * world;
  prev /= prev.w;
  vec2 prevUv = prev.xy * 0.5 + 0.5;
  // Сдвиг считаем как для неподвижного мира. Машины рядом с камерой едут вместе с ней —
  // их не размываем (иначе «смазывается» сама машина в кадре); фон вдали — размываем.
  float near = smoothstep(9.0, 26.0, length(world.xyz - camPos));
  vec2 vel = (uv - prevUv) * strength * near;
  float len = length(vel);
  if (len > 0.04) vel *= 0.04 / len;
  vec4 acc = inputColor;
  for (int i = 1; i < 6; i++) {
    float t = float(i) / 6.0 - 0.5;
    acc += texture2D(inputBuffer, uv + vel * t);
  }
  outputColor = acc / 6.0;
}
`;

export class CameraMotionBlur extends Effect {
  private readonly prev = new Matrix4();
  private readonly cur = new Matrix4();
  private first = true;
  private readonly strength: number;

  constructor(strength = 0.55) {
    super('CameraMotionBlur', FRAG, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['invViewProj', new Uniform(new Matrix4())],
        ['prevViewProj', new Uniform(new Matrix4())],
        ['strength', new Uniform(strength)],
        ['camPos', new Uniform(new Vector3())],
      ]),
    });
    this.strength = strength;
  }

  /**
   * Вызывать каждый кадр до рендера. Сила — «как при 60 к/с»: на медленном кадре
   * сдвиг камеры больше, и без поправки всё смазывалось бы сильнее.
   */
  updateCamera(camera: PerspectiveCamera, dt: number): void {
    (this.uniforms.get('strength') as Uniform<number>).value = (this.strength * (1 / 60)) / Math.max(dt, 1 / 240);
    camera.updateMatrixWorld();
    (this.uniforms.get('camPos') as Uniform<Vector3>).value.setFromMatrixPosition(camera.matrixWorld);
    this.cur.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (this.first) {
      this.prev.copy(this.cur);
      this.first = false;
    }
    (this.uniforms.get('prevViewProj') as Uniform<Matrix4>).value.copy(this.prev);
    (this.uniforms.get('invViewProj') as Uniform<Matrix4>).value.copy(this.cur).invert();
    this.prev.copy(this.cur);
  }

  /** Резкая смена кадра (переключение камеры) — без размытия. */
  cut(): void {
    this.first = true;
  }
}
