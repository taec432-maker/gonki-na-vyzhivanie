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

| Файл | Что | Автор | Лицензия | Откуда | Изменения |
|---|---|---|---|---|---|
| public/assets/models/supercar.glb | «Суперкар» (машина №3, редкая) | Eric Chadwick, модель «Car Concept» на основе работы Darmstadt Graphics Group | **CC-BY 4.0** (нужно указывать автора — указано здесь) | [KhronosGroup/glTF-Sample-Assets — CarConcept](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept) | удалены **логотипы Khronos и 3D Commerce** (номерные знаки, эмблема на руле, светящийся знак на суппортах, надписи на боковинах шин), коврики, педали, каркас и двигатель; убраны варианты материалов; стекло без «transmission» (дорого); детали слиты по материалу, упрощение сетки до ~82 тыс. треугольников, текстуры ≤ 1024 px (WebP), сжатие Meshopt — 1,3 МБ. Скрипты: `scripts/models/` |

Логотипов и названий марок в модели нет: это концепт-кар, не реальная марка; логотипы из исходника (лицензия CC-BY их не покрывает) вырезаны — см. скрипт `scripts/models/2-pack.mjs`.

Остальные машины — процедурные (`src/render/carModel.ts`, `src/render/carRecipes.ts`), свой код. В их JSON стоит `placeholder: true` — список на замену настоящими моделями в CHANGELOG.

## Звук и музыка

Звуковых файлов в игре нет: всё **синтезируется кодом** прямо в браузере (WebAudio) — моторы, удары, взрывы, нитро, телепорт, стингеры подарков, отсчёт, фанфары (`src/audio/sound.ts`) и музыка-подложка — электронный луп 112 ударов в минуту, Am–F–C–G (`src/audio/music.ts`). Лицензия — как у кода проекта; чужих сэмплов и чужой музыки нет, поэтому эфир не получит жалоб на авторские права. Почему не CC0-файлы — в docs/РЕШЕНИЯ.md («Этап 7»).

## Иконка приложения

`scripts/mac/icon.png` — нарисована кодом для этого проекта (машинка на клетчатой полосе, без марок и логотипов). Лицензия — как у кода.

## Код сторонних проектов

| Что | Откуда | Лицензия | Как использовано |
|---|---|---|---|
| Идеи физики машины и ворот | [szabolevi98/racing](https://github.com/szabolevi98/racing) | AGPL-3.0 | только прочитано, код не копировался (см. docs/РЕШЕНИЯ.md) |
| Raycast-vehicle | [Rapier](https://rapier.rs) `@dimforge/rapier3d-compat` | Apache-2.0 | npm-зависимость |
| Three.js | three | MIT | npm-зависимость |
| Пост-обработка | postprocessing (pmndrs) | Zlib | npm-зависимость |
| Ambient Occlusion | [n8ao](https://github.com/N8python/n8ao) | ISC | npm-зависимость |
| Загрузка glTF, Meshopt | three/examples (GLTFLoader, meshopt_decoder) | MIT | из пакета three |
| Подготовка моделей | glTF-Transform, meshoptimizer, sharp | MIT / MIT / Apache-2.0 | только для `scripts/models/`, в игру не входят |
