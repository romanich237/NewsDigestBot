#!/usr/bin/env bash
# NewsDigestBot — установка и запуск под Linux (systemd) + веб-панель с SSL.
# Запуск из каталога проекта: sudo bash deploy/install.sh
set -euo pipefail

APP_USER="newsbot"
APP_DIR="/opt/news-digest-bot"
SERVICE="news-digest-bot"
UNIT="/etc/systemd/system/${SERVICE}.service"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
 echo "Запустите от root или через sudo." >&2
 exit 1
fi

if ! command -v node > /dev/null2>&1; then
 echo "Node.js не найден. Установите Node.js 18.18+ (https://nodejs.org или через пакетный менеджер)." >&2
 exit 1
fi

NODE_BIN="$(command -v node)"
node -e "const[v1,v2]=process.versions.node.split('.').map(Number);if(v1<18||(v1===18&&v2<18)){console.error('Требуется Node.js >= 18.18');process.exit(1)}"

# ---------- Параметры веб-панели ----------
WEB_PORT="${WEB_PORT:-3000}"
WEB_DOMAIN="${WEB_DOMAIN:-}"
WEB_PASSWORD="${WEB_PASSWORD:-}"

read -rp "Порт веб-панели [${WEB_PORT}]: " inp; [ -n "$inp" ] && WEB_PORT="$inp"
read -rp "Домен для веб-панели (Enter — пропустить HTTPS): " inp; [ -n "$inp" ] && WEB_DOMAIN="$inp"
read -rp "Пароль веб-панели: " inp; [ -n "$inp" ] && WEB_PASSWORD="$inp"

# ---------- Проверка домена и выпуск SSL ----------
SSL_DONE=0
if [ -n "$WEB_DOMAIN" ] && [ -n "$WEB_PASSWORD" ]; then
 SERVER_IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
 DOMAIN_IP="$(getent ahostsv4 "$WEB_DOMAIN" 2>/dev/null | awk '{print $1; exit}' || true)"

 if [ -z "$SERVER_IP" ] || [ -z "$DOMAIN_IP" ]; then
 echo "WARNING: не удалось определить IP (сервер: '${SERVER_IP:-?}', домен: '${DOMAIN_IP:-?}'). Проверьте DNS A-запись -> $WEB_DOMAIN."
 read -rp "Продолжить без SSL? [y/N]: " ok; [[ "$ok" == "y" || "$ok" == "Y" ]] || exit 1
 elif [ "$SERVER_IP" != "$DOMAIN_IP" ]; then
 echo "WARNING: домен $WEB_DOMAIN ($DOMAIN_IP) не указывает на этот сервер ($SERVER_IP)."
 echo "Создайте A-запись у DNS-провайдера и повторите установку."
 read -rp "Продолжить без SSL? [y/N]: " ok; [[ "$ok" == "y" || "$ok" == "Y" ]] || exit 1
 else
 echo "OK: домен $WEB_DOMAIN -> $DOMAIN_IP совпадает с IP сервера."
 if ! command -v nginx > /dev/null2>&1; then
 (apt-get update && apt-get install -y nginx) || echo "Не удалось установить nginx (не Debian/Ubuntu?). Настройте прокси вручную."
 fi
 if command -v nginx > /dev/null2>&1; then
 cat > "/etc/nginx/sites-available/${SERVICE}" <<EOF
server {
 listen 80;
 server_name ${WEB_DOMAIN};
 location / {
 proxy_pass http://127.0.0.1:${WEB_PORT};
 proxy_set_header Host \$host;
 proxy_set_header X-Real-IP \$remote_addr;
 proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
 proxy_set_header X-Forwarded-Proto \$scheme;
 }
}
EOF
 ln -sf "/etc/nginx/sites-available/${SERVICE}" "/etc/nginx/sites-enabled/${SERVICE}"
 rm -f /etc/nginx/sites-enabled/default
 nginx -t && systemctl reload nginx

 if ! command -v certbot > /dev/null2>&1; then
 apt-get install -y certbot python3-certbot-nginx || echo "Установите certbot вручную: https://certbot.eff.org"
 fi
 if command -v certbot > /dev/null2>&1; then
 if certbot --nginx -d "$WEB_DOMAIN" --non-interactive --agree-tos -m "admin@${WEB_DOMAIN}" --redirect; then
 SSL_DONE=1
 echo "OK: SSL-сертификат Let's Encrypt выпущен для $WEB_DOMAIN (автообновление через certbot.timer)."
 else
 echo "WARNING: certbot не смог выпустить сертификат. Проверьте порт 80 и DNS, затем: sudo certbot --nginx -d $WEB_DOMAIN"
 fi
 fi
 fi
 fi
fi

# ---------- Файлы приложения ----------
if ! id "$APP_USER" > /dev/null2>&1; then
 useradd --system --shell /usr/sbin/nologin --home-dir "$APP_DIR" "$APP_USER"
fi

mkdir -p "$APP_DIR"
(cd "$SRC_DIR" && tar cf - --exclude=node_modules --exclude=.git --exclude=data.db --exclude=deploy .) | (cd "$APP_DIR" && tar xf -)

if [ ! -f "$APP_DIR/config.json" ]; then
 cp "$APP_DIR/config.example.json" "$APP_DIR/config.json"
 echo "Создан $APP_DIR/config.json из шаблона — заполните API-ключи и chat ID."
fi

# Записать параметры веб-панели в конфиг
if [ -n "$WEB_PASSWORD" ]; then
 WEB_PORT="$WEB_PORT" WEB_DOMAIN="$WEB_DOMAIN" WEB_PASSWORD="$WEB_PASSWORD" "$NODE_BIN" - "$APP_DIR/config.json" <<'NODEEOF'
const fs = require('fs');
const f = process.argv[2];
const o = JSON.parse(fs.readFileSync(f, 'utf8'));
o.web = {
 enabled: true,
 port: Number(process.env.WEB_PORT || 3000),
 host: '127.0.0.1',
 domain: process.env.WEB_DOMAIN || '',
 password: process.env.WEB_PASSWORD
};
fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n');
console.log('web-блок записан в config.json');
NODEEOF
fi

# Установка зависимостей (при ошибке сборки better-sqlite3 поставьте: apt install build-essential python3)
(cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund)
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

cat > "$UNIT" <<EOF
[Unit]
Description=NewsDigestBot
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN $APP_DIR/src/main.js
Restart=always
RestartSec=5
User=$APP_USER

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE"

echo ""
echo "Готово. Дальше:"
if [ -n "$WEB_DOMAIN" ] && [ "$SSL_DONE" = "1" ]; then
 echo "Веб-панель: https://${WEB_DOMAIN} (пароль: ваш web.password)"
else
 echo "Веб-панель: http://IP_СЕРВЕРА:${WEB_PORT} (панель слушает 127.0.0.1 — при отсутствии nginx смените web.host на 0.0.0.0)"
fi
echo "1) отредактируйте ключи: sudo nano $APP_DIR/config.json"
echo "2) проверка конфига: sudo -u $APP_USER $NODE_BIN $APP_DIR/src/main.js --validate"
echo "3) запуск сервиса: sudo systemctl start $SERVICE"
echo "4) статус и логи: sudo systemctl status $SERVICE"
echo " sudo journalctl -u $SERVICE -f"
