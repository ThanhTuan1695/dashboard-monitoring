#!/usr/bin/env bash
# Rebuilds and restarts the app containers (server + client) WITHOUT touching
# MongoDB's data. Unlike start.sh (first-time setup: seeds admin/demo data),
# this is for day-to-day "I changed code, restart the stack" use — the
# `mongo-data` volume is never removed by `docker compose up` (only an
# explicit `docker compose down -v` would do that, which this script never runs).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Ensuring MongoDB is running (existing data untouched)..."
docker compose up -d mongo

echo "==> Waiting for MongoDB to accept connections..."
until docker compose exec -T mongo mongosh --quiet --eval "db.runCommand({ ping: 1 })" >/dev/null 2>&1; do
  sleep 1
done

echo "==> Rebuilding and restarting server + client..."
docker compose up -d --build server client

echo "==> Waiting for the API to come up..."
until curl -sf http://localhost:4000/api/health >/dev/null 2>&1 || curl -s http://localhost:4000/api/devices >/dev/null 2>&1; do
  sleep 1
done

DEVICE_COUNT=$(docker compose exec -T mongo mongosh monitoring-dashboard --quiet --eval "db.devices.countDocuments()" 2>/dev/null | tail -1)
USER_COUNT=$(docker compose exec -T mongo mongosh monitoring-dashboard --quiet --eval "db.users.countDocuments()" 2>/dev/null | tail -1)

cat <<EOF

Stack is up — existing database preserved:
  Devices in DB: ${DEVICE_COUNT}
  Users in DB:   ${USER_COUNT}

  Client:  http://localhost:5173
  Server:  http://localhost:4000
EOF
