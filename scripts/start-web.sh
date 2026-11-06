#!/usr/bin/env bash
# Start Xiaocongseek web from the fork local source build (not npx).
set -euo pipefail

FORK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$FORK_ROOT/deepseek-harness"
PORT="${PORT:-3080}"
PROFILE="${PROFILE:-web}"
LOG="${LOG:-/tmp/xiaocongseek-web-local.log}"

export PATH="$HOME/.local/bin:$HOME/.local/node/v24.22.1/bin:$PATH"

if [[ ! -d "$HARNESS" ]]; then
  echo "missing harness: $HARNESS" >&2
  exit 1
fi

# Stop only the web profile on this port; leave DeepSeek Harness.app alone.
pkill -f "dsh --profile ${PROFILE} --no-open --port ${PORT}" 2>/dev/null || true
pkill -f "apps/cli/src/bin.ts --profile ${PROFILE} --no-open --port ${PORT}" 2>/dev/null || true
sleep 1

cd "$HARNESS"
nohup pnpm dsh --profile "$PROFILE" --no-open --port "$PORT" >"$LOG" 2>&1 &
echo "started pid=$! log=$LOG"
# Wait for the token line
for i in $(seq 1 60); do
  if grep -q 'dsh web: http' "$LOG" 2>/dev/null; then
    grep 'dsh web: http' "$LOG" | tail -1
    exit 0
  fi
  sleep 0.5
done
echo "boot timed out; see $LOG" >&2
tail -40 "$LOG" >&2 || true
exit 1
