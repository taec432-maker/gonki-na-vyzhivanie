# Ассеты и лицензии

Только свободные лицензии (раздел 11 ТЗ, п. 6). Никаких брендов, логотипов, реальных марок машин.

## HDRI (освещение и небо) — `public/assets/hdri/`

Все — [Poly Haven](https://polyhaven.com) (бывш. HDRI Haven), лицензия **CC0** (общественное достояние). Копии взяты из репозитория [pmndrs/drei-assets](https://github.com/pmndrs/drei-assets/tree/master/hdri) (коммит `456060a`).

| Файл | Автор | Лицензия | Ссылка | Где используется |
|---|---|---|---|---|
| rooitou_park_1k.hdr | Greg Zaal | CC0 | https://polyhaven.com/a/rooitou_park | тестовый овал, день |
| potsdamer_platz_1k.hdr | Greg Zaal | CC0 | https://polyhaven.com/a/potsdamer_platz | порт, день |
| venice_sunset_1k.hdr | Greg Zaal | CC0 | https://polyhaven.com/a/venice_sunset | пустыня, закат |
| dikhololo_night_1k.hdr | Greg Zaal | CC0 | https://polyhaven.com/a/dikhololo_night | ночные варианты |
| kiara_1_dawn_1k.hdr | Greg Zaal | CC0 | https://polyhaven.com/a/kiara_1_dawn | серпантин, утро |
| immenstadter_horn_1k.hdr | Andreas Mischok | CC0 | https://polyhaven.com/a/immenstadter_horn | горы |
| forest_slope_1k.hdr | Greg Zaal | CC0 | https://polyhaven.com/a/forest_slope | лес |

## Текстуры

Асфальт, трава, песок, снег, грунт, бетон, лёд, металл, поребрики и шахматка старта — **генерируются кодом** (`src/render/textures.ts`, `src/render/trackMesh.ts`). Лицензия — как у кода проекта.

## Модели машин

Пока все машины — процедурные (`src/render/carModel.ts`, `src/render/carRecipes.ts`), свой код. В JSON машин стоит `placeholder: true`.

## Код сторонних проектов

| Что | Откуда | Лицензия | Как использовано |
|---|---|---|---|
| Идеи физики машины и ворот | [szabolevi98/racing](https://github.com/szabolevi98/racing) | AGPL-3.0 | только прочитано, код не копировался (см. docs/РЕШЕНИЯ.md) |
| Raycast-vehicle | [Rapier](https://rapier.rs) `@dimforge/rapier3d-compat` | Apache-2.0 | npm-зависимость |
| Three.js | three | MIT | npm-зависимость |
| Пост-обработка | postprocessing (pmndrs) | Zlib | npm-зависимость |
