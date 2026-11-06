# SETUP — 本地 New API

环境：Jamie Mac（`jiacongdeMac-mini.local`），Docker 已安装。Go 本机未装也不影响（用镜像）。

## 1. 环境文件

```bash
cd "/Users/jiacong/Desktop/开发文件/数字人混剪工作台/harness-newapi-gateway"
cp .env.example .env
# 本地开发可暂用示例密码；任何外网暴露前必须改 POSTGRES_PASSWORD / REDIS_PASSWORD
```

## 2. 启动

```bash
./scripts/start-local.sh
# 或：docker compose up -d
```

- 控制台 / API：http://127.0.0.1:3000  
- 健康：容器 `harness-new-api` healthy 后访问 `/api/status`

首次进入 New API 按官方引导创建管理员，再在后台：

1. 添加 **渠道**，填入各上游 API Key（多 Key 聚合）  
2. 创建用户或自用账号，发 **令牌（Token）**，记下额度  
3. 按需配置模型映射 / 计费倍率  

## 3. 停 / 清

```bash
./scripts/stop-local.sh          # 停容器，保留 data/logs 与 pg volume
docker compose down -v           # 连数据库卷一起删（慎用）
```

## 4. 接到数字人工作室（尚未改插件代码）

约定字段见：

- `config/harness-newapi.stub.json`
- `config/README.md`

合并进 `~/.dsh/digital-human-studio.json` 时：

- **保留** `vectcutBaseUrl`、`vectcutRoot`、草稿相关字段  
- **追加** `newApiBaseUrl`、`newApiToken`、`newApiEnabled`（默认 `false`）  
- 插件读到 `newApiEnabled: true` 再走网关；关闭时行为与现在一致  

冒烟（Token 填好后）：

```bash
curl -s http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer <YOUR_TOKEN>"
```

## 5. 无 Docker 时（备选）

1. 安装 Docker Desktop，或  
2. 克隆源码自行编译：  
   `git clone https://github.com/QuantumNous/new-api.git vendor/new-api`  
   按上游 README 配 SQLite/Postgres 后 `go run` / 发版二进制（本机当前无 `go`，优先 Docker）。

本仓库默认 **不** 强制 clone；需要读源码时再放进 `vendor/new-api`（已在 `.gitignore`）。

## 6. 时区

Compose 内 `TZ=Asia/Shanghai`，与用户区一致。

## 2026-11-06（Asia/Shanghai）授权准备

已启动拉取本地 Docker 镜像；登录接口、手动初始化与令牌流程见 `docs/AUTH.md`。插件登录 UI 尚未实现，不能视为已完成授权。

启动实测：New API `v1.0.0-rc.48` 的 `/api/status` 已成功；首次管理员尚未初始化，见 AUTH.md 实测记录。
