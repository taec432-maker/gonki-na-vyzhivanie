// Подготовка моделей машин (этап 5). Запускается вручную, не входит в сборку игры.
// Нужны пакеты (ставить во временную папку, не в проект):
//   npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@1 sharp
// Порядок: node 1-clean-carconcept.mjs CarConcept.glb clean.glb && node 2-pack.mjs clean.glb public/assets/models/supercar.glb
// Подготовка CarConcept: убрать логотипы и варианты материалов, переименовать колёса, сжать meshopt.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize, reorder, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const [src, out] = process.argv.slice(2);
const doc = await io.read(src);
const root = doc.getRoot();
const drop = /License Plate|SteeringEmblem|Floormat|Pedal|InteriorCage|Engine/i;
for (const n of root.listNodes()) {
  if (drop.test(n.getName())) n.dispose();
}
const rename = {
  WheelFrontL: 'wheel_FL_src',
  WheelFrontR: 'wheel_FR_src',
  WheelRearL: 'wheel_RL_src',
  WheelRearR: 'wheel_RR_src',
};
for (const n of root.listNodes()) if (rename[n.getName()]) n.setName(rename[n.getName()]);
// Варианты материалов не нужны: оставляем материал по умолчанию.
for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_materials_variants') ext.dispose();
await doc.transform(dedup(), prune(), weld(), resample(), reorder({ encoder: MeshoptEncoder }), quantize());
doc
  .createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(out, doc);
const fs = await import('node:fs');
console.info('written', out, (fs.statSync(out).size / 1024).toFixed(0), 'KB');
console.info(
  'materials',
  root
    .listMaterials()
    .map((m) => m.getName())
    .join(', '),
);
