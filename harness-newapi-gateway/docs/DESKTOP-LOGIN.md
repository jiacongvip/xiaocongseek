# Desktop / Web：New API 统一登录（工作室 0.7.0）

更新：2026-11-06（Asia/Shanghai）。项目根目录：`/Users/jiacong/Desktop/开发文件/数字人混剪工作台/`。

## 数据流

```text
桌面 / Web → 侧栏「数字人工作室」→ 顶部 New API 登录卡
                 ├─ New API 账号密码登录 → 签发推理令牌（密码和管理 access_token 不落盘）
                 └─ 或粘贴已有推理令牌
                              ↓
          ~/.dsh/digital-human-studio.json（0600）
                              ↓
           credentials.set(NEW_API_TOKEN, token)
          ~/.dsh/.credentials.yaml → refs.NEW_API_TOKEN（0600）
                    ┌─────────┴────────────┐
                    ↓                      ↓
        工作室云端授权/探测         llm-pi-ai / newapi
                                   默认 deepseek-chat
                                   http://127.0.0.1:3000/v1

本机剪辑/草稿 → VectCut http://127.0.0.1:9001（独立，未修改）
```

## 使用

1. 完全退出并重开桌面 App；网页版访问 `http://127.0.0.1:3080/`（如提示工作台本地访问认证，使用本机原有入口，不要公开访问令牌）。
2. 侧栏「数字人工作室」→ 顶部「New API 登录」。地址默认 `http://127.0.0.1:3000`，输入 New API 账号密码「登录并授权」，或粘贴令牌保存。
3. 没有令牌或关闭授权时，顶部提示「登录后才能用对话模型与数字人接口」。登录成功后凭据自动同步，对话选择 `newapi / deepseek-chat`；建议新建对话，旧会话可能保留先前模型。
4. 「探测连接」检查鉴权与模型数。「退出授权」或禁用会清除共享 NEW_API_TOKEN；退出仅清除本地，不撤销服务器令牌，撤销需在 New API 控制台操作。

这次实现的是工作室内登录入口与共享凭据/默认线路，不是完全白标启动壳或全应用登录遮罩。DeepSeek 官方 OAuth 插件仍安装、仍可手动选择，但不再作为默认对话提供方；未改官方授权地址。现有其他提供方未删除。

## 两个 profile

- `~/.dsh/profiles/desktop/cordis.patch.yml`
- `~/.dsh/profiles/web/cordis.patch.yml`

两者新增 `llm-pi-ai.providers.newapi`，`apiKeyEnv: NEW_API_TOKEN`，OpenAI completions 协议；默认模型改为 `provider: newapi, model: deepseek-chat`，不强制 reasoningEffort。
两个 profile 的 package.json 注册 `digital-human-studio` bundle，node_modules 软链指向父目录内插件。bundle 自带 host patch，不重复手工插入。
原 profile 配置备份为同目录 `.bak-newapi-20261106`，package.json 也有同名后缀备份；备份只用于回滚，不写入仓库。

Cordis 4.1 的 inject 不支持 `required:false`，因此依照 llm-pi-ai 使用 `ctx.get('credentials')` 获取可选服务。服务存在时 set/unset；仅服务不存在才使用 YAML 文档合并回退，保留其他 refs、records 和注释，原子替换、0600；格式错误拒绝覆盖。服务写失败不会偷偷绕过服务。
登录、保存、加载已有配置时同步；退出/禁用/清空令牌时 unset。上游厂商 Key 只配置在 New API。

## 必须配置渠道，才可真正调用

本次验证 New API `/v1/models` HTTP 200，但模型数 **0**：只证明令牌鉴权成功，未完成实际模型推理验收。

1. 打开 New API 控制台 `http://127.0.0.1:3000` → 渠道 → 添加渠道。
2. 选择对应上游类型，填写上游地址与厂商 Key，启用渠道，确保用户/令牌所在 `default` 分组可访问。
3. 对外模型需包含 `deepseek-chat`；若上游名称不同，用 New API 模型映射映射到真实模型 ID。
4. 若只开通别的模型，修改 desktop/web 的默认 `model` 并同步 newapi.models，或在模型选择器选已开通的 ID。`gpt-4o-mini` 也只是预置候选，不代表已开通。
5. 再探测，确认模型列表包含目标 ID 后测试一条对话。否则会报模型不存在/无可用渠道（不保证固定 HTTP 状态码）。

数字人/TTS/生图的各个业务接口仍需要网关/上游提供相应能力和路由；共享登录不等于自动实现未部署的业务后端。VectCut 本机功能不要求云端登录。
若以后把登录卡服务地址改为远程站点，必须同时把两个 profile 的 newapi.baseURL 改为该站的 `/v1`；本次固定连本机 New API，不会自动改模型网关地址。非本机服务要求 HTTPS。

## 验收与维护

- `pnpm build`、`node tests/auth-smoke.mjs`、`node tests/credential-sync.mjs`、`node --check lib/client.js` 通过。
- Web 3080 已安全重启，ping 返回版本 0.7.0；auth/status enabled、hasToken 均 true。
- NEW_API_TOKEN 存在且与工作室配置一致，凭据文件权限 0600；未输出完整令牌/密码。
- 桌面 Electron 未重启，需要用户手动完全退出再打开。旧会话模型可能独立于新的默认值。
- 深度白标、替换全局账号页面和完整业务后台不在本次实现范围。
