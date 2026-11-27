#!/bin/bash
# 小葱剪辑台 · 一条命令启动整个产品
#  界面/工程/模板/会话 → 3080（node harness）
#  渲染内核 Xiaocongcut      → 9001（由 3080 托管成子进程，退出时一起关）
set -e
PORT="${PORT:-3080}"
PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
if [ -n "$PID" ]; then
  echo "3080 已在运行（pid $PID），先停掉再起…"
  kill "$PID" 2>/dev/null || true
  sleep 3
fi
cd "/Users/jiacong/Desktop/开发文件/小葱/dsh-newapi-fork/deepseek-harness"
nohup /Users/jiacong/.local/node/v24.13.1/bin/node --import tsx/esm apps/cli/src/bin.ts \
  --profile web --no-open --port "$PORT" > /tmp/dsh-3080.log 2>&1 &
echo "剪辑台启动中：http://127.0.0.1:$PORT  （引擎 9001 会随它自动起）"
sleep 2
tail -3 /tmp/dsh-3080.log
