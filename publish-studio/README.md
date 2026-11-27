# publish-studio（独立发布插件）

不依赖原大象 GEO 进程。平台适配代码位于本插件 `publishing/vendor/geo`，由受控 `publishing/executor.py` 加载。

## 独立性
- 不调用原 GEO `/postVideo`
- 不读取原 GEO `conf.py` / 账号库 / Cookie
- 原 GEO 未运行时，插件仍可加载；`dry-run` 与授权/账号/任务链路可测
- 真实浏览器执行需本机 Python + Playwright + 浏览器，并显式 `PUBLISH_STUDIO_ALLOW_EXECUTE=1`；缺依赖会 blocked，**不会**回退原 GEO

## 授权与额度
- 设置保存在 `~/.dsh/publish-studio/auth-settings.json`
- 语义对齐原 `client_auth` / `client_permissions`：显式拒绝保留；缺省能力允许（allow_when_missing）；日额度需管理员确认历史已用次数基线后才放开，避免把原已用次数清零放大
- 登录/激活走原兼容授权中心协议；令牌仅内存

## 启用（需改 web profile，本次不自动改你的真实 profile）
1. 构建：`cd publish-studio && npm/pnpm 使用仓库已有 typescript：可借用 digital-human-studio/node_modules/.bin/tsc -p tsconfig.json`
2. 在 `~/.dsh/profiles/web/package.json` 增加依赖 link 与 bundles 中的 `publish-studio`（与 digital-human-studio 相同方式）
3. 重启工作台 3080 后生效

详见 `ENABLE.md`。

## 与数字人插件
数字人 Web/AI 通过宿主 `ctx.get('publishStudio')` 与 `/publish-studio/*` 调用本插件公共接口。AI 只能 prepare/查询，不能确认发送。
