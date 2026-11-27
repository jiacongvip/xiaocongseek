# 能力矩阵（诚实分层）

| 平台/能力 | 源码保全于插件 vendor | 独立执行器已接线 | Web/AI 界面接入 | 真实账号验收 |
|---|---|---|---|---|
| 抖音/小红书/视频号/快手/B站等视频适配 | 是 | 代码路径具备（需 Python/Playwright/浏览器 + 显式环境开关） | 经发布管理/确认链路（启用插件后） | 否 |
| 图文/文章模式 | 源码保留 | 本阶段未接（contentMode 仅 video） | 否 | 否 |
| 原 GEO /postVideo 委托 | 不作为默认 | 已排除 | 否 | — |
| 授权登录/额度基线 | 协议语义已实现 | 本地设置+内存会话 | 管理 API 已有；完整设置 UI 可继续增强 | 未实登 |
| 平台账号官方页登录/扫码 | login-platforms.json + login_runner.py | accounts.create/login.start/poll/cancel + /publish-studio/login-qr；runner 可 mock | 右侧「平台账号」页已接线；HTTP 前端产物已含入口 | 本轮未实登 |

原 GEO 检测类条目不计入发布平台。


## 平台账号登录（2026-11-09 13:00 Asia/Shanghai）

- 入口：工作台右侧竖菜单「平台账号」（appPage=platform-accounts）；发布管理仅展示已绑定摘要并引导至此，无「尝试从原GEO列账号」按钮。
- 已接入官方登录页白名单：publishing/login-platforms.json 共 21 个（method 均为 browser_official_login）：baijiahao, bilibili, csdn, douban, douyin, facebook, instagram, jianshu, kuaishou, omqq, sohu, tencent, tieba, tiktok, toutiao_mp, wangyi_mp, wechat_official, weibo, x, xiaohongshu, zhihu。
- 登录方法：用户点击后由宿主启动 publishing/login_runner.py（Playwright headed Chromium）打开官方 login_url；成功以离开登录页且可达 personal_url（如有）并写入本地 storage_state 判定；关闭窗口不等于成功。
- 仅当 runner 从官方页截到真实二维码节点时才通过 /publish-studio/login-qr 展示；否则 UI 提示在浏览器完成登录。
- 本轮自动化：tests/platform-login.mjs + login_runner.py --mock-scenario（success/fail/waiting）；未实启浏览器/实扫码/读真实 Cookie。
- 缺依赖：真实登录缺 playwright 或缺 Chromium 时 phase=failed 并带 missing；不会回退原 GEO。
- 安全：账号按公司 space 隔离；AI 可 list/platforms，不可 start/approve；凭据只在 ~/.dsh/publish-studio/spaces/<space>/account-files；确认 nonce/媒体 revision/未知不重试语义保留。
- 加载：前端 bundle 已由 3080 热提供新产物；后端 publish-studio 新路由/登录执行器需重启 3080 后生效（本轮未授权重启，当前 PID 8021）。/publish-studio/login-qr 探测现为 404（旧进程无此路由）。

## 运行时安装（2026-11-09 13:10 Asia/Shanghai）

- 触发：插件 `prepare`/`postinstall` → `scripts/ensure-runtime.mjs` → `publishing/ensure_runtime.py`
- 位置：`~/.dsh/publish-studio/runtime/{venv,ms-playwright,status.json}`
- 固定：`playwright==1.52.0` + chromium；同解释器同浏览器路径
- 探针：venv python headless `about:blank`；失败不写 ready
- 本机需重启 3080 后后端才会用新 runtime 解析（本轮未自动重启）

