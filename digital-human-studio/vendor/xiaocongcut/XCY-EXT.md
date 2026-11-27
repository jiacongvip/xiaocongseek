# Xiaocongcut 通用扩展（xcy_ext.py）

旁挂 Flask Blueprint，**官方路由一行不改**。目的是让引擎本身具备"通用素材能力"，
任何调用方（插件、脚本、别的客户端）都能直接用，不依赖 digital-human-studio。

## 安装

两个新文件放进 Xiaocongcut 根目录：`xcy_ext.py`、`xcy_smoke.py`。
`capcut_server.py` 末尾加这三行（其余官方代码原样保留）：

```python
try:
    from xcy_ext import xcy_bp
    app.register_blueprint(xcy_bp)
except Exception as _xcy_err:
    print(f'[xcy_ext] not loaded: {_xcy_err}')
```

官方升级覆盖 `capcut_server.py` 后，只需把这 3 行重贴回去。

## 现有能力

`GET /xcy` —— 能力索引，返回下面这些的清单（加新接口记得登记）。

### 1. 参数化花字 `POST /xcy/add_styled_text`

```json
{
  "text": "这批砖别买错",
  "style": "hook_yellow",
  "draft_id": "dfd_cat_xxx",
  "draft_folder": "/Users/me/Movies/JianyingPro/User Data/Projects/com.lveditor.draft",
  "start": 0.5, "end": 2.5,
  "font_size": 96, "max_width": 940,
  "pos": "lower_third",
  "intro": "Slide_Up", "intro_duration": 0.45
}
```

返回：`{ success, draft_id, png, style, font_size, size, intro, cached }`

- 预设：`hook_yellow`（黄底黑字）/ `subtitle_white`（白字黑描边）/ `warn_orange`（橙底白字）/ `shop_sign`（深红底金字）/ `title_gold`（金字深棕描边）/ `plain`（纯白）/ `custom`（自填 `fg` `bg` `stroke` `stroke_width` `radius`）
- 位置：`pos` = `lower_third`（-0.58，默认）/ `center` / `top`；也可直接给 `transform_y`
- 入场：`Fade_In` / `Slide_Up` / `Mini_Zoom`；传 `null` 不动画
- 超宽自动缩字号（`max_width`，默认 940，1080 画布安全区）
- 按「文字+样式+字号+尺寸」指纹缓存在 `~/.xiaocongcut/cache/styled-text/`

### 2. 本地音频 `POST /xcy/add_local_audio`

```json
{
  "path": "/Users/me/sfx/whoosh.wav",
  "draft_id": "dfd_cat_xxx",
  "draft_folder": "...",
  "target_start": 0.5,
  "volume": 0.35,
  "fade_in": 0.1, "fade_out": 0.15,
  "track_name": "sfx"
}
```

- 引擎自己转 mp3（192k），顺带做淡入淡出 —— 官方 `/add_audio` 没有 fade 参数
- 音量写进**片段**（`segment.volume`），剪映里还能再调
- 音频时长自动探测，不用手填
- **必须给绝对路径**：给 `http://` 也行，但保存草稿时引擎会再下载一次，多一跳

### 3. 配方出片 `POST /xcy/build`

把整条片子的描述（配方）直接交给引擎，引擎自己装配并落草稿。**这是引擎方法，不是外部脚本。**

```json
POST /xcy/build
{
  "base_dir": "/Users/me/recipes",
  "recipe": {
    "name": "门店避坑片",
    "draft_folder": "~/Movies/.../com.lveditor.draft",
    "clips": [{ "source": "a.mp4", "start": 0, "end": 3, "target": 0 }],
    "texts": [{ "text": "这批砖别买错", "style": "hook_yellow", "start": 0.4, "end": 2.6, "intro": "Slide_Up" }],
    "sfx": [{ "path": "whoosh.wav", "at": 0.4, "volume": 0.35 }]
  }
}
```

返回：`{ success, draft_id, draft_folder, plan[], warnings[] }`
`dry_run: true` 只算计划，不建草稿。

另有 `POST /xcy/build_file { "path": "recipes/demo.json" }`，按文件路径出片，顶层 `videos` 数组可批量。

### 4. 人像透明层 `POST /xcy/person_alpha`

```json
{ "path": "/path/人像.mp4", "model": "u2net", "start": 0, "end": 10 }
```

`start` / `end` 省略 = 整条片子；给了就只处理这一段（缓存也按区间分开算）。

把人从背景里抠出来，输出带 alpha 的 **ProRes 4444 mov**（`yuva444p12le`），
按源文件指纹缓存在 `~/.xiaocongcut/cache/person-alpha/`。用途：放在文字层**上面**，文字就跑到人后面了，
而且文字仍然可编辑 —— 不用在剪映里手动点抠像。

代价：体积大（8.6 秒 / 768×1024 约 210MB），10 秒素材抠一次约 1.5 分钟。

### 5. 花字预设 `GET /xcy/styles`

返回预设名、位置名、当前字体路径。

## 加一个新能力（固定套路）

1. 在 `xcy_ext.py` 末尾加一个 `@xcy_bp.post('/xcy/xxx')`，函数体里：
   - `data = request.get_json(force=True, silent=True) or {}`
   - 校验参数，缺了就 `return jsonify({'success': False, 'error': '...'}), 400`
   - 干活：能复用官方 `*_impl` 函数就复用（`add_image_impl`、`add_audio_track` 都行）
   - 返回 `{'success': True, ...}`，失败返回 500 并带上原始错误
2. 在 `capability_index()` 里登记一行（method / path / summary / params）
3. 需要缓存的重资源放 `~/.xiaocongcut/cache/<类别>/`，用内容指纹做 key
4. 跑一遍 `xcy_smoke.py`，并在里面补一条校验

## 冒烟测试

```bash
cd ~/VectCutAPI
.venv/bin/python xcy_smoke.py            # 用内置音效
.venv/bin/python xcy_smoke.py /path.mp3  # 指定音频
```

它会：建草稿 → 加花字 → 加音效 → 保存 → 打开 `draft_info.json` 校验
（图片素材 1 张、动画 1 条、音频素材 1 个、片段音量非空），最后一次输出 `PASS / FAIL`。
草稿落在临时目录，跑完自动删。

## 已知坑

- 音效素材如果传 `xcy://...` 这类自定义协议，`save_draft` 会当远程地址去下载然后失败 —— 用绝对路径
- `add_audio_track` 的 `volume` 落在片段上，不在素材上，别去素材里找
- 引擎重启才会加载 `xcy_ext.py` 的改动（改完记得重启 9001）

---

## 配方出片（长期做视频的入口）

接口是"零件"，`xcy_build.py` 是"装配线"，并且**已经挂成引擎接口**（`POST /xcy/build`）。
两条路都能走：命令行适合本机批量/CI，接口适合别的客户端调用。

```bash
cd ~/VectCutAPI
.venv/bin/python xcy_build.py recipes/demo.json            # 出草稿
.venv/bin/python xcy_build.py recipes/demo.json --dry-run  # 只看计划
```

配方长这样（`recipes/demo.json` 可直接改）：

```json
{
  "name": "门店避坑片",
  "size": [1080, 1920],
  "draft_folder": "~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft",
  "vars": { "店名": "老陈瓷砖", "卖点": "这批砖别买错" },
  "clips": [
    { "source": "assets/clip1.mp4", "start": 0, "end": 3, "target": 0 },
    { "source": "assets/clip2.mp4", "start": 0, "end": 3, "target": 3 }
  ],
  "texts": [
    { "text": "{{卖点}}", "style": "hook_yellow", "start": 0.4, "end": 2.6, "intro": "Slide_Up" },
    { "text": "{{店名}}", "style": "shop_sign", "start": 3.2, "end": 5.6, "intro": "Fade_In" }
  ],
  "sfx": [
    { "path": "~/.../whoosh.wav", "at": 0.4, "volume": 0.35, "fade_in": 0.08 }
  ],
  "bgm": { "path": "bgm.mp3", "volume": 0.12 }
}
```

- `{{变量}}` 由 `vars` 替换 —— 同一套配方换个店名就是一版
- 路径可以是绝对路径，也可以是**相对配方文件**的相对路径
- 批量：顶层写 `{ "videos": [配方1, 配方2, ...] }`
- 素材缺失会**在建草稿之前**报错，不会产出一条空片
- 产出是剪映草稿，不是 mp4；要 mp4 在剪映里导，或用插件的本地 FFmpeg 导出
- `clips[].matte: "person"` —— 这层的人像会被抠成透明层叠在最上面，文字就落在人后面（文字仍可编辑）
- 只需要开头几秒有这个效果时，给区间：`"matte": {"start": 0, "end": 10}` —— **只抠这一段**，
  10 分钟的片子只处理前 10 秒（否则整片拆帧要几十 GB、跑两小时）。区间是**源文件内的秒数**，
  会自动夹到该片段自己的 start/end 内；透明层按区间长度落在时间线对应位置。
- 透明素材落盘时引擎会统一命名成 `.mp4`，出片后会自动改名 `.mov` 并回写引用（不改就认不出透明通道）

实测（2 段视频 + 2 个花字 + 2 个音效）落盘结果：
`video_main` 两段 0/3s、`styled_text` 两段 0.4/3.2s（Slide Up / Fade In）、`sfx` 两段（音量 0.35 / 0.3）。

## 未做

- 批量花字（一句多卡）
- 花字与音效的时间对齐（比如自动把音效卡到花字入场）

---

## 配方直接渲染成片 `POST /xcy/render`（主力路径）

不经过剪映、不写草稿：配方进，mp4 出。异步任务，先拿 `task_id` 再轮询。

```bash
# 1. 提交
curl -X POST http://127.0.0.1:9001/xcy/render -H 'Content-Type: application/json' -d '{
  "path": "recipes/鸡蛋配送-成片.json",
  "out": "~/Movies/xcy-out/demo.mp4",
  "preset": "final",
  "hardware": true
}'
# → {"success":true,"task_id":"rnd_xxx","out":"..."}

# 2. 轮询
curl http://127.0.0.1:9001/xcy/render/rnd_xxx
# → {"status":"running","progress":42.5,"stage":"编码渲染",...}
#    status: queued / running / done / error / cancelled

# 3. 取消
curl -X POST http://127.0.0.1:9001/xcy/render/rnd_xxx/cancel
```

请求体三种写法都行：`{"recipe":{...}}`、`{"path":"配方文件"}`、或把配方字段直接平铺（`base_dir` / `out` / `preset` / `hardware` 会被剔出来）。

**渲染链路（从下到上）**

```
黑底 → 片段层（含画中画）→ 花字层（带入场动画）→ 透明人像层 → 字幕烧入 → 编码
```

**支持的配方字段**

| 字段 | 作用 |
|---|---|
| `size` / `fps` | 画布与帧率 |
| `clips[].source/start/end/target` | 素材与时间线位置（缺 `target` 则顺接） |
| `clips[].matte` | `"person"` 或 `{"start":0,"end":10}`：人像抠出叠顶层，文字落到人后 |
| `clips[].pip` | `{x,y,width}` 画中画（0–1 比例） |
| `texts[]` | 花字：`style` / `start` / `end` / `pos` / `intro` / `font_size` |
| `subtitles` | `mode: inline \| file(srt)`、`style`（douyin_bottom / clean_center / box_bottom） |
| `sfx[]` | `path` / `at` / `volume` / `fade_in` / `fade_out` |
| `audio.bgm` | `path` / `volume` / `duck: "voice"`（说话时自动压低）/ `loop` |
| `audio.loudness.target_lufs` | 成片响度，默认 -14 |

**实测数据**（768×1024，M2 MacBook，硬件编码）

| 场景 | 结果 |
|---|---|
| 8.6 秒 + 3 花字 + 3 音效 + 字幕 | 编码 1.5 秒；含首次抠像约 90 秒 |
| 10 分钟（600 秒），只开头 10 秒抠像 | 见下节记录 |
| 响度 | -14.2 LUFS / TP -1.5 dB |

**已知边界**

- 转场（`transition_in`）、变速（`speed`）、推拉（`keyframes`）在配方里**已接受但暂未生效**，属于 M3
- 字幕 `mode: auto`（自动转写）尚未接入，属于 M2；现在用 `inline` 或 `file`(.srt)
- 首次对某段素材抠像约 9 秒/秒素材，之后同源同区间走缓存

---

## 转写与自动字幕 `POST /xcy/transcribe`

本地跑 faster-whisper，不上传任何素材。

```bash
curl -X POST http://127.0.0.1:9001/xcy/transcribe -H 'Content-Type: application/json' -d '{
  "path": "/path/口播.mp4",
  "model": "small",
  "language": "zh",
  "max_chars": 14,
  "srt_out": "/tmp/口播.srt"
}'
# → {"success":true,"segments":[{"start":0.05,"end":2.21,"text":"..."}],"raw_count":4,"srt":"..."}
```

- `model`：`tiny` 快但错字多；`small`（默认）平衡；`medium` 更准更慢
- `words: true` 出**词级时间**（`segments[].words`），逐字点亮要用；文件大一倍、慢约两成
- 结果按「文件指纹 + 模型 + 语言」缓存，同一素材第二次 <1 秒
- 输出已做**简体化**（whisper 常出繁体，用 zhconv 转）
- `segments` 已按 `max_chars` 合并成适合竖屏的行

**配方里直接用**：

```json
"subtitles": { "mode": "auto", "source": "clips[0]", "model": "small", "max_chars": 14, "style": "douyin_bottom" }
```

`source` 可以写 `clips[0]`（取第 0 个片段的源文件）或绝对路径。

依赖：`faster-whisper`、`zhconv`、新版 `av`。模型缓存在 `~/.xiaocongcut/cache/asr-models/`。
PyAV 19 去掉了 `metadata_errors` 参数（faster-whisper 仍会传），模块里已做兼容包装，不需要锁版本。

---

## 变速 / 推拉 / 转场（配方字段已生效）

```json
{
  "clips": [{
    "source": "a.mp4", "start": 0, "end": 4, "target": 0,
    "speed": 1.5,
    "keyframes": [{ "at": 0, "scale": 1.0 }, { "at": 4, "scale": 1.10 }],
    "transition_in": { "type": "fade", "duration": 0.4 },
    "pip": { "x": 0.72, "y": 0.22, "width": 0.28 }
  }]
}
```

| 字段 | 行为 | 注意 |
|---|---|---|
| `speed` | 0.25–4 倍速，音轨用 atempo 跟帧同步 | 时间轴长度 = 源长 / speed |
| `keyframes.scale` | 首尾缩放线性插值（缓慢推近/拉远） | 基于 zoompan 逐帧，分辨率越大越慢 |
| `transition_in.type` | `fade`（交叉溶解）/ `slide_up` / `slide_left` | 前一段会自动多留几帧克隆帧，避免黑场 |
| `pip` | 画中画，x/y/width 为画布比例 | 与 matte 可叠加 |

实现上的两个关键点（改代码前先看）：

1. `tpad` 必须在 `setpts` 变速**之前**，且时长要乘 speed，否则补帧被吞掉
2. 底图必须是 `rgba`，否则 overlay 会把透明补边当不透明黑块（滑动转场变"黑片盖住下面"）

---

## 批量渲染 `POST /xcy/render_batch`

一次出多条（多店 / 多城市），每条可配不同文案，共用同一套素材。

```bash
curl -X POST http://127.0.0.1:9001/xcy/render_batch -H 'Content-Type: application/json' -d '{
  "path": "recipes/批量-三店示例.json",
  "out_dir": "~/Movies/xcy-out",
  "concurrency": 2,
  "qc": true
}'
# → {"success":true,"batch_id":"bat_xxx","total":3}

curl http://127.0.0.1:9001/xcy/render_batch/bat_xxx
# → {"status":"done","done":3,"failed":0,"items":[{...同名/out/qc...}]}
```

配方文件顶层写 `{"videos":[配方1,配方2,...]}` 即可批量，单条结构完全不变。
`concurrency` 1–4，默认 2（每路渲染本身吃多核，开太猛反而慢）。

---

## 成片质检 `POST /xcy/qc`

渲染完成后自动跑（可用 `"qc": false` 关掉）。也可以对已有成片单独查。

```json
POST /xcy/qc { "path": "out.mp4", "expected_duration": 8.6, "expected_size": [1080,1920] }
```

返回 `status: pass | warn | fail` 与逐项 `checks`：

| 检查 | 判定 |
|---|---|
| 时长 | 与期望差 >0.6s 报 warn，>2s 判 fail |
| 黑帧 | 单段 ≥0.4s 报 warn，≥2s 判 fail |
| 声音 | 整条无声判 fail；单段静音 ≥2s 报 warn |
| 响度 | 超出 -24 ~ -8 LUFS 报 warn |
| 分辨率 | 与配方不一致报 warn |
| 编码 | 非 h264 报 warn |

阈值集中在 `xcy_qc.py` 顶部，要放宽改常量即可。

---

## 花字避让 `pos: auto` + `avoid: person`

默认花字放画面中心，人脸正好也在中心，字会被挡掉一半。开启避让后，
按人像 alpha 找位置，优先贴在人像头顶上方。

```json
"texts": [
  { "text": "一客一价", "style": "hook_yellow", "start": 0.3, "end": 2.9,
    "pos": "auto", "avoid": "person" }
]
```

**算法**（`xcy_layout.py`）

1. 取花字出现那一段的人像 alpha（复用 `person_alpha` 缓存，不重复抠）
2. 按行统计"这一行有多少像素是人"，多帧平均（防逐帧抖）
3. 首选：整条字落在人像最上一行之上（贴头顶，留 1.2% 画布间距）
4. 人像几乎占满画面时：滑动窗口找最空的一条水平带（覆盖率 ≤0.15 才算"压不着"）
5. 都不行：退回画面偏上位置

**实测**：同一条片子，同一句花字，遮挡率 **60% → 0%**；无避让时只露出左右两个边。

**注意**：避让要算 alpha，首次会触发抠像（约 9 秒/秒素材），之后同源同区间走缓存。
只想裁剪、不改花字位置的片子不要开。

---

## 字幕样式层（三种新样式 + 关键词 + 安全区）

`xcy_style.py`。字幕不再只有"白字黑边"一种，也不再一律贴在最底下。

### 样式

| style | 长什么样 | 什么时候用 |
|---|---|---|
| `douyin_bottom` | 白字 + 3px 黑边（原来的） | 深色背景，最通用 |
| `bar_bottom` | 半透明黑底条 + 白字描边 | 白墙、雪地、天花板、浅色背景多 |
| `keyword` | 白字打底，价格/否定/品类词标黄 | 讲价格、讲结论、"别家做不到" |
| `karaoke` | 逐字变黄（念到哪儿亮到哪儿） | 口播跟读感，视线被牵着走 |
| `clean_center` / `box_bottom` | 旧样式，保留兼容 | — |

```json
"subtitles": {
  "mode": "auto",
  "style": "keyword",
  "highlight": { "mode": "keyword", "color": "#ffd600", "max_per_line": 2,
                 "blacklist": ["免费"], "lexicon": ["阶梯价", "整箱"] },
  "safe": { "top": 0.12, "bottom": 0.12 },
  "avoid_face": true
}
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `style` | `douyin_bottom` | 见上表 |
| `highlight.mode` | 关 | `keyword`/`auto` 开自动标色；`style: keyword` 时会自动开 |
| `highlight.color` | `#ffd600` | 十六进制或 `&H00BBGGRR` 都收 |
| `highlight.max_per_line` | 2 | 每行最多标几处，防"满屏黄" |
| `highlight.blacklist` | 空 | 这些词永不标（"免费"容易被误标时加） |
| `highlight.bar_alpha` | 0.45 | 底条不透明度（0–1） |
| `safe.top/bottom` | 0.12 / 0.12 | 平台安全区，字幕不进这两条带 |
| `avoid_face` | true | 字幕带压到头上时自动抬到头顶上方 |

### 关键词怎么抽（`pick_keywords`）

优先级：**价格数字 > 纯数字 > 否定词 > 品类词表 > 句尾结论（最后 4 字）**，
每行取前 `max_per_line` 个，重叠的丢掉（描边叠加会糊）。

- 价格：`\d+(\.\d+)?[元块毛角万千百斤件箱个天年折%]`
- 否定：千万别/不要/不能/不会/不用/不是/别买/别选/别家
- 品类词：`DEFAULT_LEXICON` 30 个交易类高频词，配方里可用 `lexicon` 追加
- 句尾结论：句子 ≥8 字、没以标点收尾时，最后 4 字算结论

> 抽检口径：20 句里 ≥16 句标对。宁少勿多，标错就加 `blacklist`。

### 逐字点亮要词级时间

```bash
curl -X POST http://127.0.0.1:9001/xcy/transcribe -d '{"path":"口播.mp4","words":true}'
# → segments[].words = [{"start":0.13,"end":0.31,"text":"业"}, ...]
```

配方里 `"style": "karaoke"` 且 `mode: auto` 时，渲染器会**自动带 `words: true`**，
不用手动开。缓存按「文件+模型+语言+是否要词」分开存，两种都留着不互相覆盖。

### 相关接口

| 接口 | 用途 |
|---|---|
| `GET /xcy/subtitle_styles` | 样式清单 + 安全区 + 词表（界面拉下拉框用） |
| `POST /xcy/subtitle_preview` | 出一张预览 PNG（base64），可传 `bg` 指素材、`at` 指秒数 |
| `POST /xcy/subtitle_words` | 只跑关键词抽取，看会标哪几个词，不渲染 |
| `POST /xcy/render` 的 `overrides` | 临时换样式重渲，不用改配方文件 |

```bash
# 换个样式重渲一遍
curl -X POST http://127.0.0.1:9001/xcy/render -d '{
  "path": "recipes/xxx.json", "preset": "final",
  "overrides": { "subtitle_style": "bar_bottom", "avoid_face": false }
}'

# 样式预览图
curl -X POST http://127.0.0.1:9001/xcy/subtitle_preview -d '{
  "style": "bar_bottom", "text": "一客一价，不是看人下菜",
  "bg": "/path/口播.mp4", "at": 1.5 }'
# → {"success":true,"image":"data:image/png;base64,..."}
```

### 避脸：不压脸

1. 抠 0.6 秒（片段中点）的人像 alpha —— 整条抠太贵（8.6 秒要 90 秒）
2. `xcy_layout.head_band()` 找"头部带"：从人像最上一行往下，行宽先变宽（脸）再收窄（脖子），
   第一次明显收窄就是脖子；头发盖住脖子时退回"头高 22%"，并夹在 30% 以内
3. alpha 是**源片**分辨率，要先按画布缩放/居中换算，否则字幕跑到错误高度
4. 字幕带（底部 12% 起）与头部带重叠 → 抬到头顶上方（留 1.2% 间隙），仍不出顶部 12%

实测（把素材垫高 464px 模拟低机位）：不避脸字幕压在下巴上 → 避脸后整条字落到头顶上方。

### 三个坑（改代码前先看）

1. **ASS 的 `BackColour` 做不出半透明底条** —— 这版 libass 直接忽略 alpha，底条会变成纯黑一块。
   改成用 `drawbox=color=black@0.45` 画在字幕下面，`xcy_style.build_subtitles()` 返回的
   `bars[]` 就是矩形清单（x/y/w/h/start/end/alpha）。
2. **libass 的 Fontsize 只有 0.75 倍宽** —— 字号 51 时 PIL 量 561px、实际画 423px。
   量底条宽度必须乘 `LIBASS_SIZE_FACTOR = 0.75`，否则底条宽出一大截。
3. **逐字不能用半透明白做"未读"** —— 浅背景上直接看不见。现在没用到的字是**白字**，
   念到的字**变黄**，任何背景都读得出来。

---

## 声音层（人声增强 + BGM）

`xcy_audiofx.py`。口播原片是手机/相机直录，房间混响和底噪都在；BGM 走本地曲库，不联网。

```json
"audio": {
  "voice_fx": "clean",
  "bgm": { "mode": "auto", "genre": "business", "tone": "steady", "volume": 0.12 }
}
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `voice_fx` | `off` | `off` / `clean` / `strong`，只作用于**片段原声**，音效与 BGM 不处理 |
| `bgm.mode` | 有 path 就 `path`，否则 `auto` | `auto` 从曲库按 genre/mood/bpm 挑 |
| `bgm.genre` / `tone` | `business` / — | 见曲库 sidecar 里的 `genre` / `mood` |
| `bgm.volume` | 0.12 | BGM 基准音量（会被响度归一化兜底） |
| `bgm.duck` | auto 时 true | 人声一出现，BGM 自动让路（sidechaincompress，低 ≥6dB） |
| `bgm.fade_in/out` | 0.5 / min(1.2, 时长×0.1) | 开头结尾不突兀 |
| `bgm.loop` | true | 曲子短于片子就循环 |

**实测**（给素材人为加 -40dB 粉噪，同一段音频对比）：

| 档位 | 底噪 | 信噪比 |
|---|---|---|
| 关 | 0 | 29.0 dB |
| `clean` | **-11.8 dB** | 32.9 dB |
| `strong` | **-16.0 dB** | 37.7 dB |

成片响度仍在 -14±1 LUFS（实测 -14.8）。

**曲库**：`~/VectCutAPI/assets/bgm/` 与插件 `assets/music/` 两处都扫。
每个音频文件旁边可以放同名 `.json`：`{"genre":"business","bpm":100,"mood":"steady"}`；
没有 sidecar 就按文件名猜（lively/steady/calm…）。`GET /xcy/bgm` 看当前曲库。

---

## 画面层（LUT 调色 + 白平衡 + 背景虚化）

`xcy_look.py`。三个 LUT 在代码里生成 `.cube`，**强度直接烘焙进 LUT**（identity 与风格线性插值），
所以不需要 blend 两条流。

```json
"look": { "lut": "warm_soft", "strength": 0.8, "wb": true, "bg_blur": 12, "bg_dim": 0.2 }
```

| 字段 | 说明 |
|---|---|
| `lut` | `none` / `warm_soft`（暖调柔光）/ `clean_cool`（干净冷调）/ `film_soft`（胶片柔调），也可给 `.cube` 绝对路径 |
| `strength` | 0–1，量化到 0.05 做缓存（`~/VectCutAPI/assets/luts/`） |
| `wb` | `true` 自动白平衡（灰度世界，增益夹在 ±10%）；也可直接给 `{"r":0.96,"g":1.0,"b":1.05}` |
| `bg_blur` | 背景高斯模糊 sigma（建议 8–14） |
| `bg_dim` | 背景压暗量（0–0.4） |

**只作用素材**，字幕和花字不跟着调色 —— 字幕是信息层，变黄变暖反而脏。

**背景虚化的做法**：原片 → 糊 + 压暗当底；人像 alpha → **腐蚀 3px**（把粘在边上的背景剥掉）
→ 羽化 1.2 → 当遮罩把清晰人像贴回去。少了腐蚀那步，人像边缘会有一圈发光的描边。

**实测**：肤色 ΔE(CIE76)=0.83（要求 ≤6）；8.6 秒片渲染 6–8 秒（含首次抠像则另算）。

**代价**：`bg_blur` 要抠整段人像（约 9 秒/秒素材），第一次慢，之后走 `person_alpha` 缓存。
只想要调色别开虚化。

### 相关接口

| 接口 | 用途 |
|---|---|
| `GET /xcy/luts` | 调色预设清单 |
| `GET /xcy/bgm` | 曲库 + 元数据 |
| `GET /xcy/voice_fx` | 人声档位 |

---

## 包装层（箭头/圈注 + 片头片尾 + 按停顿切镜）

`xcy_pack.py` 画图形和整屏卡；切镜在 `xcy_render._apply_rhythm` 里。

### 图形标注 `graphics[]`

```json
"graphics": [
  { "type": "arrow", "at": 3.9, "dur": 1.6, "x": 0.72, "y": 0.52,
    "size": 0.22, "rotate": -18, "color": "#ffd600", "animate": "fade" }
]
```

| 字段 | 说明 |
|---|---|
| `type` | `arrow` / `circle` / `box` / `underline` |
| `x` `y` | 图形**中心**在画布的比例位置 |
| `size` | 画布宽度比例：箭头=长度，圆圈=直径，框=宽度，下划线=长度 |
| `rotate` | 旋转角度（箭头常用 −25～−15 指细节） |
| `thick` | 线宽（画布宽度比例，默认 0.012） |
| `aspect` | 只对 `box` 有效，高/宽比（默认 0.42） |
| `animate` | `fade`（默认）/ `slide_up` / `none` |

图形画在**人物层之上**（标注要看得见），字幕之下。

### 片头 / 片尾 `intro` `outro`

```json
"intro": { "text": "一客一价", "sub": "新老客户不同价", "dur": 2.2, "accent": "#ffd600" },
"outro": { "text": "量大从优", "sub": "3 块 5 一斤，整箱更便宜", "dur": 2.4 }
```

**这两段是"加时长"，不是"盖画面"**：片头把整条时间轴后移 `dur` 秒，片尾把总时长往后延。
盖在画面上等于把开场那句口播吃掉，早期就是这么错的。

注意：`intro` 之后的 `texts[].start`、`graphics[].at`、`sfx[].at`、字幕时间**仍按内容时间写**
（从 0 开始算），渲染器会统一加偏移。所以加不加片头，配方主体不用改。

### 按停顿切镜 `rhythm`

```json
"rhythm": { "cut_on_pause": true, "zoom": [1.02, 1.06], "min_shot": 2.2, "max_shot": 7 }
```

1. 转写这条片段（`xcy_subtitle`，走缓存）
2. 取句子结束时间当切点，短于 `min_shot` 的并、长于 `max_shot` 的等分
3. 每镜交替 1.02→1.06 / 1.06→1.02 轻微推拉（一直往一个方向推会晕）
4. 镜头之间**硬切**，不加交叉溶解

**和背景虚化互斥**：虚化要整段抠像，切开就是逐镜重抠（8 秒素材抠四次，慢且吃内存）。
检测到 `look.bg_blur/bg_dim` 时自动不切，`plan.rhythm.skipped` 会标出来。
变速片段、带关键帧或画中画的片段也不切，免得搅乱已经排好的运镜。

### 相关接口

`GET /xcy/graphics` —— 图形类型清单 + 卡片默认参数。

### 坑

- 卡片文字按画布宽度自适应缩字号，但**不会自动换行**；一句话太长请自己在 `text` 里断。
- 图形 PNG 按参数指纹缓存（`~/.xiaocongcut/cache/pack/`），改颜色/大小会生成新文件，不会污染旧的。
