#!/bin/bash
# Быстрая проверка перед коммитом (без браузерных тестов): падает на первой ошибке.
set -euo pipefail
npx tsc --noEmit
npx eslint .
npx vitest run --reporter=dot
