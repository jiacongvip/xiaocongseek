# Xiaocongseek 稳定记忆（2026-11-06）

> 给后续自己 / 助手用的硬结论。改产品只动 fork；跑 web 只走本地编译。
> 数字人工作台产品细节（公司空间 / 档案 / 素材柜 / 记录 / 预览）见 [`docs/2026-11-08-数字人工作台/记忆文档.md`](./docs/2026-11-08-数字人工作台/记忆文档.md)。插件当前 **0.9.6**。

## 产品命名

| 对外显示 | 技术 id（勿乱改） |
|----------|-------------------|
| **Xiaocongseek**（壳 / 桌面工作台） | fork 路径、`dsh` profile |
| **XiaocongAPI**（统一网关 UI） | `newapi`、`NEW_API_TOKEN`、`newApi*`、镜像/包名 |

Logo：透明小葱 PNG（绿底已去），官方资源在 fork；由 studio 提供 `/digital-human-studio/assets/xiaocong-only.png`。

## 路径（硬边界）

- **产品根目录**：`/Users/jiacong/Desktop/开发文件/小葱/`
- **可改可测 fork**：`/Users/jiacong/Desktop/开发文件/小葱/dsh-newapi-fork/`
  - `deepseek-harness/`、`digital-human-studio/`、`harness-newapi-gateway/`、`assets/`、`scripts/start-web.sh`
- **禁止改**：`/Users/jiacong/Desktop/开发文件/小葱/数字人混剪工作台/`、`/Applications/DeepSeek Harness.app`
- 旧 monorepo 里仍有原始 harness / studio；New API Docker **当前** data/logs 挂在 `小葱/数字人混剪工作台/harness-newapi-gateway/`，但**业务/品牌改动只写 fork**。
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
cd "/Users/jiacong/Desktop/开发文件/小葱/dsh-newapi-fork/deepseek-harness"
# 首次 / 缺 native 时：
pnpm run build:native-system   # → native/system/packages/darwin-arm64/bin/system.node

# 改了 client UI 后必须完整 face（禁止只 tsc）：
pnpm exec tsdown --config-loader native --env.DSH_BUILD_FACE client
pnpm run build:web

# 改了 digital-human-studio 后按该包自己的 build（dist + lib/client.js）

# 启动（禁止 npx 当编辑目标）
"/Users/jiacong/Desktop/开发文件/小葱/dsh-newapi-fork/scripts/start-web.sh"
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

## 账号余额（2026-11-07 补）

- `GET /digital-human-studio/account/balance`：只读，带 Origin/Host 同源校验；studio 用保存的 sk- 调 `/api/usage/token/` + `/api/status`，15s 缓存，不返回令牌。
- 路径必须带尾斜杠：`/api/usage/token` 会 301，而 `newApiRequest` 的 `redirect:'error'` 会直接失败。
- 换算：`quota_display_type` / `quota_per_unit` / `usd_exchange_rate`；账户余额 `data.user_quota.total_available`，Key 余额 `data.total_available`。
- 壳侧仅当 `newApiSignedIn` 时覆盖 `details.balance`；请求失败保留「余额不可用」链接。
- 本地 :3000 实测 `/api/usage/token` 同时返回 `total_available` 与 `user_quota.total_available`。

## 数字人接入 XiaocongAPI（2026-11-07）

- 源码副本：`/Users/jiacong/Desktop/开发文件/小葱/xiaocongapi-new-api`（QuantumNous/new-api @ 7061447 / v1.0.0-rc.48）
- 任务插件：`plugins/tasks/xiaocong-digital-human/plugin.js`（已热上传到本地 `:3000`，无需重编镜像）
- 渠道：ID 2 `Xiaocong Digital Human (PHP)`，type 61，Base `http://host.docker.internal`，key=`aid|session_id`，`setting={"task_plugin_key":"xiaocong-digital-human"}`，模型 `xdh-avatar-video` / `xdh-audio` / `xdh-image` / `xdh-avatar-clone` / `xdh-voice-clone`
- 调用：`POST /v1/tasks/xiaocong-digital-human` 创建，`GET /v1/tasks/{task_id}` 轮询；studio 用用户 sk- 调 XiaocongAPI，不直连 PHP
- 侧栏面板：`数字人生成`（客户端注册在 `ui-settings-account`，走 studio 路由）；原有的 `数字人工作室` 是 VectCut 混剪台
- 定价：未配置时返回 `model_price_error`；在「系统设置 → 分组与模型定价设置」配 `xiaocong-digital-human::xdh-*`
- 渠道 key 当前是 aid=62 演示会员会话（会过期）；正式需专用服务会员 + 会话刷新

## 壳侧模型配置位置

- `~/.dsh/profiles/web/cordis.patch.yml`（及 desktop）：`agent-default-model` + `llm-pi-ai.providers.newapi`
- DeepSeek 官方 OAuth 插件默认关掉，对话走 XiaocongAPI

## 验证清单

- [ ] 无 Failed to load plugins；有输入框  
- [ ] 标题 Xiaocongseek；logo 小葱  
- [ ] `curl -s http://127.0.0.1:3080/digital-human-studio/ping`  
- [ ] 新建会话不报缺 `system.node`  
- [ ] `:3000` 左上角 XiaocongAPI（硬刷新）  
- [ ] 设置 → 账号与余额显示金额（非「余额不可用」）  
- [ ] `/v1/models` 与模型选择器一致；对话不再因缺渠道 503  

## 相关文件

- 操作 README：`dsh-newapi-fork/README.md`  
- 踩坑详表：`LESSONS-2026-11-06-local-stack.md`  
- 助手 skill：`xiaocongseek-local-dsh-stack`  

## 2026-11-08 — 数字人工作台（0.9.6）

- 完整接力文档：`docs/2026-11-08-数字人工作台/记忆文档.md`
- 左侧：主页 / 公司。公司按钮：档案、素材、数字人、音频、图片、成片。
- 一家公司一块本地盘：`~/.dsh/digital-human-assets`（默认）或 `~/.dsh/spaces/<id>/`。档案、history.json、`materials/{product,store,logo}` 都在这家目录。
- 对话按会话锁公司（`sessionSpaces`）。空档案第一轮要先收档案再写口播。
- 对话里出的数字人视频必须进该公司记录（0.9.5）。素材柜可看可传，混剪仍是 `dh_add_video` 追加，不是剪映换轨（0.9.6）。
- 工作台 mp4 预览走 `ui-sidebar-documentpreview` media + `/api/file`（约 50MB）。
- 重启：只杀 **3080 监听 PID**，或用 `scripts/start-web.sh`。不要 `pkill -f "dsh --profile web"`。
- 只改面板：`packages/client/ui-settings-account` 里 `pnpm bundle`。只改插件：`digital-human-studio` 里 `npx tsc -p tsconfig.json`。大范围 client 仍必须完整 tsdown face。
- ping 检查 `version` 应为 `0.9.6`，tools 含 `dh_list_materials`。

## 登录同步模型（2026-11-06 补）
- 删光 Settings 模型提供方后，登录必须 **upsert 完整** `llm-pi-ai.providers.newapi`（displayName / apiKeyEnv / api / baseURL / models），不能只写 models。
- `mergeNewApiModelsIntoPatch` 必须输出 **block YAML**；flow `providers: { ... }` 会导致选择器空白。
- `discoverNewApiPatchPaths` 始终覆盖 web+desktop 文件（即使文本里还没有 `newapi`）。
- studio `0.8.1+`：`syncNewApiModels` / merge 已按上述行为修复。
