import type { BufferGeometry, InstancedMesh, Material, Object3D, Texture } from 'three';

/**
 * Освободить всё, что объект занял в видеокарте: геометрию, инстансы, материалы и их текстуры.
 * Нужно при смене трассы: иначе рендерер держит старые буферы, и за часы эфира память растёт.
 * Общие (кэшированные) геометрии и текстуры освобождать безопасно — three.js загрузит их
 * в видеокарту заново, если они снова понадобятся.
 */
export function disposeObject(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((o) => {
    const m = o as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
      isInstancedMesh?: boolean;
    };
    if (m.geometry) geometries.add(m.geometry);
    if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat);
    if (m.isInstancedMesh) (m as unknown as InstancedMesh).dispose();
  });
  for (const g of geometries) g.dispose();
  for (const mat of materials) {
    for (const v of Object.values(mat)) if ((v as Texture | null)?.isTexture) (v as Texture).dispose();
    const uniforms = (mat as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms;
    if (uniforms)
      for (const u of Object.values(uniforms))
        if ((u.value as Texture | null)?.isTexture) (u.value as Texture).dispose();
    mat.dispose();
  }
}
