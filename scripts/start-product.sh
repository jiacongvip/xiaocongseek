#!/bin/bash
# 小葱剪辑台 · 一条命令启动整个产品（自定位版）
#
#   界面/工程/模板/会话 → 3080（node harness）
#   渲染内核 VectCut      → 9001（由 3080 托管成子进程，退出时一起关）
#
# 这个脚本不写死任何绝对路径：它按自己的位置反推仓库根，
# node 先找插件自带，再找 PATH，最后在 ~/.local/node 里挑版本最高的。
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/digital-human-studio"
HARNESS_DIR="$REPO_ROOT/deepseek-harness"
PORT="${PORT:-3080}"

if [ ! -f "$HARNESS_DIR/apps/cli/src/bin.ts" ]; then
  echo "❌ 找不到 harness：$HARNESS_DIR" >&2
  exit 2
fi

# ── node：环境变量 > 插件自带 > 一键安装目录 > ~/.local/node 最高 > PATH
NODE_BIN="${XIAOCONG_NODE:-}"
if [ -z "$NODE_BIN" ] && [ -x "$PLUGIN_DIR/vendor/runtime/node/bin/node" ]; then
  NODE_BIN="$PLUGIN_DIR/vendor/runtime/node/bin/node"
fi
# 客户机上第一次用：scripts/install-node.sh 会装到这里
if [ -z "$NODE_BIN" ] && [ -x "$HOME/.dsh/runtime/node/bin/node" ]; then
  NODE_BIN="$HOME/.dsh/runtime/node/bin/node"
fi
if [ -z "$NODE_BIN" ]; then
  # 用户机器上正式装的 node 在 ~/.local/node/<ver>，比系统/沙箱里那个更新，优先它
  # shellcheck disable=SC2012
  CAND=$(ls -1d "$HOME"/.local/node/*/bin/node 2>/dev/null | sort -V | tail -1 || true)
  if [ -n "$CAND" ] && [ -x "$CAND" ]; then NODE_BIN="$CAND"; fi
fi
if [ -z "$NODE_BIN" ]; then
  CAND=$(command -v node 2>/dev/null || true)
  if [ -n "$CAND" ]; then NODE_BIN="$CAND"; fi
fi
if [ -z "$NODE_BIN" ]; then
  echo "" >&2
  echo "❌ 这台机器上还没装 Node（剪辑台靠它启动，装完才进得了检测页）" >&2
  echo "" >&2
  echo "   一键装（不用 Homebrew，装到 ~/.dsh/runtime/node）：" >&2
  echo "     bash scripts/install-node.sh" >&2
  echo "" >&2
  echo "   已经装过的话，用环境变量指过去：" >&2
  echo "     XIAOCONG_NODE=/path/to/node bash scripts/start-product.sh" >&2
  echo "" >&2
  exit 2
fi

NODE_MAJOR=$("$NODE_BIN" -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
if [ "${NODE_MAJOR:-0}" -lt 22 ]; then
  echo "❌ node 版本太低（$("$NODE_BIN" -v)），需要 22+：$NODE_BIN" >&2
  echo "   跑 bash scripts/install-node.sh 装一个带版本，然后重新启动。" >&2
  exit 2
fi

echo "node: $NODE_BIN ($("$NODE_BIN" -v))"
echo "仓库: $REPO_ROOT"

# ── 停掉旧进程（只杀监听该端口的那个）
PID=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
if [ -n "$PID" ]; then
  echo "3080 已在运行（pid $PID），先停掉再起…"
  kill "$PID" 2>/dev/null || true
  sleep 3
fi

# ── 起服务
cd "$HARNESS_DIR"
nohup "$NODE_BIN" --import tsx/esm apps/cli/src/bin.ts \
  --profile web --no-open --port "$PORT" > /tmp/dsh-3080.log 2>&1 &
echo "剪辑台启动中：http://127.0.0.1:$PORT  （引擎 9001 会随它自动起）"
sleep 2
tail -3 /tmp/dsh-3080.log
