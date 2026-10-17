// Подготовка моделей машин (этап 5). Запускается вручную, не входит в сборку игры.
// Нужны пакеты (ставить во временную папку, не в проект):
//   npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@1 sharp
// Порядок: node 1-clean-carconcept.mjs CarConcept.glb clean.glb && node 2-pack.mjs clean.glb public/assets/models/supercar.glb
// Шаг 2: стекло без transmission, группы body/hood/wheel_XX, слияние по материалу, упрощение, текстуры ≤1K webp.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import {
  dedup,
  prune,
  weld,
  quantize,
  reorder,
  flatten,
  join,
  simplify,
  textureCompress,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const [src, out] = process.argv.slice(2);
const doc = await io.read(src);
const root = doc.getRoot();
const scene = root.listScenes()[0];
for (const m of root.listMaterials()) {
  const tr = m.getExtension('KHR_materials_transmission');
  if (tr) {
    m.setExtension('KHR_materials_transmission', null);
    m.setAlphaMode('BLEND');
    m.setBaseColorFactor([0.03, 0.04, 0.05, 0.42]);
    m.setRoughnessFactor(0.02);
    m.setMetallicFactor(0);
  }
}
for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_materials_transmission') ext.dispose();
// Логотипы (раздел 11 ТЗ — никаких логотипов): в исходнике знак Khronos светится на суппортах
// (emissive-текстура) и выдавлен на боковине шин (цвет и карта нормалей).
for (const m of root.listMaterials()) {
  if (m.getEmissiveTexture()) {
    m.setEmissiveTexture(null);
    m.setEmissiveFactor([0, 0, 0]);
  }
  if (m.getName() === 'Tireside') {
    m.setBaseColorTexture(null);
    m.setBaseColorFactor([0.013, 0.013, 0.013, 1]);
    const nt = m.getNormalTexture();
    if (nt) {
      const img = sharp(Buffer.from(nt.getImage()));
      const { data, info } = await img.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
      // Плоская нормаль (128,128,255) поверх надписей-логотипов (доли размера текстуры).
      const rects = [
        [0.01, 0.33, 0.093, 0.645],
        [0.932, 0.41, 0.992, 0.605],
      ];
      for (const [x0, y0, x1, y1] of rects)
        for (let y = Math.floor(y0 * info.height); y < y1 * info.height; y++)
          for (let x = Math.floor(x0 * info.width); x < x1 * info.width; x++) {
            const i = (y * info.width + x) * 4;
            data[i] = 128;
            data[i + 1] = 128;
            data[i + 2] = 255;
          }
      const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .png()
        .toBuffer();
      nt.setImage(new Uint8Array(png)).setMimeType('image/png');
    }
  }
}
// Похожие материалы — в один (меньше draw calls): салон, резина.
const byName = new Map(root.listMaterials().map((m) => [m.getName(), m]));
const mergeInto = {
  'Interior 1': ['Interior 2', 'Interior 3 Carmine', 'Dashboard', 'Panel Sides', ''],
  Tiretread: ['Rim1'],
};
for (const [target, list] of Object.entries(mergeInto)) {
  const t = byName.get(target);
  for (const name of list) {
    const m = byName.get(name);
    if (!m || !t) continue;
    for (const prim of root.listMeshes().flatMap((x) => x.listPrimitives()))
      if (prim.getMaterial() === m) prim.setMaterial(t);
  }
}
// Кому принадлежит меш-узел: колесо, капот или кузов.
const owner = new Map();
const mark = (n, tag) => {
  owner.set(n, tag);
  for (const c of n.listChildren()) mark(c, tag);
};
const walk = (n) => {
  const nm = n.getName();
  const w = /^wheel_(FL|FR|RL|RR)/.exec(nm);
  // Задние колёса не поворачивают и крутятся одинаково — один узел на ось.
  if (w) return mark(n, w[1][0] === 'R' ? 'wheels_R' : 'wheel_' + w[1]);
  if (nm === 'BodyHood') return mark(n, 'hood');
  owner.set(n, 'body');
  for (const c of n.listChildren()) walk(c);
};
for (const n of scene.listChildren()) walk(n);
await doc.transform(flatten());
const groups = {};
for (const tag of ['body', 'hood', 'wheel_FL', 'wheel_FR', 'wheels_R']) {
  groups[tag] = doc.createNode(tag);
  scene.addChild(groups[tag]);
}
for (const n of [...scene.listChildren()]) {
  if (Object.values(groups).includes(n)) continue;
  if (!n.getMesh()) {
    n.dispose();
    continue;
  }
  const tag = owner.get(n) ?? 'body';
  scene.removeChild(n);
  groups[tag].addChild(n);
}
await doc.transform(
  dedup(),
  prune(),
  weld(),
  join({ keepNamed: false, keepMeshes: false }),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.35, error: 0.0008 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 88 }),
  prune(),
  reorder({ encoder: MeshoptEncoder }),
  quantize(),
);
doc
  .createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(out, doc);
const fs = await import('node:fs');
console.info('written', out, (fs.statSync(out).size / 1024).toFixed(0), 'KB');
for (const g of scene.listChildren())
  console.info(
    g.getName(),
    g.listChildren().length,
    'nodes',
    g.listChildren().reduce((a, c) => a + (c.getMesh()?.listPrimitives().length ?? 0), 0),
    'prims',
  );
let tris = 0;
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
console.info('tris', tris);
