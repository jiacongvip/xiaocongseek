# NOTES — 决策记忆（给后续 Agent / 自己）

> 更新约定：有拍板就追加一节，勿删历史；日期用 Asia/Shanghai。

## 2026-11-06 — 选型拍板

### 选 New API，不选 PHP 扛转发

- 桌面 PHP 数字人插件（`php/.../digitalavatar`）模式可借鉴：登录、服务端藏 Key、创作点预冻/实扣。
- Jamie 明确：**没非要用 PHP**；只是让看商城模式。
- 性能角度：PHP 不适合做高并发 API 转发热路径。
- **结论**：中转热路径用 Go（New API）；PHP 非必须。若以后还要商城展示，可旁路记账，但不挡转发。

### 选 New API，不选 Sub2API

- 上游形态是 **API Key 多、集合后统一调用**。
- Sub2API（本机 `开发文件/sub2api-main` 等）更偏订阅账号池再分发。
- **结论**：本项目用 New API；Sub2API 对本案不优先。

### 与桌面结合

- 桌面 / Harness → New API（Base URL + 用户 Token）→ 多上游 Key。
- VectCut 混剪 **本机独立**，不经 New API。
- 现有 `~/.dsh/digital-human-studio.json` 以 VectCut 为主；New API 字段用 stub **追加**，默认 `newApiEnabled: false`，避免破坏当前插件。

### 仓库位置

- 路径：`/Users/jiacong/Desktop/开发文件/数字人混剪工作台/harness-newapi-gateway`
- 按 Jamie：「本地开发的东西放在开发文件文件夹下新建一个项目目录，并做好 md 记忆文档」。
- 2026-11-06 再按 Jamie 要求：插件 / Harness / New API 收进同一父目录 `数字人混剪工作台`，下分三子项目。

### 明确不做（本里程碑）

- 不把 PHP 接到转发链上。
- 不强制 clone new-api 源码（Docker 镜像即可）。
- 不自动改生产/现网配置；不发不可逆外部消息。

## 开放项（下次可干）

1. `docker compose up` 验证健康检查与管理员初始化。  
2. 在 New API 加一条真实上游渠道做 `/v1/models` 冒烟。  
3. digital-human-studio 读 stub 字段（TTS/生图占位接 New API）。  
4. 若要自建套餐页：再评估「站点包 New API」还是旁路 PHP 只做订单展示。

## 2026-11-06 — 目录重排

- 父目录：`/Users/jiacong/Desktop/开发文件/数字人混剪工作台`
- 子项目：`digital-human-studio`、`deepseek-harness`、`harness-newapi-gateway`
- 旧路径留了软链，避免工具仍解析旧位置。
- VectCutAPI 仍在 `/Users/jiacong/VectCutAPI`，未迁入。

## 2026-11-06（Asia/Shanghai）授权准备，非完成里程碑

- 已核对官方登录 / Token 端点并记录 `docs/AUTH.md`。
- 现有 `.env` 已存在；执行 `scripts/start-local.sh`，不动 VectCut。
- 当前执行环境无 CloudAgent 工具；按代码技能要求无法委派非平凡插件改造，故未改插件、未升级版本、未重启 dsh。
- 管理员和 Token 尚未创建；配置尚未修改。

## 启动实测：2026-11-06 14:48（Asia/Shanghai）

- Docker 镜像拉取和 Compose 启动成功；New API、Postgres、Redis 均 running。
- 实际 New API 版本：`v1.0.0-rc.48`。
- `GET http://127.0.0.1:3000/api/status` 返回 `success: true`。
- `GET /api/setup` 返回 `status: false`、`root_init: false`，需首次初始化。
- 未创建管理员或 Token；授权模型探测尚未通过。管理员请在本机 http://127.0.0.1:3000 完成初始化。
- 现有两个插件软链均仍指向统一工作区中的 `digital-human-studio`。

- Docker 后续健康检查：`harness-new-api` 已为 `healthy`。

## 2026-11-06 22:21 Asia/Shanghai — 控制台显示名 New API → XiaocongAPI

### 现象
Jamie 指着 `http://127.0.0.1:3000` 左上角品牌字仍是 **New API**（Xiaocongseek 壳 :3080 已改过，与此无关）。

### 做法（优先 SystemName，不改镜像/源码）
- New API 的产品名来自 option **`SystemName`**（`/api/status` 字段 `system_name`；前端 `systemName: status.system_name || "New API"`）。
- 运行中 compose 数据在 `数字人混剪工作台/harness-newapi-gateway` 的容器；**未改该目录业务源码**，只写 Postgres `options` 表并重启 `harness-new-api`。
- SQL（已执行）：
  ```sql
  INSERT INTO options (key, value) VALUES ('SystemName', 'XiaocongAPI')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  ```
- 另写入了 `PasskeyDisplayName=XiaocongAPI`（status 里 `passkey_display_name` 仍可能显示默认；Passkey 登录关闭，不影响首页品牌）。
- 重启：`docker restart harness-new-api`

### 验证
- `curl -s http://127.0.0.1:3000/api/status` → `"system_name":"XiaocongAPI"`
- 浏览器硬刷新 `http://127.0.0.1:3000`：左上角 / 文档标题会跟 `system_name` 走。
- 静态 `index.html` 里仍有首屏 `<title>New API</title>`（打进镜像的默认 HTML），JS hydrate 后会改成 XiaocongAPI。未做自定义镜像。

### 回滚
```sql
UPDATE options SET value = 'New API' WHERE key = 'SystemName';
-- 或 DELETE FROM options WHERE key = 'SystemName';
```
然后 `docker restart harness-new-api`。

### 残留「New API」字符串（可接受）
- 上游文档链接 `docs.newapi.pro`、i18n 文案/占位符、镜像内静态 title 首闪、技术 id（镜像名 `calciumion/new-api`、包路径等）未改。
