# Гонки на выживание

3D-игра для TikTok Live: зрители пишут ник в чат и попадают в гонку машинкой со своим ником; подарки дают ускорение, оружие и «пакости». Three.js + Rapier, работает в браузере и в OBS.

- **Техническое задание:** [ТЗ.md](ТЗ.md) — главный документ, читать первым.
- **Что сделано / как проверить:** [CHANGELOG.md](CHANGELOG.md)
- **Промпты по этапам для облачных сессий:** [docs/prompts/](docs/prompts/)
- **Принятые решения по ходу работы:** [docs/РЕШЕНИЯ.md](docs/РЕШЕНИЯ.md)
- **Лицензии моделей, HDRI, звуков:** [ASSETS.md](ASSETS.md)

## Запуск на Маке

Дважды щёлкнуть **«Обновить и запустить.command»** в папке проекта. Скрипт заберёт свежую версию, соберёт игру и откроет её в браузере на `http://127.0.0.1:8091`.

- Игра (для OBS Browser Source 1920×1080): `http://127.0.0.1:8091/`
- Панель стримера: `http://127.0.0.1:8091/control`
- Прозрачный оверлей: `http://127.0.0.1:8091/overlay`

TikTok Bridge должен быть запущен отдельно (приложение «TikTok Bridge» на рабочем столе).

## Для разработки

Нужен Node.js 20+ (LTS). Всё ставится локально в папку проекта, глобально ничего не нужно.

```bash
npm ci               # зависимости
npm run dev          # dev-сервер Vite: http://127.0.0.1:5173/
npm run build        # сборка в dist/
npm run serve        # локальный сервер эфира: http://127.0.0.1:8091/ (раздаёт dist/ + ретранслятор панели)
npm run check        # всё: tsc + eslint + vitest + сборка + playwright
npm run check:ci     # то же без браузерных тестов (так проверяет GitHub Actions)
npm test             # только unit-тесты (Vitest)
npm run e2e          # только браузерные тесты (Playwright, headless Chromium + SwiftShader)
```

Полезные параметры адреса игры: `?seed=42` — повторяемый заезд, `?quality=high|medium|broadcast` — качество, `?bridge=off` — не подключаться к Bridge.

Структура кода — раздел 4 ТЗ: `src/core` (цикл, шаг 60 Гц, seed-рандом, шина событий, связь страниц), `src/physics` (Rapier, машина), `src/tracks` (сплайн трассы, JSON трасс), `src/vehicles` (JSON машин), `src/ai`, `src/render`, `src/hud`, `src/control`, `src/overlay`, остальное — по этапам.

Свежая сборка с ветки `main` автоматически публикуется на GitHub Pages: https://taec432-maker.github.io/gonki-na-vyzhivanie/ (панель — `/gonki-na-vyzhivanie/control/`). Это для просмотра; эфир идёт с локального запуска, потому что Bridge живёт на `127.0.0.1`.
