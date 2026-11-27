---
name: xiaocongcut-local
description: "本机视频剪辑与混剪工作台（Digital Human Studio + 本地 Xiaocongcut 引擎 9001）。用户要剪辑视频、加字幕、去气口、配 BGM/花字/音效、混剪成片、或读写剪映草稿时必用。只用 dh_* 工具，禁止 VECTCUT_API_KEY / 云端远程上传。默认直接渲染成 mp4 并自动入成片库；仅当用户明确要求进剪映二次精剪时才走草稿模式。"
---

# xiaocongcut-local（本机剪辑大脑）

编排 **digital-human-studio** 插件的 `dh_*` 工具 + 随包本地 Xiaocongcut 引擎（默认 `http://127.0.0.1:9001`，所有 `dh_*` 剪辑工具在引擎离线时都会**自动拉起并重试**，正常情况无需先手动调 `dh_engine_start`）。
**不要**调用云端剪辑接口、不要要 API Key、不要把本地素材上传到第三方剪辑服务。

细则按任务读：

- `rules/扫草稿.md` — 用户要操作剪映草稿时：选文件夹、列出并加载草稿
- `rules/混剪.md` — 门店混剪路线（仅门店/行业场景）
- `rules/加片.md` — 在已有剪映草稿上追加本地视频

## 两条路线（先选对路线，一步到位）

### 路线 A（默认首选）：快速剪辑直出 mp4（无需剪映，出片自动进「成片库」）

适合 90% 的日常剪辑需求：加字幕、关键词标色、按停顿切镜、人声降噪、自动配 BGM、调色、背景虚化、加片头片尾/花字/音效、多段素材拼接。

| 工具 | 用途 |
|------|------|
| `dh_probe_video` | 探测素材时长、宽高、帧率、是否存在（下刀前先探，不要猜时长） |
| `dh_transcribe` | 本地语音转字幕（faster-whisper，支持词级时间与导出 `.srt`），听清口播内容/找切点 |
| `dh_list_editing_presets` | 一次查询所有可用预设（字幕样式 / 调色 LUT / 包装图形 / BGM 曲库 / 人声增强 / 花字 / 现成配方） |
| `dh_quick_edit` | **【优先使用】** 传 `paths` 或 `clips` + 常用开关，一步构建配方、直出 mp4 并自动入「成片库」 |
| `dh_render_recipe` | 复杂定制时直接传完整配方对象 `recipe` 或配方文件 `path` 渲染成 mp4，完成后自动入「成片库」 |
| `dh_render_status` | 查异步渲染进度或取消任务；完成后自动入「成片库」 |
| `dh_render_batch` | 批量配方渲染（多店/多版本并发出片 + 自动质检） |
| `dh_qc_video` | 成片质检（黑帧 / 静音 / 响度 / 时长 / 分辨率） |

**推荐最短流程（2–3 步出片）**：
1. 若用户只给了视频路径且没说明细节：需要了解内容或卡点时先 `dh_probe_video`（口播精剪可加 `dh_transcribe`）；若用户直接说“加字幕/配BGM/去气口/拼起来”，直接调 `dh_quick_edit`。
2. `dh_quick_edit` 默认开启：自动判横竖屏 + 烧入避脸字幕（`douyin_bottom` / `keyword` / `bar_bottom` / `karaoke`）+ 人声降噪（`clean`）+ 自动选曲压人声（`bgm: "auto"`）；长片可传 `wait_sec: 0` 后用 `dh_render_status` 跟进。
3. 出片完成后，回报：**成片路径 `out`、时长与大小、已自动登记进「成片库」（可直接在工作台播放、写三平台文案或排期发布）**；若有质量要求顺手跑一次 `dh_qc_video`。

### 路线 B（按需）：剪映草稿模式（用户明确要在剪映里二次精剪 / 改旧草稿）

| 工具 | 用途 |
|------|------|
| `dh_get_workspace` | 当前草稿文件夹 / draft_id / draft_path |
| `dh_list_drafts` / `dh_load_draft` | 扫描或加载已有剪映草稿 |
| `dh_create_draft` | 新建草稿（竖屏 1080×1920 / 横屏 1920×1080） |
| `dh_add_video` / `dh_add_audio` | 向草稿追加本地视频或音频片段 |
| `dh_list_voices` / `dh_set_voice` / `dh_clone_voice` / `dh_add_narration` | 配音与声音克隆上轨（不要用本机 `say`） |
| `dh_find_music` / `dh_list_music` / `dh_set_music` / `dh_add_music` | 本地内置曲库 / `~/.dsh/music` / 素材柜选曲上轨 |
| `dh_list_sfx` / `dh_add_sfx` | 本地 33 种音效上轨 |
| `dh_list_local_text_styles` / `dh_add_local_styled_text` | 本地 Pillow 渲染 22 种花字贴图进草稿 |
| `dh_add_text` / `dh_list_native_text_effects` | 剪映原生可编辑文字 |
| `dh_save_draft` | 写入剪映草稿目录（auto_deploy） |
| `dh_export_draft` / `dh_export_status` | 导出草稿（若接口返回 404 会自动回退本地 FFmpeg 渲染，或提示去剪映导出） |
| `dh_engine_status` / `dh_engine_start` / `dh_engine_stop` | 仅排障或用户要求手动启停引擎时使用 |

## 素材与扩展能力

- **素材入库**：用户给了一个文件夹时，先 `dh_ingest_local_folder` 入库，再 `dh_list_materials` 查看目录卡，未标注的用 `dh_label_materials` 写清用途，不要反复通读整个文件夹。
- **数字人与生图**：已有正式工具 `dh_avatar_create_video` / `dh_avatar_create_audio` / `dh_avatar_create_image` / `dh_avatar_task` 以及封面绘制 `dh_paint_work_cover`，需要时直接调用。
- **已知限制**：`cut_on_pause`（按停顿切镜）与 `bg_blur`（背景虚化）互斥，引擎会在开启虚化时自动跳过切镜；片头/片尾卡为“加时长”模式，不会吞掉开头口播。

## 约束

- 素材优先本机绝对路径；勿臆造路径，文件不存在先确认路径。
- 不编造不存在的工具或 MCP（不要调 `mcp__conte-de-fees__*`）。
- 会话里没有 `dh_*` 工具时：提醒用户确认插件 `digital-human-studio` 已启用并新开对话。
- 对客户说话用大白话，不暴露内部脚本名、配方字段名或技能名。

## 触发例句

- 「帮我把这段视频剪一下」「加个字幕和背景音乐」「去气口」「做成抖音竖屏」
- 「把这几个视频拼在一起混剪」「做条能爆的口播视频」
- 「扫一下剪映草稿」「保存成剪映草稿」「帮我检查一下成片质量」
