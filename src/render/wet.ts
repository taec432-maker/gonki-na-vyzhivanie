import type { MeshStandardMaterial } from 'three';

/**
 * Мокрый асфальт (раздел 2 ТЗ): темнее и глаже, в лужах почти зеркальный — отражает
 * небо и огни окружения (HDRI). Лужи — шум по мировым координатам, одинаковый каждый кадр.
 */
export function makeWet(mat: MeshStandardMaterial, amount: number): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, renderer) => {
    prev.call(mat, sh, renderer);
    sh.uniforms.wetAmount = { value: amount };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWetPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvWetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWetPos;
uniform float wetAmount;
float wetHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wetNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wetHash(i), wetHash(i + vec2(1.0, 0.0)), f.x), mix(wetHash(i + vec2(0.0, 1.0)), wetHash(i + vec2(1.0)), f.x), f.y);
}
float wetMask() {
  float n = wetNoise(vWetPos.xz * 0.09) * 0.65 + wetNoise(vWetPos.xz * 0.37) * 0.35;
  return wetAmount * mix(0.55, 1.0, smoothstep(0.5, 0.62, n));
}`,
      )
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.5, wetMask());')
      // В лужах вода сглаживает рельеф асфальта — отражение ровное, без «зерна».
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, smoothstep(0.6, 0.95, wetMask())));',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.04, wetMask() * 0.9);',
      );
  };
  // Стандартный ключ кэша — текст onBeforeCompile; после обёртки он у всех одинаковый,
  // поэтому в ключ входят исходный хук и сила намокания.
  const prevKey = prev.toString();
  mat.customProgramCacheKey = () => `wet${amount}|${prevKey}`;
  mat.envMapIntensity = 1 + amount * 0.6;
  mat.needsUpdate = true;
}
