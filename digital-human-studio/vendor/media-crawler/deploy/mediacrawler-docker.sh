#!/usr/bin/env bash
# MediaCrawler Docker 一键运维：安装 / 更新 / 卸载 / 启停 / 日志
# 用法见：./deploy/mediacrawler-docker.sh help
set -euo pipefail

APP_UID="${MEDIACRAWLER_UID:-10001}"
APP_GID="${MEDIACRAWLER_GID:-10001}"
COMPOSE_IMAGE="${MEDIACRAWLER_IMAGE:-mediacrawler-api:local}"
HEALTH_URL="${MEDIACRAWLER_HEALTH_URL:-http://127.0.0.1:8080/api/health}"
HEALTH_RETRIES="${MEDIACRAWLER_HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${MEDIACRAWLER_HEALTH_INTERVAL:-2}"

# ---------- 路径：脚本在 deploy/ 下，项目根为其上级 ----------
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_PATH}/docker-compose.yml" && -f "${SCRIPT_PATH}/Dockerfile" ]]; then
  ROOT_DIR="${SCRIPT_PATH}"
elif [[ -f "${SCRIPT_PATH}/../docker-compose.yml" && -f "${SCRIPT_PATH}/../Dockerfile" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_PATH}/.." && pwd)"
else
  echo "错误: 找不到 docker-compose.yml / Dockerfile（请把本脚本放在仓库的 deploy/ 或项目根目录）" >&2
  exit 1
fi
cd "${ROOT_DIR}"

COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
ENV_FILE="${ROOT_DIR}/.env"
ENV_EXAMPLE="${ROOT_DIR}/.env.docker.example"

usage() {
  cat <<'EOF'
MediaCrawler Docker 运维脚本

用法:
  ./deploy/mediacrawler-docker.sh <命令> [选项]

命令:
  install              首次安装：准备 .env / 目录，构建并启动，健康检查
  update | upgrade     用当前仓库 Dockerfile 重新构建并重建容器（保留 data/browser_data）
  uninstall [--purge]  停止并删除容器；默认保留镜像与数据。加 --purge 同时删除镜像与 data/browser_data
  start                启动已有容器
  stop                 停止容器
  restart              重启容器
  status               查看 compose 状态与健康检查
  logs [-f] [N]        查看日志；-f 跟随；N 为 --tail 行数（默认 100）
  help                 显示本说明

环境变量（可选）:
  MEDIACRAWLER_UID / MEDIACRAWLER_GID   数据目录属主（默认 10001）
  MEDIACRAWLER_HEALTH_URL              健康检查 URL
  MEDIACRAWLER_IMAGE                   卸载时删除的镜像名（默认 mediacrawler-api:local）

示例:
  ./deploy/mediacrawler-docker.sh install
  ./deploy/mediacrawler-docker.sh upgrade
  ./deploy/mediacrawler-docker.sh logs -f
  ./deploy/mediacrawler-docker.sh uninstall
  ./deploy/mediacrawler-docker.sh uninstall --purge
EOF
}

log()  { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
warn() { printf '[%s] 警告: %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }
die()  { printf '[%s] 错误: %s\n' "$(date '+%H:%M:%S')" "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "未找到命令: $1"
}

# 检测 Docker + Compose v2（docker compose）
check_docker() {
  need_cmd docker
  if ! docker info >/dev/null 2>&1; then
    die "Docker 未运行或当前用户无权限（可尝试加入 docker 组或使用 sudo）"
  fi
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose -f "${COMPOSE_FILE}")
  elif command -v docker-compose >/dev/null 2>&1; then
    warn "未检测到 Compose V2 插件，回退使用 docker-compose"
    COMPOSE=(docker-compose -f "${COMPOSE_FILE}")
  else
    die "需要 Docker Compose V2（docker compose）或 docker-compose"
  fi
}

compose() {
  "${COMPOSE[@]}" "$@"
}

# 从 .env 加载 KEY 到当前 shell（仅导出 MEDIA_CRAWLER_API_KEY）
load_api_key_from_env_file() {
  if [[ -f "${ENV_FILE}" ]]; then
    # shellcheck disable=SC1090
    set -a
    # 只解析 KEY=VALUE 行，忽略注释
    # shellcheck disable=SC1091
    while IFS= read -r line || [[ -n "${line}" ]]; do
      case "${line}" in
        ''|\#*) continue ;;
        MEDIA_CRAWLER_API_KEY=*)
          export "${line?}"
          ;;
      esac
    done < "${ENV_FILE}"
    set +a
  fi
}

generate_api_key() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import secrets; print(secrets.token_hex(32))'
  else
    # 弱回退：时间戳+随机
    printf 'mc-%s-%s' "$(date +%s)" "${RANDOM}${RANDOM}${RANDOM}"
  fi
}

is_placeholder_key() {
  local key="${1:-}"
  [[ -z "${key}" \
    || "${key}" == "replace-with-a-long-random-secret" \
    || "${key}" == "changeme" \
    || "${key}" == "your-api-key" ]]
}

ensure_env() {
  if [[ ! -f "${ENV_EXAMPLE}" ]]; then
    die "缺少 ${ENV_EXAMPLE}"
  fi

  if [[ ! -f "${ENV_FILE}" ]]; then
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    log "已从 .env.docker.example 创建 .env"
  fi

  local current
  current="$(grep -E '^MEDIA_CRAWLER_API_KEY=' "${ENV_FILE}" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)"
  current="${current%\"}"
  current="${current#\"}"
  current="${current%\'}"
  current="${current#\'}"

  if is_placeholder_key "${current}"; then
    local new_key
    if [[ -t 0 ]]; then
      printf '未设置有效的 MEDIA_CRAWLER_API_KEY。\n'
      printf '  [Enter] 自动生成   或直接粘贴自定义 Key: '
      local input=""
      read -r input || true
      if [[ -n "${input}" ]]; then
        new_key="${input}"
      else
        new_key="$(generate_api_key)"
        log "已自动生成 API Key"
      fi
    else
      new_key="$(generate_api_key)"
      log "非交互环境：已自动生成 MEDIA_CRAWLER_API_KEY"
    fi

    if grep -qE '^MEDIA_CRAWLER_API_KEY=' "${ENV_FILE}"; then
      # 跨平台 sed：写临时文件
      local tmp
      tmp="$(mktemp)"
      sed "s|^MEDIA_CRAWLER_API_KEY=.*|MEDIA_CRAWLER_API_KEY=${new_key}|" "${ENV_FILE}" > "${tmp}"
      mv "${tmp}" "${ENV_FILE}"
    else
      printf '\nMEDIA_CRAWLER_API_KEY=%s\n' "${new_key}" >> "${ENV_FILE}"
    fi
    log "API Key 已写入 .env（请勿提交到 Git）"
  else
    log ".env 中已有 MEDIA_CRAWLER_API_KEY"
  fi

  # 导出供 compose 插值
  load_api_key_from_env_file
  if is_placeholder_key "${MEDIA_CRAWLER_API_KEY:-}"; then
    die ".env 中 MEDIA_CRAWLER_API_KEY 仍无效"
  fi
  export MEDIA_CRAWLER_API_KEY
}

ensure_dirs() {
  mkdir -p "${ROOT_DIR}/data" "${ROOT_DIR}/browser_data"
  if chown -R "${APP_UID}:${APP_GID}" "${ROOT_DIR}/data" "${ROOT_DIR}/browser_data" 2>/dev/null; then
    log "已设置 data/ browser_data/ 属主为 ${APP_UID}:${APP_GID}"
  elif command -v sudo >/dev/null 2>&1 && sudo -n chown -R "${APP_UID}:${APP_GID}" "${ROOT_DIR}/data" "${ROOT_DIR}/browser_data" 2>/dev/null; then
    log "已通过 sudo 设置目录属主 ${APP_UID}:${APP_GID}"
  else
    warn "无法 chown 到 ${APP_UID}:${APP_GID}（无权限）。若容器写 data 失败，请手动执行:"
    warn "  sudo chown -R ${APP_UID}:${APP_GID} data browser_data"
  fi
}

wait_health() {
  local i
  log "等待健康检查 ${HEALTH_URL} ..."
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
      log "健康检查通过"
      curl -fsS "${HEALTH_URL}" || true
      echo
      return 0
    fi
    sleep "${HEALTH_INTERVAL}"
  done
  warn "健康检查超时。请执行: $0 logs"
  compose ps || true
  return 1
}

cmd_install() {
  check_docker
  [[ -f "${COMPOSE_FILE}" ]] || die "缺少 docker-compose.yml"
  [[ -f "${ROOT_DIR}/Dockerfile" ]] || die "缺少 Dockerfile"
  ensure_env
  ensure_dirs
  log "构建并启动（docker compose up -d --build）..."
  compose up -d --build
  wait_health || true
  log "安装完成。常用命令:"
  log "  $0 status | logs -f | upgrade | uninstall"
}

cmd_update() {
  check_docker
  ensure_env
  ensure_dirs
  log "拉取基础镜像（如有）并重建..."
  # --pull 更新 FROM 基础镜像；业务代码来自本地 Dockerfile COPY
  if compose build --help 2>&1 | grep -q -- '--pull'; then
    compose build --pull
  else
    compose build
  fi
  log "用新镜像重建容器（保留 volumes）..."
  compose up -d --force-recreate --remove-orphans
  wait_health || true
  log "更新完成（data/ 与 browser_data/ 已保留）"
}

cmd_uninstall() {
  local purge=0
  if [[ "${1:-}" == "--purge" ]]; then
    purge=1
  elif [[ -n "${1:-}" ]]; then
    die "未知选项: $1（仅支持 --purge）"
  fi

  check_docker

  if [[ "${purge}" -eq 1 ]]; then
    if [[ -t 0 ]]; then
      printf '将删除容器、镜像 %s，以及 data/、browser_data/。确认？[y/N] ' "${COMPOSE_IMAGE}"
      local ans=""
      read -r ans || true
      [[ "${ans}" == "y" || "${ans}" == "Y" ]] || die "已取消"
    else
      log "非交互 + --purge：继续删除容器/镜像/数据目录"
    fi
  fi

  log "停止并删除 compose 服务（容器/网络）..."
  compose down --remove-orphans || true

  if [[ "${purge}" -eq 1 ]]; then
    if docker image inspect "${COMPOSE_IMAGE}" >/dev/null 2>&1; then
      log "删除镜像 ${COMPOSE_IMAGE}"
      docker rmi "${COMPOSE_IMAGE}" || warn "镜像删除失败（可能仍被引用）"
    else
      log "镜像 ${COMPOSE_IMAGE} 不存在，跳过"
    fi
    log "删除数据目录 data/ 与 browser_data/ ..."
    rm -rf "${ROOT_DIR}/data" "${ROOT_DIR}/browser_data"
    log "已 purge：容器 + 镜像 + 数据目录（.env 仍保留，如需删除请手动 rm .env）"
  else
    log "已卸载容器；镜像与 data/ browser_data/ 已保留"
    log "若要连镜像和数据一起删: $0 uninstall --purge"
  fi
}

cmd_start() {
  check_docker
  ensure_env
  compose start 2>/dev/null || compose up -d
  wait_health || true
}

cmd_stop() {
  check_docker
  compose stop
  log "已停止"
}

cmd_restart() {
  check_docker
  ensure_env
  compose restart
  wait_health || true
}

cmd_status() {
  check_docker
  compose ps
  echo
  if curl -fsS "${HEALTH_URL}" 2>/dev/null; then
    echo
    log "API 健康: OK"
  else
    warn "API 健康检查失败或未启动"
  fi
}

cmd_logs() {
  check_docker
  local follow=0
  local tail_n=100
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -f|--follow) follow=1; shift ;;
      -n|--tail)
        tail_n="${2:?需要行数}"
        shift 2
        ;;
      '' ) shift ;;
      *)
        if [[ "$1" =~ ^[0-9]+$ ]]; then
          tail_n="$1"
          shift
        else
          die "logs 未知参数: $1"
        fi
        ;;
    esac
  done
  if [[ "${follow}" -eq 1 ]]; then
    compose logs -f --tail="${tail_n}"
  else
    compose logs --tail="${tail_n}"
  fi
}

main() {
  local cmd="${1:-help}"
  shift || true
  case "${cmd}" in
    install)            cmd_install "$@" ;;
    update|upgrade)     cmd_update "$@" ;;
    uninstall|remove)   cmd_uninstall "$@" ;;
    start)              cmd_start "$@" ;;
    stop)               cmd_stop "$@" ;;
    restart)            cmd_restart "$@" ;;
    status|ps)          cmd_status "$@" ;;
    logs)               cmd_logs "$@" ;;
    help|-h|--help)     usage ;;
    *)
      usage >&2
      die "未知命令: ${cmd}"
      ;;
  esac
}

main "$@"
