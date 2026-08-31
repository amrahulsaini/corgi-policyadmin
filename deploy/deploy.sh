#!/usr/bin/env bash
set -euo pipefail

PROJECT=work1-482817
ZONE=us-central1-a
VM=corgi
GC="gcloud compute --project=$PROJECT"

cd "$(dirname "$0")/.."

tar --exclude=./node_modules --exclude=./.next --exclude=./.git \
    --exclude=./.env --exclude=./.env.local \
    -czf /tmp/corgi.tar.gz .

$GC scp /tmp/corgi.tar.gz "$VM:/tmp/corgi.tar.gz" --zone=$ZONE --quiet

if [ -f deploy/env.remote ]; then
  $GC scp deploy/env.remote "$VM:/tmp/corgi.env" --zone=$ZONE --quiet
fi

$GC ssh "$VM" --zone=$ZONE --quiet \
  --command="rm -rf ~/corgi-deploy && mkdir -p ~/corgi-deploy && \
             tar -xzf /tmp/corgi.tar.gz -C ~/corgi-deploy ./deploy/remote-deploy.sh && \
             sed -i 's/\r\$//' ~/corgi-deploy/deploy/remote-deploy.sh && \
             bash ~/corgi-deploy/deploy/remote-deploy.sh"
