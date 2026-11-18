#!/usr/bin/env bash
# Установка и обновление игрового сервера N.E.G.S: Заполярье на Ubuntu (22.04/24.04).
# Запуск от root в консоли сервера:
#   curl -fsSL https://raw.githubusercontent.com/01212804447a-pixel/for_test/ccr-1873665d-v9ft7q/server/install-vps.sh | bash
# Повторный запуск обновляет игру до последней версии.
set -euo pipefail
REPO="https://github.com/01212804447a-pixel/for_test.git"
BRANCH="${BRANCH:-ccr-1873665d-v9ft7q}"
DIR=/opt/negs/game
PORT="${PORT:-80}"

echo "== Пакеты =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -q
apt-get install -y -q git curl ca-certificates nodejs npm
node -v

echo "== Пользователь и файлы игры =="
id negs >/dev/null 2>&1 || useradd -r -m -d /opt/negs -s /usr/sbin/nologin negs
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$DIR" reset --hard FETCH_HEAD
else
  rm -rf "$DIR"
  git clone --depth 1 -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"
npm install --omit=dev --no-audit --no-fund
chown -R negs:negs /opt/negs

echo "== Служба =="
cat > /etc/systemd/system/negs.service <<UNIT
[Unit]
Description=N.E.G.S game server
After=network-online.target

[Service]
User=negs
WorkingDirectory=$DIR
Environment=PORT=$PORT
ExecStart=/usr/bin/node server/server.mjs
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable negs >/dev/null
systemctl restart negs

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 22/tcp >/dev/null; ufw allow "$PORT"/tcp >/dev/null
fi

sleep 2
echo "== Проверка =="
curl -fsS "http://127.0.0.1:$PORT/health" && echo
IP=$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo
echo "Готово. Игра: http://$IP$( [ "$PORT" = 80 ] || echo ":$PORT" )"
echo "Журнал сервера: journalctl -u negs -f     Перезапуск: systemctl restart negs"
