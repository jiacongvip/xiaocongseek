# Xiaocongseek 稳定记忆（2026-11-06）

> 给后续自己 / 助手用的硬结论。改产品只动 fork；跑 web 只走本地编译。

## 产品命名

| 对外显示 | 技术 id（勿乱改） |
|----------|-------------------|
| **Xiaocongseek**（壳 / 桌面工作台） | fork 路径、`dsh` profile |
| **XiaocongAPI**（统一网关 UI） | `newapi`、`NEW_API_TOKEN`、`newApi*`、镜像/包名 |

Logo：透明小葱 PNG（绿底已去），官方资源在 fork；由 studio 提供 `/digital-human-studio/assets/xiaocong-only.png`。

## 路径（硬边界）

- **可改可测 fork**：`/Users/jiacong/Desktop/开发文件/dsh-newapi-fork/`
  - `deepseek-harness/`、`digital-human-studio/`、`harness-newapi-gateway/`、`assets/`、`scripts/start-web.sh`
- **禁止改**：`/Users/jiacong/Desktop/开发文件/数字人混剪工作台/`、`/Applications/DeepSeek Harness.app`
- 旧 monorepo 里仍有原始 harness / studio；New API Docker **当前** compose 指向原目录 gateway 的 data 卷，但**业务/品牌改动只写 fork**。
- VectCutAPI：`/Users/jiacong/VectCutAPI`（本地剪辑，与网关分离）

## 本地服务

| 服务 | 地址 | 说明 |
|------|------|------|
| Xiaocongseek web | `http://127.0.0.1:3080/?token=...` | fork 本地 `pnpm dsh --profile web`；**裸 3080 → 401** |
| XiaocongAPI 控制台 | `http://127.0.0.1:3000` | Docker：`harness-new-api`（`calciumion/new-api`） |
| 工作室配置 | `~/.dsh/digital-human-studio.json` | `newApiBaseUrl` / `newApiToken` / `newApiModels` 等 |
| Web profile | `~/.dsh/profiles/web/` | link fork studio + `cordis.patch.yml` |
| 凭证 | `~/.dsh` credentials | `NEW_API_TOKEN` |
| 管理员口令文件 | `…/harness-newapi-gateway/.local-admin.txt` | 本地开发用；勿外传、勿写进公开文档正文 |
| 备份 | `~/.dsh/backups/` | npx 事故回滚用 |
| Web 日志 | `/tmp/xiaocongseek-web-local.log` | 每次重启后的 `?token=` |

打开本机页：粘贴到 **Mac Chrome**，或 `open -a "Google Chrome" 'URL'`。聊天里的 `127.0.0.1` 链接经常打不开本机。

## 架构一句话

用户只拿 **Base URL + 用户 sk- 令牌** 连 XiaocongAPI；上游 TTS/生图/DeepSeek Key 只放在网关渠道里。桌面/web 壳不存第三方 Key。本地成片仍走 VectCut / 剪映。

## 正确改→编→跑（必遵）

```bash
cd "/Users/jiacong/Desktop/开发文件/dsh-newapi-fork/deepseek-harness"
# 首次 / 缺 native 时：
pnpm run build:native-system   # → native/system/packages/darwin-arm64/bin/system.node

# 改了 client UI 后必须完整 face（禁止只 tsc）：
pnpm exec tsdown --config-loader native --env.DSH_BUILD_FACE client
pnpm run build:web

# 改了 digital-human-studio 后按该包自己的 build（dist + lib/client.js）

# 启动（禁止 npx 当编辑目标）
"/Users/jiacong/Desktop/开发文件/dsh-newapi-fork/scripts/start-web.sh"
# 或：cd deepseek-harness && pnpm dsh --profile web --no-open --port 3080
```

### 绝对不要再做

1. 手改 `~/.npm/_npx/...` 里 minified JS 换品牌  
2. rsync fork 的 client `lib` / web `dist` 进 npx（模块表不一致 → Failed to load plugins / 没输入框）  
3. 部分 client 构建（只 tsc）  
4. 改原 `数字人混剪工作台` 桌面源码做 Xiaocong 品牌  

## XiaocongAPI（:3000）稳定点

- 显示名：Postgres `options.SystemName = XiaocongAPI`（改库 + `docker restart harness-new-api`；脚本在 fork `harness-newapi-gateway/scripts/set-system-name.sh`）
- 对话 503 `model_not_found`：渠道 `models` + `abilities` 里没有对话正在请求的模型名。渠道模型列表必须覆盖壳默认模型（或改默认模型 / 登录自动同步）。
- 登录成功后（studio ≥ 0.8.0）：自动 `GET /v1/models`，写入运行中 profile 的 `llm-pi-ai` → `providers.newapi.models`，并更新默认模型（优先 deepseek-chat → flash → 列表第一项）。空列表保留旧 picker。
- 技术 id 保持 `newapi`；UI 文案用 XiaocongAPI。

## 壳侧模型配置位置

- `~/.dsh/profiles/web/cordis.patch.yml`（及 desktop）：`agent-default-model` + `llm-pi-ai.providers.newapi`
- DeepSeek 官方 OAuth 插件默认关掉，对话走 XiaocongAPI

## 验证清单

- [ ] 无 Failed to load plugins；有输入框  
- [ ] 标题 Xiaocongseek；logo 小葱  
- [ ] `curl -s http://127.0.0.1:3080/digital-human-studio/ping`  
- [ ] 新建会话不报缺 `system.node`  
- [ ] `:3000` 左上角 XiaocongAPI（硬刷新）  
- [ ] `/v1/models` 与模型选择器一致；对话不再因缺渠道 503  

## 相关文件

- 操作 README：`dsh-newapi-fork/README.md`  
- 踩坑详表：`LESSONS-2026-11-06-local-stack.md`  
- 助手 skill：`xiaocongseek-local-dsh-stack`  

## 登录同步模型（2026-11-06 补）
- 删光 Settings 模型提供方后，登录必须 **upsert 完整** `llm-pi-ai.providers.newapi`（displayName / apiKeyEnv / api / baseURL / models），不能只写 models。
- `mergeNewApiModelsIntoPatch` 必须输出 **block YAML**；flow `providers: { ... }` 会导致选择器空白。
- `discoverNewApiPatchPaths` 始终覆盖 web+desktop 文件（即使文本里还没有 `newapi`）。
- studio `0.8.1+`：`syncNewApiModels` / merge 已按上述行为修复。
