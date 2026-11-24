# Xiaocongseek 仓库说明

这是 **Xiaocongseek** 本地可改可测工作副本的快照（品牌化 DeepSeek Harness + 数字人工作室插件 + XiaocongAPI 网关配置）。

## 目录

| 路径 | 内容 |
|------|------|
| `deepseek-harness/` | Harness 源码（基于上游 `deepseek-ai/deepseek-harness` @ `0.2.2-rc.1`），品牌与登录改动在此 |
| `digital-human-studio/` | 工作室双半插件（宿主 `src/` + 浏览器半源码），负责 VectCut / `dh_*` 工具 / XiaocongAPI 登录同步 |
| `harness-newapi-gateway/` | 本地 XiaocongAPI（New API Docker）配置、文档与脚本 |
| `assets/` | 小葱 logo、桌面/Web 图标源文件 |
| `scripts/` | `start-web.sh` 等本地启动脚本 |
| `patches/` | `deepseek-harness-xiaocongseek.patch`：相对上游的完整改动，便于日后 rebase 上游 |
| `deepseek-harness/README-windows-build.md` | Windows x64 未签名测试包的打包步骤（必须在 Windows 机器上打包） |
| `deepseek-harness/build-win.ps1` | Windows 一键打包脚本（预检 + 完整构建 + 出 EXE） |
| `deepseek-harness/scripts/test-feed.mjs` | 本地限速更新源，用于验证「检查更新 → 下载进度条 → 运行安装器」 |
| `deepseek-harness/scripts/generate-latest.mjs` | 生成 latest.json（支持 macOS `dmgUrl` 与 Windows `exeUrl`） |
| `README.md` / `MEMORY-稳定结论.md` / `LESSONS-*.md` | 启动流程、稳定结论、踩坑记录 |

## 不含（克隆后需自行生成 / 本地自备）

- `node_modules/`（`pnpm install` 重新安装）
- 构建产物 `lib/`、`dist/`（按 README 跑 `tsdown` client face + `build:web`）
- 本地密钥与运行数据：`harness-newapi-gateway/.env`、`.local-admin.txt`、`data/`、`logs/`
- 任何 `sk-` 令牌、数据库口令、管理员口令

## 跑起来

见 [`README.md`](./README.md) 的「本地可改可测（推荐）」一节：

```bash
cd deepseek-harness
pnpm install
pnpm run build:native-system            # 首次
pnpm exec tsdown --config-loader native --env.DSH_BUILD_FACE client
pnpm run build:web
pnpm dsh --profile web --no-open --port 3080
```

工作室插件与网关按各自 README 安装/启动；XiaocongAPI 用 `harness-newapi-gateway/` 的 compose 起在 `:3000`。

## 与上游的关系

`deepseek-harness/` 来自上游 MIT 项目，本地改动共 40 个文件（品牌、`ui-settings-account` 登录链路、图标、构建脚本）。完整 diff 见 `patches/deepseek-harness-xiaocongseek.patch`。
