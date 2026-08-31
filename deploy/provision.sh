#!/usr/bin/env bash
set -euo pipefail

if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq curl ca-certificates gnupg git postgresql postgresql-contrib debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs
fi

if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy
fi

sudo systemctl enable --now postgresql

if ! sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='corgi'" | grep -q 1; then
  sudo -u postgres psql -qc "create role corgi login password '${DB_PASSWORD}'"
fi
if ! sudo -u postgres psql -tAc "select 1 from pg_database where datname='corgi'" | grep -q 1; then
  sudo -u postgres createdb -O corgi corgi
fi
sudo -u postgres psql -qd corgi -c "grant all on schema public to corgi"

sudo mkdir -p /srv/corgi
sudo chown -R "$(whoami):$(whoami)" /srv/corgi

node -v
psql --version
caddy version
