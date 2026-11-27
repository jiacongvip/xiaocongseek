# 启用 publish-studio

独立发布插件。数字人侧栏「发布」、发布包管理、5 个 AI 工具共用同一 `publishStudio` 服务；AI 只能 prepare，不能 approve/execute。原 GEO `/postVideo` 委托**默认关闭**，不会静默回退。

## 前提

- 本机已有可运行的 DSH web profile（当前常用：`~/.dsh/profiles/web`）。
- `digital-human-studio` 已按既有方式 link 进该 profile。
- **不要**把原大象 GEO（`MediaPublishPlatform-main`）当成运行依赖；勿把令牌写入 profile。

## 1. 手动 link 到 web profile（需你确认后再改）

在你明确批准启用后，可将 `publish-studio` 加进 web profile 的 `package.json`（仅增加该 link 与 bundle，不覆盖其它依赖）。示例：

```json
{
  "dependencies": {
    "digital-human-studio": "link:/Users/jiacong/Desktop/开发文件/小葱/dsh-newapi-fork/digital-human-studio",
    "publish-studio": "link:/Users/jiacong/Desktop/开发文件/小葱/dsh-newapi-fork/publish-studio"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "publish-studio",
        "digital-human-studio",
        "dsh-media-desk"
      ]
    }
  }
}
```

要点：

1. `dependencies` 使用 `link:` 指向本仓库的 `publish-studio` 绝对路径。
2. `dsh.profile.bundles` 必须包含 `"publish-studio"`，且必须放在 `"digital-human-studio"` **之前**（正式 `ctx.provide` + 宿主 `ctx.inject(['publishStudio'])`；bundles 顺序保证提供方先加载）。
3. 不要写入 cookie / token / 原 GEO 路径。

## 2. 在 profile 目录完成链接（沿用你当初接 digital-human-studio 的同一套包管理命令）

在 `~/.dsh/profiles/web` 执行既有的 install/link（例如该环境惯用的 `pnpm install` / `npm install`）。**本任务不替你执行安装。**

## 3. 重启顺序（需你另行确认后再重启；本任务不重启 3080）

1. 确认上两步已完成（package.json 已改且 profile 依赖已 link）。
2. **先保证 `publish-studio` 已出现在 bundles**，再重启 web（通常端口 **3080**）。
3. 不要先启动原 GEO Python 服务当作发布后端；独立插件不依赖它。
4. 若同时有 3000 / 9001 等附属进程，按你现有习惯在 web 起来后再处理；**不要**为了发布去拉起原 GEO。
5. 重启后自检：数字人发布总览应显示独立插件 runtime；未配置授权时执行保持 blocked，且日志/错误中应出现「不会回退原GEO」，而不是请求 `/postVideo`。

## 4. 启用后行为摘要

| 入口 | 行为 |
|------|------|
| 侧栏「发布」 | 走数字人 HTTP → `publicationAction` / `publicationHumanAction` → `ctx.publishStudio` |
| 发布包 / 日历 | 仍在 digital-human-studio 本地；准备任务时把媒体 stage 进 publish-studio |
| AI 五工具 | `dh_publication_overview` / `dh_publish_packages` / `dh_publish_calendar` / `dh_publish_tasks` / `dh_prepare_publication`；仅查询与 prepare |
| 真人确认发送 | 仅 UI `publication-confirmation` → `humanAction`（nonce + CSRF） |
| 原 GEO 桥 | `publicationGeoAction` 默认抛错；可选兼容入口已改为独立 auth 代理 |

## 5. 回滚

从 web profile 的 `dependencies` 与 `bundles` 去掉 `publish-studio`，按同样顺序重启 3080。数字人在缺少 `publishStudio` 时保持 blocked，**不会**自动改回 `/postVideo`。

## 本机启用实态（2026-11-09 12:12 Asia/Shanghai）

已在用户明确批准后写入 web profile 的 `publish-studio` link + bundles（位于 `digital-human-studio` 之前），离线/锁文件恢复依赖并 `scripts/start-web.sh` 重启 3080。启动日志应同时出现独立插件注册与数字人 bridge connected。未配置授权时 `runtime.enabled=false`（blocked），不会回退原 GEO。

## 运行时依赖（Playwright / Chromium）

插件安装/链接时会通过 `package.json` 的 `prepare` + `postinstall` 调用 `node scripts/ensure-runtime.mjs`，在 **`~/.dsh/publish-studio/runtime/`** 创建隔离 venv，并安装固定版本：

- `playwright==1.52.0`
- 仅 Chromium（`PLAYWRIGHT_BROWSERS_PATH` 指向同一 runtime 目录）

特点：幂等、不写入系统/用户 site-packages、不 sudo。若宿主禁用 install scripts，启动日志与「平台账号」页会诚实显示未就绪，可手动执行：

```bash
cd /path/to/publish-studio && node scripts/ensure-runtime.mjs
node scripts/ensure-runtime.mjs --status
```

登录不会在浏览器未启动成功时提示“已打开官方浏览器”。

