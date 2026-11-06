# AUTH — New API 登录授权

## 当前状态（2026-11-06，Asia/Shanghai）

- 本机 New API：`http://127.0.0.1:3000`，镜像 `v1.0.0-rc.48`，健康检查正常。
- 管理员 `admin` 已初始化；不要再次执行 setup 或重置账号。本文不保存密码和 Token。
- digital-human-studio **0.6.0** 已实现登录卡片、授权路由和两个只读聊天工具，已构建 dist。
- Web profile 重启加载后：`auth/status` HTTP 200；`auth/probe` HTTP 200、鉴权成功，模型数为 0。
- 空模型列表表示还没有可用渠道，不代表鉴权失败。第三方 Key 应在 New API 控制台「渠道」配置；VectCut 仍为本机服务。

## 使用方式

1. 打开 dsh Web `http://127.0.0.1:3080`，侧栏「数字人工作室」，顶部「New API 登录」。
2. 默认地址为 `http://127.0.0.1:3000`。输入账号密码，点击「登录并授权」；密码只用于瞬时登录，不存储、不记录，也不提供密码聊天工具。
3. 或从控制台复制**模型 API 令牌**，粘贴后点「保存地址 / 令牌」，允许省略 `sk-`。不要使用管理 access_token。
4. 点「探测连接」检查**已保存**的地址与令牌。成功且模型数 0 时，继续去控制台配置渠道。
5. 「退出授权」仅清除本地网关令牌和用户信息，不撤销服务端令牌；撤销/额度/有效期在 New API 控制台管理。
6. 修改网关地址并保存会清除原令牌，避免把旧凭据发送到新网关。非本机地址必须使用 HTTPS。

## 登录与完整 Key 获取流程

1. `POST /api/user/login`，JSON `{username,password}`。
2. 接受 `data.access_token`（兼容旧版 `data.token`）及 `data.user`；MFA / 未完成登录不能当作成功。
3. 管理接口请求携带 `Authorization: Bearer <access_token>` 和 `New-Api-User: <user.id>`。
4. `POST /api/token/` 创建唯一命名的工作室令牌。默认有限额度 `remain_quota: 500000`、`unlimited_quota: false`、不过期、`group: default`；不提升账户额度。可在控制台调整。
5. **创建响应可能只有 success，没有 key 或 id**。使用 `GET /api/token/search?keyword=<唯一名称>` 精确匹配返回的 `data.items` 定位 id。
6. `POST /api/token/batch/keys`，JSON `{ids:[id]}`；当前返回 **`data.keys[id]`** 为完整 Key（同时兼容直接 id→key 映射）。普通令牌列表只给掩码，不能用于推理。
7. 仅持久化规范化后的 `sk-…` 模型令牌，不持久化密码、管理 access_token。优先复用仍有效的本地 NEW_API_TOKEN 或 New API 上已有的 digital-human-studio 令牌；仅在缺失/失效/吊销时才新建。过期/不用的令牌可在控制台撤销。
8. `GET /v1/models` 携带 `Authorization: Bearer <模型令牌>` 作鉴权探测；不产生模型生成调用。

## 插件接口

前缀 `/digital-human-studio/auth/`：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | status | enabled/baseUrl/username/userId/hasToken/tokenPreview，仅掩码 |
| POST | login | `{username,password,baseUrl?}` 登录、创建令牌、取完整 Key 并保存 |
| POST | save | `{baseUrl?,token?,enabled?}` 粘贴授权；省略 token 保留（地址不变时） |
| POST | logout | 清空令牌和用户身份，禁用 |
| POST | probe | 探测已保存的 `/v1/models`，只返回结果和模型数 |

POST 要求 JSON，拒绝跨 Origin 请求；上游请求超时 15 秒，不跟随重定向。聊天只注册 `dh_auth_status` / `dh_auth_probe`，无密码/令牌写入工具。

配置：`~/.dsh/digital-human-studio.json`，新字段与原 VectCut / 草稿字段合并保留；保存时权限为 0600。旧 `/config` 路由也不再返回完整 newApiToken。此配置为本地明文文件，不是系统钥匙串。

## 验证与边界

- `npm run build`；`node --check lib/client.js`；`node tests/auth-smoke.mjs`（隔离 HOME、模拟网络，无真实账号密码）。
- 单测覆盖新旧登录响应、创建后搜索、`data.keys`、脱敏、保存/退出、sk- 规范化、VectCut/扩展字段保留、方法与 Origin 检查。
- 真实 `/auth/status`、`/auth/probe` 已验证；未用真实密码重新执行登录建 Key，避免读取密码文件和创建额外令牌。
- 不走 PHP 热路径；不改 VectCut。未重启桌面 App，仅重启 3080 Web profile；桌面进程需重新加载插件后才能使用新版。
- Compose 端口目前可能监听所有接口；生产使用前应限定 loopback 并评估数据库/Redis密码。
- `.env`、`.local-admin.txt` 与真实运行配置不可进 Git。

## 官方参考

- https://doc.newapi.pro/en/api/fei-user/
- https://doc.newapi.pro/en/api/fei-token-management/
- https://github.com/QuantumNous/new-api/blob/main/controller/token.go

## 浏览器 Sign-in 自动 claim（fork 0.7.1）

- 新增 `POST /digital-human-studio/auth/claim`：用 `accessToken`+`userId` 换 `sk-`；无 body 时若已有令牌则重同步。
- 新增同源代理 `POST /api/user/auth/refresh` → New API `/api/user/auth/refresh`（转发 Cookie），供 web 客户端在无法跨 Origin 读 3000 cookie 时仍能刷新会话。
- 壳 Sign-in：打开 3000/login 后轮询 refresh→claim；已有 `NEW_API_TOKEN` 则直接标记已登录。
- 仍只持久化 `sk-`，不落盘 access_token / 密码。
## Sign out 修复（0.7.2）

- 壳「退出登录」会：清除 `newApiSignedIn` 覆盖态、调用 studio `/auth/logout` 清 `sk-`/`NEW_API_TOKEN`、同源代理 `POST /api/user/auth/logout` 清 New API 刷新 cookie，并 **立即 publish signed-out**。
- DeepSeek `account.signOut` 改为 best-effort；仅 New API 登录时不再因 Host 无 grant/失败而卡在已登录 UI。
## Token 复用（0.7.3）

- `claimFromAccess` / 密码登录 / Sign-in claim：**先**探测本地 sk-，**再** `search` + `batch/keys` 复用已有 `digital-human-studio`（及旧的 `digital-human-studio-*`）令牌；都不可用才 `POST /api/token/` 创建稳定名 `digital-human-studio`。
- 每次 Sign-in 不再必然新建密钥。
## 429 登录限流（2026-11-06）

- New API 对本机出口 IP 使用 Redis `rateLimit:v2:ip:{GA|GW|CT}:<ip>`；登录/refresh 属 CT，触发后 `Retry-After` 约数分钟。
- 根因：壳 Sign-in 曾每 2s 轮询同源 `/api/user/auth/refresh`，与页面登录抢同一 IP 配额，叠出 429 toast。
- 处理：清空相关 Redis key；轮询改为本地 status 每 5s、refresh 最多每 15s，遇 429 按 Retry-After 退避。
## 登录成功确认（0.7.4）

- Sign-in 用可关闭弹窗打开 New API（`dsh-newapi-login`，不用 noopener）。
- claim 成功后关闭弹窗、`window.focus()`，并弹出「登录成功」；点「确定」关闭对话框并回到工作台。
## 登录成功页（0.7.5）

- claim 成功后，登录弹窗跳到 harness 托管页 `GET /digital-human-studio/auth/authorized`（深色「登录成功」+「打开应用」），不再停在 New API `/dashboard/overview`。
- 「打开应用」：focus opener、`postMessage`、尝试 `dsh://open`，再关闭弹窗；失败则 `location.replace` 回工作台。

