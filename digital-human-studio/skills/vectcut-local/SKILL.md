---
name: vectcut-local
description: "本机混剪工作台（Digital Human Studio + 本地 VectCut 9001）。用户要混剪、扫剪映草稿、新建草稿、加本地视频、保存进剪映、启动/停止剪辑引擎时必用。只用 dh_* 工具，禁止 VECTCUT_API_KEY / 云端 VectCutSkill / 远程上传。成片默认保存草稿后在剪映导出。"
---

# vectcut-local（本机剪辑大脑）

编排 **digital-human-studio** 插件的 `dh_*` 工具 + 本机 VectCut（默认 `http://127.0.0.1:9001`，根目录 `/Users/jiacong/VectCutAPI`）。  
**不要**调用云端 VectCutSkill、不要要 API Key、不要上传素材到第三方。

细则按任务读：

- `rules/扫草稿.md` — 选文件夹、列出并加载草稿
- `rules/混剪.md` — 新建草稿 → 多段加片 → 保存进剪映
- `rules/加片.md` — 在已有草稿上追加本地视频

## 工具一览（只许用这些）

| 工具 | 用途 |
|------|------|
| `dh_engine_status` | 查 9001 是否在线 |
| `dh_engine_start` / `dh_engine_stop` | 启停本机 VectCut（插件托管 PID） |
| `dh_get_workspace` | 当前文件夹 / draft_id / draft_path |
| `dh_list_drafts` | 扫描剪映草稿父目录 |
| `dh_load_draft` | 按 path 或 name 加载并设为当前草稿 |
| `dh_create_draft` | 新建草稿（默认 1080×1920） |
| `dh_add_video` | 加本地路径或 http URL（可 `path` / `paths`） |
| `dh_save_draft` | 写入剪映草稿目录（auto_deploy） |
| `dh_export_draft` / `dh_export_status` | 本机导出；多数本地构建无接口会失败 → 改走剪映 |

会话里没有 `dh_*` 时：提醒启用 **数字人工作室** 插件 / 新开对话，勿改用 ChatCut/Concat，除非用户点名。

## 固定主流程

1. **引擎**：`dh_engine_status`；离线则 `dh_engine_start`，仍失败则原样转述错误与 `start_command`。
2. **工作区**：`dh_get_workspace`。无文件夹则问用户，或默认  
   `~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft`，再用 `dh_list_drafts` 记住。
3. **草稿**：改旧稿 → `dh_list_drafts` + `dh_load_draft`；新混剪 → `dh_create_draft`（竖屏 1080×1920 / 横屏 1920×1080）。
4. **素材**：收集本机 **绝对路径**（`~/...` 可），按顺序 `dh_add_video`（多文件用 `paths`）。
5. **保存**：`dh_save_draft`（可指定 `draft_folder` / `project_name`）。
6. **成片**：告知在 **剪映** 打开同名草稿预览/导出。可试 `dh_export_draft`，404/失败时不要硬撑，明确「请用剪映导出」。
7. **回报**：`draft_id`、保存路径、侧栏「数字人工作室」可继续点。

## 占位能力（未接本地后端前）

| 能力 | 现状 | Agent 行为 |
|------|------|------------|
| TTS 配音 | stub → Jamie 自有 TTS | 要文案与音色偏好；说明「配音后端未接」；有现成 mp3/wav 绝对路径可记下来，待 `dh_add_audio` 类工具就绪再挂 |
| 生图 / 封面 | stub → Jamie 自有生图 | 收集提示词与尺寸；不调云端生图；有本地图片路径先记下，待 `dh_add_image` 就绪 |
| 数字人镜头 | stub | 同：只收集脚本/形象偏好，不调外部数字人云 |

用户催配音/生图时：给最短接入计划（自有 HTTP → 落盘 → 再 `dh_add_*`），**禁止**退回 VECTCUT_API_KEY 云流程。

## 约束

- 素材优先本机绝对路径；勿臆造路径。路径不存在就问用户。
- 时间线顺序 = `dh_add_video` 调用顺序（或 `paths` 数组顺序）。
- 不编造不存在的 `dh_*`；以工具列表为准。
- 与 `auto-cut`（Concat）/ `chatcut` 互斥：用户说本机混剪/剪映草稿/数字人工作室时用本 skill。
- 商用成片验收标准未定时，保存后请用户在剪映目检再导出。

## 触发例句

- 「扫一下剪映草稿」「加载刚才那个草稿」
- 「用这几段本地视频混剪」「新建竖屏草稿并加片」
- 「保存进剪映」「启动/关掉 VectCut 引擎」
