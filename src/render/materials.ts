import { Color, MeshPhysicalMaterial, MeshStandardMaterial, type Material } from 'three';

/** Общие PBR-материалы машин (metal/roughness). Краска — своя на каждую машину. */
const cache = new Map<string, Material>();

function cached<T extends Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}

export const carMaterials = {
  glass: () =>
    cached(
      'glass',
      () =>
        new MeshPhysicalMaterial({
          name: 'glass',
          color: new Color('#0b0f14'),
          metalness: 0.2,
          roughness: 0.04,
          clearcoat: 1,
          clearcoatRoughness: 0.02,
          envMapIntensity: 1.4,
        }),
    ),
  trim: () =>
    cached('trim', () => new MeshStandardMaterial({ name: 'trim', color: '#141517', roughness: 0.55, metalness: 0.1 })),
  chrome: () =>
    cached(
      'chrome',
      () => new MeshStandardMaterial({ name: 'chrome', color: '#d8dbe0', roughness: 0.12, metalness: 1 }),
    ),
  rubber: () =>
    cached(
      'rubber',
      () => new MeshStandardMaterial({ name: 'rubber', color: '#161616', roughness: 0.92, metalness: 0 }),
    ),
  rim: () =>
    cached('rim', () => new MeshStandardMaterial({ name: 'rim', color: '#b9bec6', roughness: 0.28, metalness: 1 })),
  /** Фары и фонари одним материалом: цвет свечения — из цвета вершин. */
  lights: () =>
    cached('lights', () => {
      const m = new MeshStandardMaterial({
        name: 'lights',
        color: '#ffffff',
        emissive: '#ffffff',
        emissiveIntensity: 2,
        roughness: 0.25,
        vertexColors: true,
      });
      m.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          'vec3 totalEmissiveRadiance = emissive;',
          'vec3 totalEmissiveRadiance = emissive * vColor.rgb;',
        );
      };
      return m;
    }),
  /** Вафельный рожок фургона мороженщика. */
  waffle: () => cached('waffle', () => new MeshStandardMaterial({ name: 'waffle', color: '#c98b4a', roughness: 0.85 })),
  metalDark: () =>
    cached(
      'metalDark',
      () => new MeshStandardMaterial({ name: 'metalDark', color: '#3a3d42', roughness: 0.45, metalness: 0.85 }),
    ),
};

/** Автомобильная краска с лаком. */
export function paintMaterial(color: string): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    name: 'paint',
    color: new Color(color),
    metalness: 0.55,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.1,
  });
}
