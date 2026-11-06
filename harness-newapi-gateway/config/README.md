# Harness / digital-human-studio 配置桩

目标文件（本机已有，勿整文件覆盖）：

- `~/.dsh/digital-human-studio.json` — 当前含 `vectcutBaseUrl`、`vectcutRoot`、草稿路径等

合并方式（以后接线时）：

1. 保留全部现有 VectCut 字段。
2. 追加 `harness-newapi.stub.json` 里的 `newApiBaseUrl` / `newApiToken` / `newApiEnabled`。
3. 默认 `newApiEnabled: false`，直到 New API 起来且 Token 可用再打开。

参考合并后形状：

```json
{
  "vectcutBaseUrl": "http://127.0.0.1:9001",
  "vectcutRoot": "/Users/jiacong/VectCutAPI",
  "newApiBaseUrl": "http://127.0.0.1:3000",
  "newApiToken": "<from New API console>",
  "newApiEnabled": false
}
```

插件代码改动另开任务；本目录只放约定，避免破坏现有工作室。
