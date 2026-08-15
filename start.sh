#!/usr/bin/env bash
# Seeds an admin user + demo dataset, then brings up the full docker-compose
# stack (mongo + server + client). Safe to re-run — both seed scripts are
# idempotent (existing groups/devices are left alone; existing users just
# get their role/groups/password reset to the seed values).
#
# Usage:
#   ./start.sh
#   ADMIN_USERNAME=myadmin ADMIN_PASSWORD='S0meLongPassw0rd!' ./start.sh
set -euo pipefail
cd "$(dirname "$0")"

ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-ChangeMe123!}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"

echo "==> Starting MongoDB..."
docker compose up -d mongo

echo "==> Waiting for MongoDB to accept connections..."
until docker compose exec -T mongo mongosh --quiet --eval "db.runCommand({ ping: 1 })" >/dev/null 2>&1; do
  sleep 1
done
echo "==> MongoDB is ready."

echo "==> Building the server image (needed to run the seed scripts)..."
docker compose build server

echo "==> Seeding admin user ($ADMIN_USERNAME)..."
docker compose run --rm server node src/scripts/seedAdmin.js "$ADMIN_USERNAME" "$ADMIN_PASSWORD" "$ADMIN_EMAIL"

echo "==> Seeding demo dataset (groups, devices, operator accounts)..."
docker compose run --rm server node src/scripts/seedDemo.js

echo "==> Starting the full stack..."
docker compose up -d --build

cat <<EOF

Stack is up:
  Client:  http://localhost:5173
  Server:  http://localhost:4000

Admin login:   $ADMIN_USERNAME / $ADMIN_PASSWORD
Demo accounts: demo-admin / op-hq / op-east / op-west / op-all  (password: demo-password-123)
EOF
