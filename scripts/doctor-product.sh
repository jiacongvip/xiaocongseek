#!/usr/bin/env bash
# 小葱工作室 · 环境体检（只读：不安装、不修改、不启动任何东西）
#
# 用途：换一台新电脑时先跑这个，看清"缺什么、怎么补"。
# 用法：
#   bash scripts/doctor-product.sh
#   XIAOCONG_HOME=/Users/xxx/XiaocongStudio bash scripts/doctor-product.sh
#
# 退出码：0 全部就绪；1 有致命缺失；2 仅警告（能跑但功能残缺）

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

PASS=0; WARN=0; FAIL=0
ok()   { printf "  \033[32m✅\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
warn() { printf "  \033[33m⚠️ \033[0m %s\n" "$1"; WARN=$((WARN+1)); }
bad()  { printf "  \033[31m❌\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
sec()  { printf "\n\033[1m%s\033[0m\n" "$1"; }
hint() { printf "      → %s\n" "$1"; }

CONFIG="$HOME/.dsh/digital-human-studio.json"
CFG_GET() {
  command -v python3 >/dev/null 2>&1 || return 0
  python3 - "$CONFIG" "$1" <<'PY' 2>/dev/null
import json,os,sys
p=os.path.expanduser(sys.argv[1])
if not os.path.isfile(p): raise SystemExit(0)
d=json.load(open(p))
v=d.get(sys.argv[2])
if isinstance(v,str) and v.strip(): print(os.path.expanduser(v))
PY
}

# ── 产品根：环境变量 > 配置 productRoot > 引擎目录的上级
PRODUCT_HOME="${XIAOCONG_HOME:-}"
[ -z "$PRODUCT_HOME" ] && PRODUCT_HOME="$(CFG_GET productRoot)"
VECTCUT_ROOT="${VECTCUT_ROOT:-$(CFG_GET vectcutRoot)}"
[ -z "$VECTCUT_ROOT" ] && VECTCUT_ROOT="$HOME/VectCutAPI"
PARENT_DIR="$(dirname "$VECTCUT_ROOT")"
LOOSE_LAYOUT=0
if [ -z "$PRODUCT_HOME" ]; then
  if [ -d "$VECTCUT_ROOT" ] && [ "$PARENT_DIR" != "$HOME" ]; then
    PRODUCT_HOME="$PARENT_DIR"
  else
    PRODUCT_HOME="$HOME/XiaocongStudio"
    LOOSE_LAYOUT=1
  fi
fi

# ── 采集根：环境变量 > 配置 mediaCrawlerRoot > 候选目录
MEDIACRAWLER_ROOT="${MEDIACRAWLER_ROOT:-$(CFG_GET mediaCrawlerRoot)}"
if [ -z "$MEDIACRAWLER_ROOT" ]; then
  for c in "$PRODUCT_HOME/MediaCrawler" "$HOME/Desktop/开发文件/MediaCrawler" "$HOME/MediaCrawler"; do
    if [ -d "$c" ]; then MEDIACRAWLER_ROOT="$c"; break; fi
  done
fi
[ -z "$MEDIACRAWLER_ROOT" ] && MEDIACRAWLER_ROOT="$PRODUCT_HOME/MediaCrawler"

PUBLISH_RUNTIME="${PUBLISH_RUNTIME:-$HOME/.dsh/publish-studio/runtime}"
DATA_HOME="${DATA_HOME:-$HOME/.dsh}"

# ── PATH 补充常见位置
for d in "$HOME/.local/bin" "$PRODUCT_HOME/runtime/bin" "/opt/homebrew/bin" "/usr/local/bin"; do
  if [ -d "$d" ]; then case ":$PATH:" in *":$d:"*) ;; *) PATH="$PATH:$d";; esac; fi
done
export PATH

echo "小葱工作室 · 环境体检"
echo "时间：$(date '+%Y-%m-%d %H:%M:%S')"
echo "产品根：$PRODUCT_HOME"
if [ "${LOOSE_LAYOUT:-0}" = "1" ]; then
  echo "布局：引擎现在散装在家目录，还没收进产品根（体检照规划位置算）"
fi
echo "系统：$(uname -s) $(uname -m) · macOS $(sw_vers -productVersion 2>/dev/null || echo '?')"

# ── 1. 基础运行时
sec "1. 基础运行时"
if command -v node >/dev/null 2>&1; then
  NODE_V=$(node -v 2>/dev/null | sed 's/^v//')
  NODE_MAJOR=$(printf '%s' "$NODE_V" | cut -d. -f1)
  if [ "${NODE_MAJOR:-0}" -ge 22 ] 2>/dev/null; then ok "node v${NODE_V}（≥22）"
  else bad "node v${NODE_V} 太旧，需要 ≥22"; hint "内置 node24 到 $PRODUCT_HOME/runtime/node，或 brew install node@24"; fi
  NODE_PATH_ACT=$(command -v node)
  if [ "${NODE_MAJOR:-0}" -ge 22 ] 2>/dev/null; then
    if [ -x "$PRODUCT_HOME/runtime/node/bin/node" ] && [ "$NODE_PATH_ACT" = "$PRODUCT_HOME/runtime/node/bin/node" ]; then
      ok "node 来自产品自带"
    else
      warn "node 来自系统：$NODE_PATH_ACT"; hint "分发时内置 node，避免用户机器没装"
    fi
  fi
else
  bad "找不到 node"; hint "产品要内置 node（推荐单文件二进制）"
fi

if command -v python3 >/dev/null 2>&1; then
  PY_V=$(python3 -V 2>&1 | awk '{print $2}')
  case "$PY_V" in
    3.1[2-9]*) ok "python3 ${PY_V}（够用）" ;;
    *) warn "python3 ${PY_V}，引擎跑在 3.12（uv 装的独立解释器）"; hint "curl -LsSf https://astral.sh/uv/install.sh | sh";;
  esac
else
  bad "找不到 python3"; hint "装 python-build-standalone 或 uv"
fi

if command -v uv >/dev/null 2>&1; then ok "uv $(uv --version 2>/dev/null | awk '{print $2}')（管三套 Python）"
else warn "没有 uv（可改用内置解释器 + venv，不装 uv 也能跑）"; fi

FREE_MB=$(python3 -c "import shutil;print(int(shutil.disk_usage('/').free/1e6))" 2>/dev/null || echo "")
if [ -n "${FREE_MB:-}" ]; then
  if [ "${FREE_MB}" -ge 12000 ]; then ok "磁盘剩余 $((FREE_MB/1000))GB（够装全套）"
  elif [ "${FREE_MB}" -ge 3000 ]; then warn "磁盘只剩 ${FREE_MB}MB：全套依赖+模型要 8-10GB"
  else bad "磁盘只剩 ${FREE_MB}MB：连一次成片输出都可能写失败"; hint "先清盘（~/.cache、旧渲染输出、Xcode DerivedData）"; fi
else warn "读不到磁盘剩余空间"; fi

# ── 2. 渲染引擎（9001）
sec "2. 渲染引擎 VectCut（9001）"
if [ -d "$VECTCUT_ROOT" ]; then ok "引擎目录：${VECTCUT_ROOT}"
else bad "找不到引擎目录：${VECTCUT_ROOT}"; hint "把 VectCutAPI 放进产品根，或设 vectcutRoot"; fi

VENV_PY="$VECTCUT_ROOT/.venv/bin/python"
if [ -x "$VENV_PY" ]; then
  if PYTHONPATH= "$VENV_PY" -c "import flask, PIL, requests" >/dev/null 2>&1; then ok "引擎依赖齐（flask / Pillow / requests）"
  else bad "引擎 venv 缺依赖"; hint "cd $VECTCUT_ROOT && .venv/bin/pip install -r requirements.txt Pillow faster-whisper"; fi
  if PYTHONPATH= "$VENV_PY" -c "import faster_whisper" >/dev/null 2>&1; then ok "语音转写依赖在（faster-whisper）"
  else warn "缺 faster-whisper：语音转字幕不可用"; hint ".venv/bin/pip install faster-whisper"; fi
  if [ -L "$VENV_PY" ]; then
    REAL=$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$VENV_PY" 2>/dev/null)
    case "$REAL" in
      "$VECTCUT_ROOT"/*) ok "venv 解释器在产品目录内";;
      *) warn "venv 解释器在系统/uv 目录：$REAL"; hint "打包用产品内 python-build-standalone 重建 venv";;
    esac
  fi
else
  bad "引擎 venv 缺失：$VENV_PY"; hint "python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt"
fi

if [ -f "$VECTCUT_ROOT/xcy_render.py" ] && [ -f "$VECTCUT_ROOT/capcut_server.py" ]; then ok "引擎源码在（xcy_render / capcut_server）"
else bad "引擎源码不全：缺 xcy_render.py 或 capcut_server.py"; fi

# ffmpeg：渲染命门
FF=""
for c in "$PRODUCT_HOME/runtime/bin/ffmpeg" "$VECTCUT_ROOT/runtime/bin/ffmpeg" "/opt/homebrew/bin/ffmpeg" "/usr/local/bin/ffmpeg"; do
  if [ -x "$c" ]; then FF="$c"; break; fi
done
if [ -z "$FF" ] && command -v ffmpeg >/dev/null 2>&1; then FF=$(command -v ffmpeg); fi
if [ -n "$FF" ]; then
  ok "ffmpeg：$FF"
  if [ -L "$FF" ]; then
    L=$(readlink "$FF")
    case "$L" in
      *Library/Python*|*site-packages*) warn "ffmpeg 是软链到 Python 包目录：${L}（现在能跑，换机必丢）"
        hint "把 ffmpeg/ffprobe 二进制本体放进 $PRODUCT_HOME/runtime/bin/";;
    esac
  fi
  if "$FF" -version >/dev/null 2>&1; then ok "ffmpeg 可执行"; else bad "ffmpeg 存在但跑不起来"; fi
  FFDIR=$(dirname "$FF")
  if [ -x "$FFDIR/ffprobe" ]; then ok "ffprobe 在（同目录）"
  else warn "同目录没有 ffprobe：时长/质检读不到"; hint "把 ffprobe 和 ffmpeg 放一起"; fi
else
  bad "找不到 ffmpeg（没有它一条片子都渲染不出来）"; hint "内置 ffmpeg/ffprobe 到 $PRODUCT_HOME/runtime/bin/"
fi

# ── 3. 采集（MediaCrawler）
sec "3. 采集 MediaCrawler（插件内自带）"
PLUGIN_DIR="${SCRIPT_DIR}/../digital-human-studio"
BUNDLED_MC="${PLUGIN_DIR}/vendor/media-crawler"
BUNDLED_PY="${PLUGIN_DIR}/vendor/venv/bin/python"

if [ -f "${BUNDLED_MC}/main.py" ]; then
  ok "采集代码随插件走：${BUNDLED_MC}"
  if [ -x "$BUNDLED_PY" ]; then
    if PYTHONPATH= "$BUNDLED_PY" -c "import httpx, parsel, playwright, pydantic" >/dev/null 2>&1; then
      ok "采集依赖随插件走（httpx/parsel/playwright）"
    else
      warn "vendor/venv 缺依赖"; hint "插件里点「初始化采集环境」，或跑 uv pip install -r vendor/media-crawler/requirements.txt"
    fi
  else
    warn "还没建 vendor/venv"; hint "插件里点「初始化采集环境」（约 300MB，需联网）"
  fi
else
  warn "插件里没有 vendor/media-crawler"; hint "重新打包插件，或设置 mediaCrawlerRoot 指向外部 MediaCrawler"
  if [ -d "$MEDIACRAWLER_ROOT" ]; then
    warn "回退用外部目录：${MEDIACRAWLER_ROOT}（换机就丢）"
  fi
fi

COOKIE="${BUNDLED_MC}/.douyin_cookies.txt"
if [ -f "$COOKIE" ]; then
  MT=$(stat -f %m "$COOKIE" 2>/dev/null || echo 0)
  AGE_D=$(( ( $(date +%s) - MT ) / 86400 ))
  if [ "${AGE_D}" -gt 20 ]; then warn "抖音 cookie 已 ${AGE_D} 天，大概过期"; hint "采集前重新扫码一次"
  else ok "抖音 cookie ${AGE_D} 天前保存"; fi
else
  ok "采集登录态为空（首次使用扫码一次，属于正常状态）"
fi

# ── 4. 发布（publish-studio runtime）
sec "4. 发布 publish-studio"
if [ -d "$PUBLISH_RUNTIME/venv" ]; then
  if PYTHONPATH= "$PUBLISH_RUNTIME/venv/bin/python" -c "import playwright" >/dev/null 2>&1; then ok "playwright 在"
  else bad "runtime venv 缺 playwright"; hint "pip install playwright && playwright install chromium"; fi
  REAL_PS=$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$PUBLISH_RUNTIME/venv/bin/python" 2>/dev/null)
  case "$REAL_PS" in
    "$HOME/.dsh"/*) ok "发布运行时在 ~/.dsh 内（用户数据，不随产品走）";;
    "$HOME/.local/share/uv"/*) warn "发布 venv 用的是 uv 解释器（换机要重装）";;
    *) warn "发布解释器在：$REAL_PS";;
  esac
else
  warn "没有发布运行时：$PUBLISH_RUNTIME/venv"; hint "跑一次 publish-studio 的运行时安装"
fi

CHROME=""
if [ -d "$PUBLISH_RUNTIME/ms-playwright" ]; then
  CHROME=$(find "$PUBLISH_RUNTIME/ms-playwright" -maxdepth 4 \( -name "Chromium.app" -o -name "chrome" \) 2>/dev/null | head -1)
fi
if [ -n "${CHROME:-}" ]; then ok "Chromium 在：$CHROME"
else warn "没下 Chromium：发布弹不出浏览器"; hint "PLAYWRIGHT_BROWSERS_PATH=$PUBLISH_RUNTIME/ms-playwright playwright install chromium"; fi

if [ -f "$DATA_HOME/publish-studio/auth-settings.json" ]; then
  ALLOW=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.dsh/publish-studio/auth-settings.json'))).get('allowPublish'))" 2>/dev/null)
  if [ "$ALLOW" = "True" ]; then ok "允许发布已打开（allowPublish=true）"; else warn "allowPublish 未开：发布会 blocked"; fi
else
  warn "没有发布设置：第一次发布前要先配"
fi

if [ -d "$DATA_HOME/publish-studio/spaces" ]; then
  N_ACC=$(find "$DATA_HOME/publish-studio/spaces" -maxdepth 2 -name accounts.json 2>/dev/null | wc -l | tr -d ' ')
  if [ "${N_ACC:-0}" -gt 0 ]; then ok "发布账号配置在（${N_ACC} 个空间）"; else warn "没有账号配置：发布前要先绑"; fi
else
  warn "没有账号目录：发布前要先绑"
fi

# ── 5. 字体与模型
sec "5. 字体与模型"
FONT_DIR="$VECTCUT_ROOT/fonts"
if [ -d "$FONT_DIR" ]; then
  N_FONT=$(ls "$FONT_DIR" 2>/dev/null | wc -l | tr -d ' ')
  ok "字体目录 ${N_FONT} 个文件"
  BIZ=$(ls "$FONT_DIR" 2>/dev/null | grep -Ei "lantinghei|hiragino|STFANGSO|STSong|Kaiti|Wawa|Weibei|Baoli|Libian|Hannotate|HanziPen|Yuanti|Xingkai|LingWai|Songti" | wc -l | tr -d ' ')
  if [ "${BIZ:-0}" -gt 0 ]; then
    warn "其中 ${BIZ} 个是商业/系统字体（方正/华文/冬青等）"; hint "分发前确认授权；可商用替代：思源宋/黑（OFL）"
  else
    ok "没检测到商业字体"
  fi
else
  warn "没有字体目录：模板出字会错"
fi

HF="$HOME/.cache/huggingface"
if [ -d "$HF" ]; then
  SZ=$(du -sh "$HF" 2>/dev/null | awk '{print $1}')
  ok "转写模型在 ~/.vectcut（不进安装包）"; hint "首次点“语音转字幕”才下载（small 约 480MB）"
else
  warn "还没下载转写模型：首次点“语音转字幕”会自动拉（small 约 480MB），属正常"
fi

# ── 6. 数据与工程
sec "6. 数据与工程"
if [ -d "$DATA_HOME" ]; then ok "数据目录：${DATA_HOME}"; else warn "数据目录不存在（首次启动会自动建）"; fi
if [ -f "$CONFIG" ]; then ok "主配置：${CONFIG}"; else warn "没有主配置：首次启动会要求选目录"; fi
if [ -f "$CONFIG" ]; then
  python3 - "$CONFIG" <<'PY' 2>/dev/null || true
import json,os,sys
p=os.path.expanduser(sys.argv[1])
d=json.load(open(p))
for k,v in d.items():
    if isinstance(v,str) and v.startswith('/') and not os.path.exists(v):
        print(f"  \033[33m⚠️ \033[0m 配置里的 {k} 指向不存在的路径：{v}")
PY
fi

JY="$HOME/Movies/JianyingPro/User Data/Projects/com.lveditor.draft"
if [ -d "$JY" ]; then ok "剪映草稿目录在（草稿页可用）"
else warn "没装剪映/没有草稿目录：草稿页要隐藏，渲染不受影响（走 9001）"; fi

# ── 7. 服务状态
sec "7. 当前服务状态（可选）"
for p in 3080 9001; do
  if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; then ok "端口 ${p} 有服务在跑"
  else warn "端口 ${p} 没服务（没启动不算错误）"; fi
done

# ── 汇总
sec "汇总"
echo "  通过 $PASS · 警告 $WARN · 失败 $FAIL"
echo "  产品根：$PRODUCT_HOME"
echo "  引擎：$VECTCUT_ROOT"
if [ -f "${BUNDLED_MC}/main.py" ]; then echo "  采集：${BUNDLED_MC}（插件自带）"; else echo "  采集：$MEDIACRAWLER_ROOT（外部）"; fi
if [ "$FAIL" -gt 0 ]; then
  echo "  结论：这台机器还跑不起来，先补 ❌ 项。"; exit 1
elif [ "$WARN" -gt 0 ]; then
  echo "  结论：能跑，但有功能残缺（见 ⚠️ 项）。"; exit 2
else
  echo "  结论：全部就绪。"; exit 0
fi
