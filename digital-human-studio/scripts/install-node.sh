#!/bin/bash
# 小葱剪辑台 · Node 运行时一键安装（不依赖 Homebrew、不污染系统目录）
#
#   bash scripts/install-node.sh          # 没有/版本低就下，够用就跳过
#   bash scripts/install-node.sh --check  # 只体检，不下载
#
# 装到 ~/.dsh/runtime/node，start-product.sh 会优先用它。
# 只支持 macOS（产品本身就是 mac 桌面端）。
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.dsh/runtime/node"
MIN_MAJOR=22

need_more() {
  local bin="$1"
  [ -x "$bin" ] || return 0
  local major
  major="$("$bin" -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
  [ "${major:-0}" -lt "$MIN_MAJOR" ]
}

find_existing() {
  for c in "$DEST/bin/node" "$HOME"/.local/node/*/bin/node; do
    if [ -x "$c" ] && ! need_more "$c"; then echo "$c"; return 0; fi
  done
  if command -v node >/dev/null 2>&1 && ! need_more "$(command -v node)"; then
    command -v node; return 0
  fi
  return 1
}

EXIST="$(find_existing || true)"
if [ -n "$EXIST" ]; then
  echo "node 已就绪：$EXIST ($("$EXIST" -v))"
  [ "$1" = "--check" ] && exit 0
  exit 0
fi
[ "$1" = "--check" ] && { echo "node 缺失或低于 v$MIN_MAJOR"; exit 1; }

if [ "$(uname -s)" != "Darwin" ]; then
  echo "❌ 只支持 macOS。请手动装 node $MIN_MAJOR+，或用 XIAOCONG_NODE 指定。" >&2
  exit 2
fi

case "$(uname -m)" in
  arm64) PKG_ARCH=arm64 ;;
  x86_64) PKG_ARCH=x64 ;;
  *) echo "❌ 不认识的架构：$(uname -m)" >&2; exit 2 ;;
esac

BASE="https://nodejs.org/dist/latest-v22.x"
echo "→ 取 v22 最新版本清单…"
SUM="$(curl -fsSL "$BASE/SHASUMS256.txt")" || {
  echo "❌ 连不上 nodejs.org。检查网络/代理后重试。" >&2; exit 3; }
FILE="$(echo "$SUM" | awk '{print $2}' | grep "darwin-$PKG_ARCH.tar.gz" | head -1)"
if [ -z "$FILE" ]; then
  echo "❌ 清单里没找到 darwin-$PKG_ARCH 包。" >&2; exit 3
fi

echo "→ 下载 $FILE（约 50MB）…"
curl -fL --progress-bar "$BASE/$FILE" -o "/tmp/$FILE" || {
  echo "❌ 下载失败。" >&2; exit 3; }

echo "→ 解压到 $DEST …"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
mkdir -p "$DEST"
tar -xzf "/tmp/$FILE" -C "$DEST" --strip-components=1
rm -f "/tmp/$FILE"

if ! "$DEST/bin/node" -v >/dev/null 2>&1; then
  echo "❌ 装完起不来：$DEST/bin/node" >&2; exit 4
fi
echo "✅ node 装好了：$DEST/bin/node ($("$DEST/bin/node" -v))"
echo "   启动：bash scripts/start-product.sh"
