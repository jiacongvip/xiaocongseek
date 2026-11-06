#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — change passwords before non-local use."
fi
docker compose up -d
echo "New API: http://127.0.0.1:${NEW_API_PORT:-3000}"
