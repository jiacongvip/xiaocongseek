# 教训备忘：Xiaocongseek 本地可改可测栈（2026-11-06）

## 结论（下次直接按这个做）

1. **改代码只改 fork**：`/Users/jiacong/Desktop/开发文件/dsh-newapi-fork/`
2. **跑 web 只用 fork 本地编译**：`pnpm dsh --profile web` 或 `./scripts/start-web.sh`
3. **禁止**把 fork 的 `lib/` / `dist/` 同步进 `~/.npm/_npx/...`
4. **禁止**手改 npx 里压缩后的 `index-*.js` / `client.js` 换 logo
5. Client 改完必须跑完整 **client face tsdown**，不能只 `tsc`
6. 打开页面：把 `http://127.0.0.1:3080/?token=...` **粘贴到本机 Chrome**（或 `open -a "Google Chrome" URL`）；裸开 3080 会 401；聊天里点链接经常打不开本机 localhost

不要动：`数字人混剪工作台/`、`/Applications/DeepSeek Harness.app`

---

## 这次实际踩过的坑

| 做法 | 结果 |
|------|------|
| 手改 npx 缓存里的 minified JS 换小葱 | 前端 boot 转圈；`node --check` 过也没用 |
| 只替换 `dsh-web-frontend/dist`（fork 新编）到 npx | 宿主插件还是旧的 → **输入框消失** |
| 把 fork 编好的 60+ client `lib` + web dist 整批塞进 npx | 模块表漂移 → **Failed to load plugins**（`cosmokit` / `dsh-typert-protocol` missed the module table） |
| fork 本地 `pnpm dsh` 但 client 只做了部分 tsc | 同样 Failed to load plugins |
| 给聊天链接 `127.0.0.1:?token=` | 用户侧「打不开」；本机 curl/`open` 其实是通的 |

回滚靠：`~/.dsh/backups/` 下带时间戳的 web dist / client lib 备份（例如 `matched-xiaocong-deploy-20261106-200456`）。

---

## 正确工作流

```bash
# 改源码（品牌示例）
# deepseek-harness/packages/client/ui-primitives/src/FishLogo.tsx
# deepseek-harness/packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx
# digital-human-studio 静态小葱：GET /digital-human-studio/assets/xiaocong-only.png

cd "/Users/jiacong/Desktop/开发文件/dsh-newapi-fork/deepseek-harness"
pnpm exec tsdown --config-loader native --env.DSH_BUILD_FACE client
pnpm run build:web

# 启动（不要 npx）
"/Users/jiacong/Desktop/开发文件/dsh-newapi-fork/scripts/start-web.sh"
# 日志里的 token：
grep "dsh web: http" /tmp/xiaocongseek-web-local.log | tail -1
```

验证：

- 无 “Failed to load plugins”
- `<title>Xiaocongseek</title>`，主包含 `xiaocong-only.png`
- 会话区有输入框（composer / InputBar）
- `curl -s http://127.0.0.1:3080/digital-human-studio/ping`

Profile：`~/.dsh/profiles/web`（已 link fork 的 `digital-human-studio` + XiaocongAPI `cordis.patch.yml`）。

- **本地栈还要编 native system addon**：在 `deepseek-harness` 跑 `pnpm run build:native-system`，产出 `native/system/packages/darwin-arm64/bin/system.node`；缺了会「新建会话失败 / Cannot find module ... system.node」。

更短的操作说明见同目录 `README.md`「本地可改可测」。

## XiaocongAPI login auto-syncs models (0.8.0)

`digital-human-studio` login / paste-token / probe calls `GET /v1/models` with the saved `sk-` and writes ids into the running profile’s `llm-pi-ai` `providers.newapi.models` (live `settings.update` when available, plus `~/.dsh/profiles/{web,desktop}/cordis.patch.yml`). Default model prefers `deepseek-chat`, then `deepseek-flash`, then the first id when the previous default is missing from the key. Empty listings keep the previous picker. Display name XiaocongAPI; technical ids `newapi` / `NEW_API_TOKEN` unchanged.
