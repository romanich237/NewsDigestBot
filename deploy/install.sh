#!/usr/bin/env bash
# Interactive installation and reconfiguration of NewsDigestBot on Ubuntu and Debian/systemd.
set -euo pipefail
trap 'echo "Установка остановлена на строке $LINENO. Исправь ошибку выше и запусти deploy/install.sh повторно; конфиг и база сохраняются." >&2' ERR
APP_USER="newsbot"
APP_DIR="/opt/news-digest-bot"
SERVICE="news-digest-bot"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "$(id -u)" -ne 0 ]; then
  echo "Запустите sudo bash deploy/install.sh" >&2
  exit 1
fi
# Use system binaries: root's nvm installation is not available to the newsbot user.
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin"
. "$SRC_DIR/deploy/dependencies.sh"
install_dependencies
NODE_BIN="/usr/bin/node"
mkdir -p /run/lock
exec 9>/run/lock/newsdigest-install.lock
if ! flock -n 9; then echo "Другой установщик NewsDigestBot уже работает." >&2; exit 1; fi
if systemctl is-active --quiet "$SERVICE"; then
  echo "Останавливаю предыдущий экземпляр на время обновления файлов…"
  systemctl stop "$SERVICE"
fi
if [ -f "$APP_DIR/src/services/auto_updater.js" ]; then
  "$NODE_BIN" -e "require(process.argv[1]).recoverUpdate(process.argv[2])" "$APP_DIR/src/services/auto_updater.js" "$APP_DIR"
fi
echo "[4/8] Подготавливаю файлы приложения…"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --shell /usr/sbin/nologin --home-dir "$APP_DIR" "$APP_USER"
fi
mkdir -p "$APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  (cd "$SRC_DIR" && tar cf - --exclude=node_modules --exclude=.git --exclude=.updates --exclude=.npm --exclude=logs --exclude='*.db*' --exclude=config.json --exclude='config.json.*.bak' .) | (cd "$APP_DIR" && tar xf -)
fi
if [ ! -f "$APP_DIR/config.json" ]; then
  if [ -f "$SRC_DIR/config.json" ] && [ "$SRC_DIR" != "$APP_DIR" ]; then
    cp "$SRC_DIR/config.json" "$APP_DIR/config.json"
  else
    cp "$APP_DIR/config.example.json" "$APP_DIR/config.json"
  fi
fi
echo "[5/8] Настройка конфигурации…"
# No keys or passwords are passed through argv/environment or printed by the wizard.
"$NODE_BIN" "$APP_DIR/scripts/configure.js" "$APP_DIR/config.json"
mkdir -p "$APP_DIR/logs"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/config.json"
echo "[6/8] Устанавливаю зависимости приложения…"
if [ -f "$APP_DIR/package-lock.json" ]; then
  (cd "$APP_DIR" && runuser -u "$APP_USER" -- env HOME="$APP_DIR" npm ci --omit=dev --no-audit --no-fund)
else
  (cd "$APP_DIR" && runuser -u "$APP_USER" -- env HOME="$APP_DIR" npm install --omit=dev --no-audit --no-fund)
fi
(cd "$APP_DIR" && runuser -u "$APP_USER" -- "$NODE_BIN" src/main.js --validate)

WEB_ENABLED="$("$NODE_BIN" -p "JSON.parse(require('fs').readFileSync('$APP_DIR/config.json')).web?.enabled === true")"
WEB_DOMAIN="$("$NODE_BIN" -p "JSON.parse(require('fs').readFileSync('$APP_DIR/config.json')).web?.domain || ''")"
WEB_PORT="$("$NODE_BIN" -p "Number(JSON.parse(require('fs').readFileSync('$APP_DIR/config.json')).web?.port || 3000)")"
WEB_SSL="$("$NODE_BIN" -p "JSON.parse(require('fs').readFileSync('$APP_DIR/config.json')).web?.auto_ssl === true")"
WEB_EMAIL="$("$NODE_BIN" -p "JSON.parse(require('fs').readFileSync('$APP_DIR/config.json')).web?.ssl_email || ''")"
echo "[7/8] Проверяю настройки веб-панели и SSL…"
SSL_DONE=0
if [ "$WEB_ENABLED" = true ] && [ "$WEB_SSL" = true ]; then
  if ! [[ "$WEB_DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || ! [[ "$WEB_PORT" =~ ^[0-9]+$ ]] || [ "$WEB_PORT" -lt 1 ] || [ "$WEB_PORT" -gt 65535 ]; then
    echo "Некорректный домен или порт веб-панели" >&2
    exit 1
  fi
  # The wizard already records the user’s choice of automatic HTTPS.
  if [ -n "$WEB_DOMAIN" ]; then
    apt-get update
    apt-get install -y nginx certbot python3-certbot-nginx
    cat > "/etc/nginx/sites-available/$SERVICE" <<NGINX
server {
  listen 80;
  server_name $WEB_DOMAIN;
  location / {
    proxy_pass http://127.0.0.1:$WEB_PORT;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGINX
    ln -sf "/etc/nginx/sites-available/$SERVICE" "/etc/nginx/sites-enabled/$SERVICE"
    if [ -L /etc/nginx/sites-enabled/default ]; then unlink /etc/nginx/sites-enabled/default; fi
    nginx -t
    systemctl enable --now nginx
    systemctl reload nginx
    CERTBOT_ARGS=(--nginx -d "$WEB_DOMAIN" --non-interactive --agree-tos --redirect --keep-until-expiring)
    if [ -n "$WEB_EMAIL" ]; then CERTBOT_ARGS+=(--email "$WEB_EMAIL"); else CERTBOT_ARGS+=(--register-unsafely-without-email); fi
    if certbot "${CERTBOT_ARGS[@]}"; then
      SSL_DONE=1
      systemctl enable --now certbot.timer
    else
      echo "Не удалось выпустить SSL. Проверь DNS домена $WEB_DOMAIN и доступность портов 80/443, затем повтори установку." >&2
      exit 1
    fi
  fi
fi
echo "[8/8] Настраиваю и запускаю systemd-сервис…"
cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=NewsDigestBot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN $APP_DIR/src/main.js
Restart=always
RestartSec=5
TimeoutStopSec=30
User=$APP_USER
Environment=HOME=$APP_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"
echo "Готово. Сервис запущен: $SERVICE"
echo "Конфигурация: $APP_DIR/config.json"
echo "Все настройки повторно: sudo -u $APP_USER $NODE_BIN $APP_DIR/scripts/configure.js"
echo "После изменения настроек: sudo systemctl restart $SERVICE"
echo "Логи: sudo journalctl -u $SERVICE -f"
if [ "$SSL_DONE" = 1 ]; then
  echo "Панель: https://$WEB_DOMAIN (SSL продлевается автоматически)"
elif [ "$WEB_ENABLED" = true ]; then
  echo "Веб-панель включена на порту $WEB_PORT; автоматический SSL отключён."
else
  echo "Веб-панель отключена. Nginx и SSL для неё не устанавливались."
fi
