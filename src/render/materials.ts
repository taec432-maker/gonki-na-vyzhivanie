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
  headlight: () =>
    cached(
      'headlight',
      () =>
        new MeshStandardMaterial({
          name: 'headlight',
          color: '#ffffff',
          emissive: '#fff4dc',
          emissiveIntensity: 2.2,
          roughness: 0.1,
        }),
    ),
  taillight: () =>
    cached(
      'taillight',
      () =>
        new MeshStandardMaterial({
          name: 'taillight',
          color: '#5a0000',
          emissive: '#ff1a10',
          emissiveIntensity: 1.6,
          roughness: 0.3,
        }),
    ),
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
