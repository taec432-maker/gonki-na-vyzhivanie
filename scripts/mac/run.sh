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

# Приложение с рабочего стола запускается с «урезанным» PATH — добавляем обычные папки программ.
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Ошибка — окно с последними строками журнала (когда запущено с рабочего стола).
on_error() {
  if [ ! -t 1 ] && command -v osascript >/dev/null; then
    msg="$(grep -v '^ *at ' "$HOME_DIR/launch.log" 2>/dev/null | tail -n 10 | tr '"\\' "'/" | cut -c1-160)"
    osascript -e "display dialog \"Ошибка при запуске. Сделайте скриншот этого окна и пришлите разработчику:\n\n$msg\" with title \"Гонки на выживание\" buttons {\"OK\"} default button 1 with icon stop" >/dev/null 2>&1 || true
  fi
}
trap on_error ERR

# --- Node.js: всегда свой, рядом с игрой (одна и та же версия и в «Терминале», и с рабочего стола) ---
export PATH="$NODE_DIR/bin:$PATH"
local_node_ok() { [ -x "$NODE_DIR/bin/node" ] && "$NODE_DIR/bin/node" -v >/dev/null 2>&1; }
if ! local_node_ok; then
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
  local_node_ok || { echo "✖ Node.js не запускается"; exit 1; }
fi
echo "▶ Node.js $(node -v) ($(uname -m)), $(command -v node)"

# --- Зависимости: заново, если поменялся их список или версия Node.js ---
stamp="node_modules/.install-stamp"
want="$(node -v) $(node -p process.arch) $(shasum package-lock.json | cut -d' ' -f1)"
if [ ! -d node_modules ] || [ "$(cat "$stamp" 2>/dev/null)" != "$want" ]; then
  echo "▶ Устанавливаю зависимости…"
  if [ ! -t 1 ] && command -v osascript >/dev/null; then
    osascript -e 'display notification "Первый запуск после обновления — 1–3 минуты" with title "Гонки на выживание"' || true
  fi
  rm -rf node_modules
  # Браузер для тестов в эфире не нужен.
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
  echo "$want" >"$stamp"
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
