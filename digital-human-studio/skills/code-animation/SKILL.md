---
name: code-animation
description: 内置 341 种 HTML Canvas/SVG 代码动画风格提示词库与逐帧 MP4/WebM 无损渲染器。当用户要求制作代码动画、MG 动画、信息图动态插片、动态片头、数据/价格/流程对比动画，或口播中段缺少实拍空镜适合插入高质感信息动画时触发。
---

# 代码动画（341 种风格库 + 确定性渲染）

本机已内置全量 **341 种代码动画风格提示词**（含 193 张静帧预览）以及 **Chromium + ffmpeg 逐帧无损渲染器**，文字 100% 锐利、零生视频 API 费用，既能独立出片，也能直接拼进口播中段当高颜值动态插片（B-roll）。

## 什么时候用

1. 用户明确说「做个代码动画 / MG 动画 / 动态信息图 / 片头 / 用 L42（或 Z5、B6 等）风格」。
2. 口播视频里讲到 **数据对比、价格拆解、步骤流程、痛点清单、产品结构、金句强调** 且缺少合适实拍空镜时，可主动建议「这段我帮你用代码动画做个 4~6 秒的动态插片拼进去」。
3. 不要把 341 种风格一次全列出，也不要自己瞎猜不存在的编号——必须先查索引再精读单篇。

## 标准 4 步工作流

### 第 1 步：检索风格（按需查，省 Token）
- 调用 `dh_list_code_anim_styles`（外部 MCP 为 `xiaocong_anim_styles_list`）：
  - 不确定用哪款时，传 `query`（如 `"对比"`、`"流程"`、`"水墨"`、`"黑板"`、`"霓虹"`、`"剪纸"`）或 `series`（`L` 商业信息图、`M` 动态叙事、`H` 版式、`K` 卡通手绘、`Z` 中国风、`AG` 代码样片、`V` MG 动效、`X` code-video、`R` 赛博电影、`O` 奥斯卡 98 部）。
  - 口播商业插片优先推荐 `L`（如 `L42`、`L10`、`L1`）、`H`、`M`、`V` 系列。

### 第 2 步：精读选中的那 1 份风格提示词
- 调用 `dh_get_code_anim_style(id="L42", orientation="vertical")`（外部 MCP 为 `xiaocong_anim_style_get`）。
  - 做竖屏口播插片时传 `orientation="vertical"`（`1080×1920`）；横屏片头/科普传 `orientation="horizontal"`（`1920×1080`）。
- 若需要贴合客户品牌，先读公司档案（`dh_get_brief` / `xiaocong_company_brief`）拿到真实产品名、卖点、数字和禁忌。

### 第 3 步：写出完整单文件 `index.html`
- **自包含**：只用原生 HTML + CSS + JS + Canvas/SVG，不引用外网 CDN/外链图片/外链字体（中文直接用系统黑体/宋体回退栈）。
- **必须确定性渲染**：
  1. 暴露全局 `window.draw = draw`（以及 `window.__draw = draw`）和 `window.__T_END = 总秒数`；
  2. 所有动画位置/透明度/缩放完全由参数 `t`（秒）纯函数算出，随机必须用带种子的 PRNG（如 `mulberry32`），禁止 `Math.random()`；
  3. 读取 `new URLSearchParams(location.search).get('t')`：带 `?t=秒` 时只执行 `draw(t)` 不启动 `requestAnimationFrame` 循环；
  4. **竖屏适配**：竖屏口播插片画布设为 `1080×1920`（避开顶部 14% 和底部 22% 字幕/标题安全区），字体放大到手机竖屏一眼看清。

### 第 4 步：逐帧渲染成 MP4 / 透明 WebM（并可选拼进口播）
- 调用 `dh_render_code_anim`（外部 MCP 为 `xiaocong_anim_render`）：
  - 传入 `html`（或本地 `html_path`）、`width`（竖屏 `1080` / 横屏 `1920`）、`height`（竖屏 `1920` / 横屏 `1080`）、`fps`（默认 `30`）、`duration`（秒）。
  - 若要把动画透明叠在人物旁边，传 `transparent: true` 输出带 Alpha 通道的 `.webm`。
  - 传 `import_to_works: true`（配 `title`）可直接登记进当前公司成片库；也可直接把返回的 `output` MP4 路径送入 `dh_render_recipe` / `dh_add_video` 拼进口播视频中段（记得把插片轨音量设为 0，保持原口播人声不断）。
