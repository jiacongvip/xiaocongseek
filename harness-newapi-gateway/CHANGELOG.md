# Changelog

## 2026-11-06（下午）— 迁入工作台父目录

- 从 `Desktop/开发文件/harness-newapi-gateway` 迁到 `Desktop/开发文件/数字人混剪工作台/harness-newapi-gateway`。
- 文档中的 `cd` / 相关路径改为新绝对路径；旧位置保留软链。
- 与 `digital-human-studio`、`deepseek-harness` 并列于同一工作台。


## 2026-11-06

- 在 `Desktop/开发文件` 下新建项目 `harness-newapi-gateway`。
- 加入 `docker-compose.yml`（New API + Postgres 15 + Redis 7）、`.env.example`、启停脚本。
- 加入记忆文档：`README.md`、`ARCHITECTURE.md`、`SETUP.md`、`NOTES.md`、`CHANGELOG.md`。
- 加入 Harness 配置桩 `config/harness-newapi.stub.json`（默认不启用，不覆盖现有工作室 JSON）。
- 决策写入 NOTES：热路径不用 PHP；多 Key 用 New API；Sub2API 不采用；VectCut 本机独立。

## 2026-11-06（Asia/Shanghai）— Desktop / Web 共享登录

- 新增 docs/DESKTOP-LOGIN.md，记录 0.7.0 工作室统一 NEW_API_TOKEN、默认 newapi 对话线路、渠道配置与真实验收状态。
- New API 鉴权正常但可用模型为 0，未作付费推理测试；完整业务接口需后端开通。
