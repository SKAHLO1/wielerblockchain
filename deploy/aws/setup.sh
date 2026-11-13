#!/usr/bin/env bash
# Installs the WIELER keeper and Barbarian as systemd services on an Ubuntu 24.04 EC2 instance.
# Run from a checkout of the repository:  sudo bash deploy/aws/setup.sh
# Then put the signer keys in /etc/wieler/keeper.env and /etc/wieler/barbarian.env and run
#   sudo systemctl enable --now wieler-keeper wieler-barbarian
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id wieler >/dev/null 2>&1 || useradd --system --home /opt/wieler --shell /usr/sbin/nologin wieler
mkdir -p /opt/wieler
rsync -a --delete --exclude node_modules --exclude '*.log' --exclude .env "$REPO/scripts/" /opt/wieler/scripts/
(cd /opt/wieler/scripts && npm ci --omit=dev)
chown -R wieler:wieler /opt/wieler

mkdir -p /etc/wieler
for svc in keeper barbarian; do
  f=/etc/wieler/$svc.env
  if [ ! -f "$f" ]; then
    cat > "$f" <<ENV
MASTER_ACCOUNT=
NEAR_NODE_URL=https://test.rpc.fastnear.com
# account=ed25519:<secret key> for the account this service signs as
NEAR_SIGNER_KEYS=
ENV
    [ "$svc" = keeper ] && echo "KEEPER_ACCOUNT=" >> "$f"
  fi
  chmod 600 "$f"
  install -m 644 "$REPO/deploy/aws/wieler-$svc.service" /etc/systemd/system/
done
systemctl daemon-reload
echo "Installed. Fill in /etc/wieler/*.env, then: systemctl enable --now wieler-keeper wieler-barbarian"
