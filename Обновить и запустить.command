#!/bin/bash
# Гонки на выживание — обновить из GitHub, собрать и открыть в браузере.
cd "$(dirname "$0")" || exit 1
PORT=8091
echo "▶ Папка: $(pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "✖ Не найден Node.js. Установи с https://nodejs.org (версия LTS) и запусти снова."
  read -r -p "Нажми Enter, чтобы закрыть."; exit 1
fi

echo "▶ Забираю свежую версию…"
git pull --ff-only || { echo "✖ git pull не удался"; read -r -p "Enter…"; exit 1; }

if [ ! -f package.json ]; then
  echo "ℹ Кода игры ещё нет (этап 0 не выполнен). Пока открываю ТЗ."
  open "ТЗ.md"; read -r -p "Enter…"; exit 0
fi

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "▶ Устанавливаю зависимости…"; npm ci || { echo "✖ npm ci не удался"; read -r -p "Enter…"; exit 1; }
fi

echo "▶ Собираю игру…"
npm run build || { echo "✖ Сборка не удалась"; read -r -p "Enter…"; exit 1; }

# Остановить прошлый сервер на этом порту
lsof -ti tcp:$PORT | xargs kill 2>/dev/null

echo "▶ Запускаю сервер на http://127.0.0.1:$PORT"
nohup node scripts/serve.mjs --port $PORT >/tmp/gonki-server.log 2>&1 &
sleep 2
open "http://127.0.0.1:$PORT/"
echo
echo "✔ Игра:   http://127.0.0.1:$PORT/"
echo "✔ Панель: http://127.0.0.1:$PORT/control"
echo "✔ Оверлей: http://127.0.0.1:$PORT/overlay"
echo "Это окно можно закрыть — сервер продолжит работать."
