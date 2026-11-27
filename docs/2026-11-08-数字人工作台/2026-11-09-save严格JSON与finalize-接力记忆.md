# 2026-11-09 save 严格 JSON 与 finalize — 接力记忆

> 用户 t52u / pt52u：「你弄」。承接 t51u 复测：pop/PNG/meta 已好，但 `dh_save_draft` 报 `invalid output: value is not lossless JSON`；假设 output 对象被 `String()` 成 `[object Object]` 导致 finalize 未跑。
> 时区 Asia/Shanghai。源码核实后修复。未重启 9001/3080。

## 源码核实（非仅转述）

1. VectCut `/save_draft` 的 `output` 现为对象 `{draft_url,success,task_id}`（`save_draft_impl` 返回 dict）。
2. DH `saveDraft` 曾用 `String(result.data.output)` → `[object Object]`，`existsSync` 失败，finalize 不执行；返回里带 `assetCheck: undefined`，不满足 Cordis lossless JSON。
3. 本机 `~/Movies/JianyingPro/.../com.lveditor.draft` 存在，Containers 路径不存在；旧逻辑只在 Containers 部署分支按 `project_name` 命名，**直接 draft_folder 分支只写 `draft_id` 目录名**。
4. 模板 `draft_meta_info` 引用 `draft_cover.jpg`，但 `template/` 中无该文件。

## 修复

### DH
- `src/save-draft-result.ts`：解析 object/string output；受控根内才 finalize；`toLosslessJson`/`processSaveDraftResponse`（handler 同路径）
- `src/draft-save-finalize.ts`：content 镜像含 `draft_content.json`；封面仅真实视频抽帧，失败则清空 meta 引用（不造假封面）
- `src/index.ts`：`dh_save_draft` 走上述核心；保存成功但 finalize 失败 → `saved:true` + `warning`，不盲重试

### VectCut
- `save_draft_impl.py`：`draft_folder` 下按 `project_name` 安全重命名；同名不覆盖（`name__draftId`）；部署分支识别 Movies 路径；同根跳过重复拷贝；部署冲突不推翻已成功的 draft_folder 结果

## 备份
`.backup-save-json-finalize-20261109-150249/`

## 测试
- `digital-human-studio/tests/save-draft-result.mjs`：object/string/error/域外路径/undefined 剥离/重复 finalize — ALL_PASS
- `artifacts/isolated-save-json/`：project_name 命名、同名不覆盖、封面抽帧、content 镜像
- 误测 `auto_deploy=True` 曾短暂写入 Movies/`deploy_skip_case`，已立即删除；其它真实草稿未动

## 进程（未重启）
- 9001 PID 25983、3080 PID 26057 仍为旧进程；dist 已更新（约 15:07），**需确认后重启二者才加载**

## 仍待验收
- 用户侧 `dh_save_draft` 不再报 lossless JSON
- finalize 后出现 `draft_content.json`；有视频则有真实 `draft_cover.jpg`，否则 meta 不引用缺失封面
- `draft_folder` 下目录名=project_name；同名不覆盖
