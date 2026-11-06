## 教训备忘

2026-11-06 踩坑与正确流程见：[LESSONS-2026-11-06-local-stack.md](./LESSONS-2026-11-06-local-stack.md)（禁止混 npx、必须完整 tsdown、token 入口）。

# 本地可改可测（推荐）

整套可修改、可测试的代码栈在本目录，**用 fork 本地 `pnpm dsh` 跑 web**，不要再用 `npx dsh`，也不要把 fork 的 `lib/` rsync 进 `~/.npm/_npx/...`（模块表会对不上，出现 Failed to load plugins / 输入框丢失）。

## 路径
- 栈根：`/Users/jiacong/Desktop/开发文件/dsh-newapi-fork/`
- Harness 源码：`dsh-newapi-fork/deepseek-harness/`
- Studio 插件：`dsh-newapi-fork/digital-human-studio/`（profile `~/.dsh/profiles/web` 已 link 到这里）
- Gateway：`dsh-newapi-fork/harness-newapi-gateway/`
- **不要动**：`/Users/jiacong/Desktop/开发文件/数字人混剪工作台/`、`/Applications/DeepSeek Harness.app`

## 启动（本地 CLI，非 npx）
```bash
# 可选：一键脚本
./scripts/start-web.sh

# 或手动：
pkill -f 'dsh --profile web --no-open --port 3080' || true
cd "/Users/jiacong/Desktop/开发文件/dsh-newapi-fork/deepseek-harness"
pnpm dsh --profile web --no-open --port 3080
```
- 使用同一 profile 名 `web` → XiaocongAPI 登录 + digital-human-studio 0.7.9 仍在
- 启动日志会打印入口：`dsh web: http://127.0.0.1:3080/?token=...`（每次重启 token 会变）
- 进程应为：`node --import tsx/esm apps/cli/src/bin.ts --profile web ...`，cwd 在本 fork 的 `deepseek-harness/`，**不是** `~/.npm/_npx/...`

## 改品牌 / UI 后怎么重建

**注意（Failed to load plugins）**
client 插件的 `lib/client.js` 必须把 `@deepseek-ai/cosmokit`、`@deepseek-ai/dsh-typert-protocol` 等 **INLINE_SAFE / VENDORED** 依赖打进包内，不能 `require()` 到模块表。若出现 `missed the module table`，多半是只跑了 `tsc`、或旧的 client 产物外置了这些依赖——务必再跑完整 client 面：

`pnpm run build:native-system   # 首次/干净 checkout：产出 darwin-arm64/bin/system.node，否则新建会话失败
pnpm exec tsdown --config-loader native --env.DSH_BUILD_FACE client`

（或 `pnpm run build:lib:client` 的后半段）。单包验证：gateway/theme 的 client 产物 require 列表里不应再出现 cosmokit / typert-protocol。


品牌相关源码示例：
- `packages/client/ui-primitives/src/FishLogo.tsx`（小葱图）
- `packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx`
- `packages/client/ui-brand-official/`、`packages/client/ui-layout/`（productTitle 等）

依赖已装好时，常用重建路径：

```bash
cd "/Users/jiacong/Desktop/开发文件/dsh-newapi-fork/deepseek-harness"

# A. 边改边测（推荐）：一次构建 + 监听 + 本地 web
pnpm run dev:web -- --profile web --no-open --port 3080

# B. 只改 client 插件再重启 web
pnpm run build:lib:client    # tsc -b client + tsdown client face
# 若完整 tsc 因 shallow-clone 宿主类型缺口失败，可用此前已验证的部分 emit：
#   pnpm exec tsc -b tsconfig.client.json --force --noCheck
#   再跑 tsdown client face（见 package.json build:lib:client 后半）
pnpm run build:web           # vite → apps/web/dist
# 然后重启：
pkill -f 'dsh --profile web --no-open --port 3080' || true
pnpm dsh --profile web --no-open --port 3080
```

官方完整构建（磁盘紧、类型检查可能失败时慎用）：
```bash
pnpm run build
pnpm dsh web
```

## 测试 URL / 校验
```bash
curl -s http://127.0.0.1:3080/digital-human-studio/ping | grep 0.7.9
curl -sI http://127.0.0.1:3080/digital-human-studio/assets/xiaocong-only.png | head
# 浏览器硬刷新打开启动日志里的 ?token= URL
# 标题应为 Xiaocongseek；侧栏/空态品牌为小葱；输入框应在
```

## 禁止事项
- ❌ `npx dsh` / 往 `~/.npm/_npx/1e7f6d9597241db0/` 拷 fork 的 lib
- ❌ 改原工程或已装 DeepSeek Harness.app
- 磁盘 Data 卷空间紧（约数 GB），避免再复制一份 `node_modules`

---

## 产品显示名 Xiaocongseek（0.7.9）

用户可见品牌从 DeepSeek Harness 改为 **Xiaocongseek**（技术 id：`dsh` / `digital-human-studio` 不变）：
- 授权确认页 / 登录成功页文案与 logo
- `ui-settings-account` 多语言（含返回工作台、额度提示、onboarding）
- Web 窗口标题（live `dsh-client-ui-layout` 的 `productTitle`）
- 桌面壳 locale / installer 文案（fork 源码；已装 `.app` 的 Info.plist 受 macOS 写保护，需本机授权后改 DisplayName）


## 小葱透明 Logo + 桌面图标（0.7.9）

- 透明切图：`assets/xiaocong-only.png`（插件内另有一份 `digital-human-studio/assets/`）
- 插件静态路由：`GET /digital-human-studio/assets/xiaocong-only.png`
- 授权确认页 / 登录成功页品牌位显示小葱 `<img>` + Xiaocongseek 文案
- fork 内 DeepSeek 鲸鱼标替换：`FishLogo.tsx` / `BrandWordmark.tsx` / `EmptyHero.tsx` / `ui-brand-official`
- 桌面图标（绿底圆角复合）：`deepseek-harness/apps/desktop/resources/icon.png`（1104）、`icon-macos.png`、`icon-windows.png`
- Web 图标：`apps/web/public/icon-192.png`、`icon-512.png`、`apple-touch-icon.png` 等
- 运行中的 `dsh --profile web` 需重启后，授权页与壳品牌位才会吃到 0.7.9

验证：
```bash
curl -s http://127.0.0.1:3080/digital-human-studio/ping | grep 0.7.9
curl -sI http://127.0.0.1:3080/digital-human-studio/assets/xiaocong-only.png | head
open 'http://127.0.0.1:3080/digital-human-studio/auth/authorize'
```

# dsh-newapi-fork（独立改码目录）

此目录是**单独下载/拷贝**的工作副本，用来改 XiaocongAPI 登录，**不要动**  
`/Users/jiacong/Desktop/开发文件/数字人混剪工作台/` 里的原本地工程。

## 内容
- `deepseek-harness/`：从 GitHub shallow clone，已改 `ui-settings-account` 登录入口 → `http://127.0.0.1:3000/login`
- `digital-human-studio/`：从原工程拷贝（不含 node_modules）
- `harness-newapi-gateway/`：从原工程拷贝（不含 data/logs）

## 原工程
原路径保持不动；若之前误改过 harness 登录源码，已 `git checkout` 还原。

## 浏览器 Sign-in 自动索取 sk-（0.7.1）

机制（web 兼容）：
1. 壳「登录」先查 `/digital-human-studio/auth/status`；已有 `NEW_API_TOKEN` 则直接标记已登录。
2. 否则打开 `http://127.0.0.1:3000/login`，并轮询：
   - 同源代理 `POST /api/user/auth/refresh`（浏览器可带上 XiaocongAPI 的 `Path=/api/user/auth` 刷新 cookie；cookie 不绑端口，本机 3080↔3000 可共用）
   - 拿到 `access_token` 后 `POST /digital-human-studio/auth/claim` → 创建并持久化 `sk-…` → 写入 `NEW_API_TOKEN`
3. 成功后 shell 账号态显示为已登录（不依赖 DeepSeek OAuth）。

### 跑 patched web（已废弃 npx）
请改用文首 **「本地可改可测」**：在 `deepseek-harness/` 里 `pnpm dsh --profile web --no-open --port 3080`。
源码在 `deepseek-harness/packages/client/ui-settings-account`；profile 仍链到本 fork 的 `digital-human-studio`。

验证：
- `curl -s http://127.0.0.1:3080/digital-human-studio/ping` → version 0.7.9
- `curl -s http://127.0.0.1:3080/digital-human-studio/auth/status` → hasToken true
- 浏览器打开启动日志中的 `?token=` URL → Sign-in：若 XiaocongAPI 已登录，应自动 claim；否则在 3000 登录后回 3080 等待轮询完成



## 会话仍在时的授权确认页（0.7.7）

对齐 DeepSeek `/dsh/authorize`：Harness **退出登录只清 studio sk-**，保留 XiaocongAPI `new_api_has_session`。
再次 Sign-in 时若会话仍在，弹窗打开 `/digital-human-studio/auth/authorize`（信任横幅 + 账号卡 + **登录** + 切换其他账号），用户点登录后 claim → `/auth/authorized`。
无会话则仍打开 XiaocongAPI `/login`，登录后快速 claim + 成功页。切换其他账号会先 logout New API cookie 再进登录表单。

验证：登录 XiaocongAPI → 在 harness 退出 → 再 Sign-in → 应看到授权确认页而非 `/dashboard`。

## 登录后立刻离开 XiaocongAPI 控制台（0.7.6）

XiaocongAPI 的 `login?redirect=` 只允许同域（:3000），无法直接跳到 harness 的授权成功页。
改动：轮询 `new_api_has_session` cookie（非 HttpOnly、Path=/，本机端口无关可读）与 `/api/user/auth/refresh`；
一旦 refresh 拿到 `access_token`，**立刻**把登录弹窗 `location.replace` 到 `/digital-human-studio/auth/authorized`，claim 在 harness 侧并行完成。轮询间隔 ~400ms（refresh 最快 ~2s，429 退避）。Chrome 密码泄露提示与本流程无关，可忽略。

## Sign out（0.7.2）
退出登录会清 studio 令牌、`NEW_API_TOKEN`、壳 overlay，并代理 `POST /api/user/auth/logout` 清 XiaocongAPI cookie；立即显示未登录。
