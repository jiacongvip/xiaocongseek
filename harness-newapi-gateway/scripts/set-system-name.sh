#!/usr/bin/env bash
# Set New API console display name (SystemName) without rebuilding the image.
# Usage: ./scripts/set-system-name.sh [XiaocongAPI]
set -euo pipefail
NAME="${1:-XiaocongAPI}"
docker exec harness-new-api-postgres psql -U root -d new-api -v ON_ERROR_STOP=1 -c \
  "INSERT INTO options (key, value) VALUES ('SystemName', '${NAME}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;"
docker restart harness-new-api
echo "Waiting for healthy..."
for i in $(seq 1 30); do
  st=$(docker inspect -f '{{.State.Health.Status}}' harness-new-api 2>/dev/null || echo starting)
  [[ "$st" == "healthy" ]] && break
  sleep 2
done
curl -sS 'http://127.0.0.1:3000/api/status' | python3 -c 'import sys,json; print("system_name=", json.load(sys.stdin)["data"]["system_name"])'
