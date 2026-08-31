#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/srv/corgi
RELEASE=/tmp/corgi.tar.gz

if ! id corgiapp >/dev/null 2>&1; then
  sudo useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin corgiapp
fi

sudo mkdir -p "$APP_DIR"
sudo rm -rf "$APP_DIR/.next"
sudo tar -xzf "$RELEASE" -C "$APP_DIR"

if [ -f /tmp/corgi.env ]; then
  sudo cp /tmp/corgi.env "$APP_DIR/.env"
  rm -f /tmp/corgi.env
fi
sudo chmod 600 "$APP_DIR/.env"
sudo chown -R corgiapp:corgiapp "$APP_DIR"

cd "$APP_DIR"
sudo -u corgiapp npm ci --no-audit --no-fund
while IFS= read -r line; do
  case "$line" in '' | \#*) continue ;; esac
  export "${line?}"
done < <(sudo cat "$APP_DIR/.env")
sudo -u corgiapp -E npx tsx scripts/migrate.ts
sudo -u corgiapp -E npx next build

sudo cp "$APP_DIR/deploy/corgi.service" /etc/systemd/system/corgi.service
sudo cp "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
sudo mkdir -p /var/log/caddy
sudo chown caddy:caddy /var/log/caddy

sudo systemctl daemon-reload
sudo systemctl enable -q corgi
sudo systemctl restart corgi
sudo systemctl reload caddy || sudo systemctl restart caddy

sleep 5
sudo systemctl is-active corgi
