#!/usr/bin/env bash
# Сервер для игры по локальной сети (Linux/macOS): ./server/start-lan.sh
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo "Нужен Node.js 18+: https://nodejs.org"; exit 1; }
exec node server/server.mjs
