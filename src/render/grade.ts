import { Color, Uniform, Vector3 } from 'three';
import { BlendFunction, Effect } from 'postprocessing';

/**
 * Цветокоррекция под локацию (раздел 2 ТЗ): оттенок теней и светов (split-toning),
 * насыщенность, контраст вокруг серого 0,18, экспозиция. Стоит после тонемаппинга.
 */
const FRAG = /* glsl */ `
uniform vec3 shadows;
uniform vec3 highlights;
uniform float saturation;
uniform float contrast;
uniform float brightness;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(shadows, highlights, smoothstep(0.05, 0.75, l));
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c = (c - 0.45) * contrast + 0.45 + brightness;
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`;

export interface GradeSettings {
  /** Оттенок теней и светов (hex; яркость не меняется, #ffffff — без оттенка). */
  shadows: string;
  highlights: string;
  /** 1 — без изменений. */
  saturation: number;
  contrast: number;
  brightness: number;
}

export class GradeEffect extends Effect {
  constructor() {
    super('Grade', FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['shadows', new Uniform(new Vector3(1, 1, 1))],
        ['highlights', new Uniform(new Vector3(1, 1, 1))],
        ['saturation', new Uniform(1)],
        ['contrast', new Uniform(1)],
        ['brightness', new Uniform(0)],
      ]),
    });
  }

  apply(g: GradeSettings): void {
    const set = (name: string, hex: string): void => {
      const c = new Color(hex);
      (this.uniforms.get(name) as Uniform<Vector3>).value
        .set(c.r, c.g, c.b)
        .multiplyScalar(1 / Math.max(0.001, 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b));
    };
    set('shadows', g.shadows);
    set('highlights', g.highlights);
    (this.uniforms.get('saturation') as Uniform<number>).value = g.saturation;
    (this.uniforms.get('contrast') as Uniform<number>).value = g.contrast;
    (this.uniforms.get('brightness') as Uniform<number>).value = g.brightness;
  }
}
