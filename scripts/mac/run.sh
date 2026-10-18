#!/bin/bash
# Сборка и запуск игры на Маке (вызывает приложение «Гонки на выживание» и установщик).
# Node.js — свой, в ~/Games/gonki-na-vyzhivanie/node: в систему ничего не ставится.
#   --no-open  — не открывать браузер (установщик откроет приложение сам).
set -euo pipefail

HOME_DIR="$HOME/Games/gonki-na-vyzhivanie"
GAME="$(cd "$(dirname "$0")/../.." && pwd)"
PORT=8091
NODE_DIR="$HOME_DIR/node"
cd "$GAME"

# --- Node.js: системный, если версия 20+, иначе — свой рядом с игрой ---
node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; }
export PATH="$NODE_DIR/bin:$PATH"
if ! node_ok; then
  echo "▶ Скачиваю Node.js (один раз)…"
  arch="$(uname -m)"
  [ "$arch" = "arm64" ] || arch="x64"
  base="https://nodejs.org/dist/latest-v22.x"
  file="$(curl -fsSL "$base/SHASUMS256.txt" | awk -v a="darwin-$arch.tar.gz" '$2 ~ a"$" {print $2; exit}')"
  [ -n "$file" ] || { echo "✖ Не нашёл Node.js для этого Мака"; exit 1; }
  tmp="$(mktemp -d)"
  curl -fsSL --retry 3 "$base/$file" -o "$tmp/node.tgz"
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xzf "$tmp/node.tgz" -C "$NODE_DIR" --strip-components 1
  rm -rf "$tmp"
  node_ok || { echo "✖ Node.js не запускается"; exit 1; }
fi
echo "▶ Node.js $(node -v)"

# --- Зависимости: только если поменялся список (package-lock.json) ---
stamp="node_modules/.lock-stamp"
if [ ! -d node_modules ] || ! cmp -s package-lock.json "$stamp"; then
  echo "▶ Устанавливаю зависимости…"
  # Браузер для тестов в эфире не нужен.
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
  cp package-lock.json "$stamp"
fi

echo "▶ Собираю игру…"
npm run build

# --- Сервер: остановить прошлый, запустить новый, дождаться ответа ---
lsof -ti tcp:$PORT | xargs kill 2>/dev/null || true
sleep 0.5
nohup node scripts/serve.mjs --port $PORT >"$HOME_DIR/server.log" 2>&1 &
for _ in $(seq 1 40); do
  curl -fs "http://127.0.0.1:$PORT/" >/dev/null && break
  sleep 0.25
done
curl -fs "http://127.0.0.1:$PORT/" >/dev/null || { echo "✖ Сервер не запустился, см. $HOME_DIR/server.log"; exit 1; }
echo "✔ Игра:   http://127.0.0.1:$PORT/"
echo "✔ Панель: http://127.0.0.1:$PORT/control"

if [ "${1:-}" != "--no-open" ]; then
  open "http://127.0.0.1:$PORT/control"
  open "http://127.0.0.1:$PORT/"
fi
