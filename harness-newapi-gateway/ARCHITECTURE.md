# Architecture — harness-newapi-gateway

## 目标

聚合多家上游 **API Key**，对外一个 OpenAI 兼容入口；桌面 Harness 只认 `baseUrl + token`；用量在 New API 侧扣额度。

## 分层

```
┌─────────────────────────────────────────────────────────┐
│  Desktop: DeepSeek Harness + digital-human-studio       │
│  - Agent / UI                                           │
│  - VectCut 本机混剪（独立进程，不经网关）                  │
└────────────┬──────────────────────────────▲─────────────┘
             │ chat / TTS / image（将来）     │ 结果 + 扣费回执
             ▼                              │
┌─────────────────────────────────────────────────────────┐
│  New API (Go)  ← 本仓库 docker-compose 跑这一层          │
│  - 用户 / Token / 额度 / 渠道 / 多 Key 负载              │
│  - 控制台：http://127.0.0.1:3000                         │
└────────────┬────────────────────────────────────────────┘
             │ 按渠道转发
             ▼
┌─────────────────────────────────────────────────────────┐
│  Upstream providers（多 API Key）                        │
│  LLM / 兼容 TTS / 生图 等                                │
└─────────────────────────────────────────────────────────┘
```

## 职责边界

| 组件 | 负责 | 不负责 |
|------|------|--------|
| New API | 鉴权、转发、额度、渠道 Key | 剪映草稿、VectCut 时间线 |
| digital-human-studio | 桌面体验、调 VectCut、日后带 Token 调 New API | 藏各家上游 Key |
| VectCut / vectcut-local | 本机混剪、草稿 | 云端计费 |
| PHP digitalavatar（仅参考） | 商城模式灵感 | **不做**本方案热路径转发 |

## 鉴权约定（日后接线）

- `newApiBaseUrl`：如 `http://127.0.0.1:3000`
- `newApiToken`：New API 用户 Token（`Authorization: Bearer …`）
- 典型：`POST /v1/chat/completions`；TTS/生图按 New API 已配置渠道的兼容路径

见 `config/harness-newapi.stub.json`。

## 非目标（当前里程碑）

- 不改造 PHP 商城扣创作点
- 不接入 Sub2API（订阅号池场景）
- 不把 New API 嵌进 VectCut 进程
- 不覆盖现有 `~/.dsh/digital-human-studio.json` 的 VectCut 字段
