#!/bin/bash
# Установщик «Гонок на выживание» для Мака — одна строка в «Терминале»:
#   curl -fsSL https://raw.githubusercontent.com/taec432-maker/gonki-na-vyzhivanie/main/scripts/mac/install.sh | bash
#
# Что делает: скачивает игру в ~/Games/gonki-na-vyzhivanie, ставит Node.js рядом с ней
# (не в систему, пароль не нужен), собирает игру и кладёт на рабочий стол приложение
# «Гонки на выживание» с иконкой. Двойной щелчок по нему — обновить и запустить.
# Повторный запуск установщика ничего не ломает: просто обновит всё и пересоздаст значок.
set -euo pipefail

# Всё — внутри функции: при «curl … | bash» bash сначала дочитает скрипт целиком.
main() {

HOME_DIR="$HOME/Games/gonki-na-vyzhivanie"
GAME="$HOME_DIR/game"
TARBALL="https://codeload.github.com/taec432-maker/gonki-na-vyzhivanie/tar.gz/refs/heads/main"
APP="$HOME/Desktop/Гонки на выживание.app"

say() { printf '\n▶ %s\n' "$1"; }

say "Скачиваю игру…"
mkdir -p "$GAME"
tmp="$(mktemp -d)"
curl -fsSL --retry 3 "$TARBALL" -o "$tmp/game.tgz"
mkdir -p "$tmp/x"
tar -xzf "$tmp/game.tgz" -C "$tmp/x" --strip-components 1
# Новые файлы вместо старых; зависимости (node_modules) и сборку не трогаем — так быстрее.
find "$GAME" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name dist -exec rm -rf {} +
cp -R "$tmp/x/." "$GAME/"
rm -rf "$tmp"

say "Готовлю Node.js, собираю игру (первый раз — 1–3 минуты)…"
bash "$GAME/scripts/mac/run.sh" --no-open

say "Создаю приложение на рабочем столе…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cat >"$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Гонки на выживание</string>
  <key>CFBundleDisplayName</key><string>Гонки на выживание</string>
  <key>CFBundleIdentifier</key><string>local.gonki-na-vyzhivanie</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>gonki</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
PLIST

# Логика приложения живёт внутри него (а не в папке игры), потому что при
# обновлении папка игры перезаписывается целиком.
cat >"$APP/Contents/MacOS/gonki" <<'LAUNCHER'
#!/bin/bash
HOME_DIR="$HOME/Games/gonki-na-vyzhivanie"
GAME="$HOME_DIR/game"
TARBALL="https://codeload.github.com/taec432-maker/gonki-na-vyzhivanie/tar.gz/refs/heads/main"
LOG="$HOME_DIR/launch.log"
mkdir -p "$HOME_DIR"
exec >"$LOG" 2>&1
TITLE="Гонки на выживание"
notify() { osascript -e "display notification \"$1\" with title \"$TITLE\"" || true; }
fail() {
  osascript -e "display dialog \"$1\n\nПодробности — в файле:\n$LOG\" with title \"$TITLE\" buttons {\"OK\"} default button 1 with icon stop" || true
  exit 1
}
notify "Обновляю и запускаю…"
# Свежая версия с GitHub; нет интернета — запускаем ту, что уже есть.
tmp="$(mktemp -d)"
if curl -fsSL --max-time 120 --retry 2 "$TARBALL" -o "$tmp/game.tgz" && mkdir -p "$tmp/x" &&
  tar -xzf "$tmp/game.tgz" -C "$tmp/x" --strip-components 1; then
  find "$GAME" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name dist -exec rm -rf {} +
  cp -R "$tmp/x/." "$GAME/"
else
  echo "Обновить не удалось (нет интернета?) — запускаю имеющуюся версию."
fi
rm -rf "$tmp"
[ -f "$GAME/scripts/mac/run.sh" ] || fail "Игра не найдена. Запустите установщик ещё раз (строка из инструкции)."
bash "$GAME/scripts/mac/run.sh" || fail "Игра не запустилась."
LAUNCHER
chmod +x "$APP/Contents/MacOS/gonki"

# Иконка: из PNG в формат значков Мака (sips и iconutil есть в каждом macOS).
iconset="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$GAME/scripts/mac/icon.png" --out "$iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$GAME/scripts/mac/icon.png" --out "$iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$APP/Contents/Resources/AppIcon.icns"
touch "$APP"

say "Готово! На рабочем столе — «Гонки на выживание». Запускаю…"
open "$APP"
}

main "$@"
