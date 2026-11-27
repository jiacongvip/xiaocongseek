#!/bin/bash
# 小葱剪辑台 · 换机自愈
#
# 用法：把整个仓库（含 digital-human-studio）复制到新机器后，跑一次：
#   bash digital-human-studio/../scripts/bootstrap-product.sh   （或直接 bash bootstrap-product.sh）
#
# 它做三件事：
#   1. 用插件自带的 standalone Python（vendor/runtime/cpython-*）重建两套 venv
#      —— venv 里的解释器路径是绝对的，换机必断，只能重建，不能复制。
#   2. 装依赖（先离线 wheels，没有就联网走清华源）。
#   3. 跑一遍环境体检（doctor-product.sh）。
#
# 幂等：已经能用的 venv 不会被重建；重复跑没有副作用。
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/digital-human-studio"
UV_BIN="$(command -v uv 2>/dev/null || true)"
[ -n "$UV_BIN" ] || UV_BIN="$HOME/.local/bin/uv"
[ -x "$UV_BIN" ] || UV_BIN=""

ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }
bad()  { echo "  ❌ $*"; }

echo "小葱剪辑台 · 换机自愈"
echo "插件：$PLUGIN_DIR"
echo

# ── 0. 自带 Python 是否在
PY312="$(ls -1d "$PLUGIN_DIR"/vendor/runtime/cpython-3.12*/bin/python3.12 2>/dev/null | head -1)"
PY311="$(ls -1d "$PLUGIN_DIR"/vendor/runtime/cpython-3.11*/bin/python3.11 2>/dev/null | head -1)"
if [ ! -x "$PY312" ] || [ ! -x "$PY311" ]; then
  bad "插件里缺 standalone Python（vendor/runtime/cpython-3.12/3.11）"
  echo "    这个必须随安装包分发，不能现装。"
  exit 1
fi
ok "自带 Python：3.12=$(basename "$(dirname "$(dirname "$PY312")")")  3.11=$(basename "$(dirname "$(dirname "$PY311")")")"

# ── 1. 引擎 venv（flask / faster-whisper）
ENGINE_VENV="$PLUGIN_DIR/vendor/vectcut/.venv"
if [ -x "$ENGINE_VENV/bin/python" ] && "$ENGINE_VENV/bin/python" -c "import flask, faster_whisper" >/dev/null 2>&1; then
  ok "引擎环境可用（跳过）"
else
  warn "引擎环境不可用，重建…"
  rm -rf "$ENGINE_VENV"
  if [ -n "$UV_BIN" ]; then
    "$UV_BIN" venv --python "$PY312" "$ENGINE_VENV" >/dev/null 2>&1 || { bad "建引擎 venv 失败"; exit 1; }
    "$UV_BIN" pip install --python "$ENGINE_VENV/bin/python" \
      -r "$PLUGIN_DIR/vendor/vectcut/requirements.txt" pillow faster-whisper \
      --index-url https://pypi.tuna.tsinghua.edu.cn/simple 2>&1 | tail -3
  else
    "$PY312" -m venv "$ENGINE_VENV" && "$ENGINE_VENV/bin/pip" install -r "$PLUGIN_DIR/vendor/vectcut/requirements.txt" pillow faster-whisper
  fi
  "$ENGINE_VENV/bin/python" -c "import flask, faster_whisper" >/dev/null 2>&1 \
    && ok "引擎环境重建完成" || { bad "引擎依赖装不上（多半是网络）"; exit 1; }
fi

# ── 2. 采集 venv（httpx / playwright / pandas）
CRAWL_VENV="$PLUGIN_DIR/vendor/venv"
if [ -x "$CRAWL_VENV/bin/python" ] && "$CRAWL_VENV/bin/python" -c "import httpx, parsel, playwright" >/dev/null 2>&1; then
  ok "采集环境可用（跳过）"
else
  warn "采集环境不可用，重建…"
  rm -rf "$CRAWL_VENV"
  if [ -n "$UV_BIN" ]; then
    "$UV_BIN" venv --python "$PY311" "$CRAWL_VENV" >/dev/null 2>&1 || { bad "建采集 venv 失败"; exit 1; }
    "$UV_BIN" pip install --python "$CRAWL_VENV/bin/python" \
      -r "$PLUGIN_DIR/vendor/media-crawler/requirements.txt" \
      --index-url https://pypi.tuna.tsinghua.edu.cn/simple 2>&1 | tail -3
  else
    "$PY311" -m venv "$CRAWL_VENV" && "$CRAWL_VENV/bin/pip" install -r "$PLUGIN_DIR/vendor/media-crawler/requirements.txt"
  fi
  "$CRAWL_VENV/bin/python" -c "import httpx, parsel, playwright, pandas" >/dev/null 2>&1 \
    && ok "采集环境重建完成" || { bad "采集依赖装不上（多半是网络）"; exit 1; }
fi

# ── 3. 二进制
if [ -x "$PLUGIN_DIR/vendor/runtime/bin/ffmpeg" ] && [ -x "$PLUGIN_DIR/vendor/runtime/bin/ffprobe" ]; then
  ok "ffmpeg/ffprobe 随包在"
else
  bad "缺 vendor/runtime/bin/ffmpeg 或 ffprobe —— 安装包不完整"
fi

# ── 4. 字体
FONT_N=$(ls -1 "$PLUGIN_DIR/vendor/vectcut/fonts" 2>/dev/null | wc -l | tr -d ' ')
if [ "${FONT_N:-0}" -gt 0 ]; then ok "字体 ${FONT_N} 个"; else warn "字体目录为空，模板会出字错"; fi

echo
echo "── 环境体检 ──"
if [ -x "$REPO_ROOT/scripts/doctor-product.sh" ]; then
  bash "$REPO_ROOT/scripts/doctor-product.sh"
else
  warn "没有 doctor-product.sh，跳过体检"
fi
