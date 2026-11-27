# Docker 部署 MediaCrawler API

仓库原先只有 systemd/Nginx 模板（见 `docs/线上部署.md`）。本目录配套的 `Dockerfile` + `docker-compose.yml` 用于在 Linux 服务器上容器化部署。

## 约束

- **单 worker**：`uvicorn --workers 1`（多 worker 会拆散内存中的任务/日志状态）
- **无头模式**：镜像内已将 `HEADLESS=True`，API 默认 `headless: true`
- **登录**：容器内不要用扫码；用 **`login_type: cookie`**，或把本机 `browser_data/` 挂进容器
- **鉴权**：必须设置 `MEDIA_CRAWLER_API_KEY`，否则 `docker compose` 会拒绝启动
- **无官方镜像仓库推送**：默认本地 tag `mediacrawler-api:local`

## 一键脚本（推荐）

仓库提供统一运维脚本（安装 / 更新 / 卸载 / 启停 / 日志）：

```bash
chmod +x deploy/mediacrawler-docker.sh

./deploy/mediacrawler-docker.sh install      # 首次：.env、目录、构建启动、健康检查
./deploy/mediacrawler-docker.sh upgrade     # 等同 update：重建镜像并滚动容器，保留数据
./deploy/mediacrawler-docker.sh status
./deploy/mediacrawler-docker.sh logs -f
./deploy/mediacrawler-docker.sh uninstall          # 停删容器，保留镜像与 data/
./deploy/mediacrawler-docker.sh uninstall --purge  # 连镜像与 data/browser_data 一起删
./deploy/mediacrawler-docker.sh help
```

脚本会解析自身路径，在项目根目录执行 `docker compose`；无需先 `cd` 到特定位置（只要仓库目录结构完整）。

## 服务器步骤

```bash
# 1. 安装 Docker + Compose 插件后，上传/克隆本项目
cd MediaCrawler
cp .env.docker.example .env
# 编辑 .env，设置很长的 MEDIA_CRAWLER_API_KEY

mkdir -p data browser_data

# 2. 构建并后台启动
docker compose up -d --build

# 3. 健康检查
curl http://127.0.0.1:8080/api/health
curl -H "Authorization: Bearer $MEDIA_CRAWLER_API_KEY" http://127.0.0.1:8080/api/tasks
```

公网请再套 Nginx/Caddy HTTPS，反代到 `127.0.0.1:8080`，并保留 WebSocket 的 `Upgrade` / `Connection`（可参考 `deploy/nginx/mediacrawler.conf`）。

## 卷布局

| 宿主机 | 容器 | 用途 |
|--------|------|------|
| `./data` | `/app/data` | 采集结果、`tasks.db`、任务日志 |
| `./browser_data` | `/app/browser_data` | 各平台 Playwright 用户目录（登录态） |

容器内进程 UID 为 **10001**（用户 `mediacrawler`）。若写入 `data/` 报权限错误，在宿主机执行：

```bash
sudo chown -R 10001:10001 data browser_data
```

## 用 Cookie 发起任务

```bash
curl -X POST http://127.0.0.1:8080/api/tasks \
  -H "Authorization: Bearer $MEDIA_CRAWLER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "dy",
    "login_type": "cookie",
    "crawler_type": "search",
    "keywords": "你的关键词",
    "cookies": "把浏览器里复制的 Cookie 粘这里",
    "headless": true,
    "save_option": "jsonl"
  }'
```

也可在本机扫码登录后，把 `browser_data/dy_user_data_dir` 等目录同步到服务器的 `./browser_data/`，再视情况用 cookie/已有登录态。

## 开发者门户

容器启动后打开 `http://<主机>:8080/portal`（详见 `docs/developer-portal.md`）。
环境变量可增加 `MEDIA_CRAWLER_PORTAL_DB`（默认落在 `data/portal.db`）。

## 安全

- 不要把真实 `.env`、Cookie、代理密码提交到 Git
- 防火墙只暴露 80/443；API 端口 8080 建议仅本机或内网
- 未设置 API Key 等于采集接口裸奔——compose 已要求必填
- 请遵守目标平台条款与当地法律法规，仅用于授权/学习场景
