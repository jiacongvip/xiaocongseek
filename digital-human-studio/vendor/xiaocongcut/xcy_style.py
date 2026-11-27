"""xcy_style.py —— 字幕样式层

三件事，都只跟"字幕长什么样、放哪儿"有关，不碰视频本身：

1. **样式**：底条 `bar_bottom` / 关键词标色 `keyword` / 逐字点亮 `karaoke`，
   旧的 `douyin_bottom`、`clean_center`、`box_bottom` 原样保留。
2. **关键词**：规则抽取（数字价格、否定词、品类词、句尾结论），不引 NLP 依赖。
3. **安全区**：底部 12% 留给抖音/视频号的按钮，字幕不上抬到顶部 12%；
   给了头部区间（人像 mask 算的）就避开脸。

用法
----
    from xcy_style import build_ass, pick_keywords

    ass = build_ass(segs, 1080, 1920, 'keyword',
                    highlight={'mode': 'keyword', 'color': '#ffd600'},
                    head={'top': 620, 'bottom': 980})
    open('sub.ass', 'w').write(ass)

设计上的两个坑（都踩过）
----------------------
- ASS 的颜色是 `&HAABBGGRR`，十六进制要倒着写，别直接贴 `#RRGGBB`。
- 逐字点亮靠 `\\kf`，它吃的是**本行内的相对时长（厘秒）**，不是绝对时间；
  并且要靠 SecondaryColour → PrimaryColour 的过渡才看得出"点亮"。
"""
from __future__ import annotations

import os
import re

# 安全区默认值：上下各 12%（底部是平台按钮区，顶部是标题/返回按钮区）
DEFAULT_SAFE = {'top': 0.12, 'bottom': 0.12}

# 头部区间兜底高度：估不出人像头部时，按画面高度的 22% 估
HEAD_FALLBACK_H = 0.22

SUB_STYLES: dict[str, dict] = {
    'trendy_red': {
        'label': '网感口播 · 高级红',
        'desc': '思源粗宋中英双语 + 8–12 字错落分层 + 关键词高级红厚白描边放大',
        'size': 0.048, 'color': '&H00FFFFFF', 'outline': 3, 'bold': 1, 'shadow': 2,
        'font': 'Source Han Serif SC Bold',
        'highlight': '#A81C23', 'kw_outline_color': '#FFFFFF', 'kw_outline': 8, 'kw_scale': 1.18,
        'en_font': 'Helvetica Neue Light', 'en_size': 0.022,
        'trendy': True,
    },
    'trendy_gold': {
        'label': '黑金杂志',
        'desc': '思源粗宋暖白字 + 错落双语 + 关键词香槟金厚黑边放大',
        'size': 0.048, 'color': '&H00EEF6FF', 'outline': 3, 'bold': 1, 'shadow': 2,
        'font': 'Source Han Serif SC Bold',
        'highlight': '#E5B54F', 'kw_outline_color': '#1A1410', 'kw_outline': 7, 'kw_scale': 1.18,
        'en_font': 'Helvetica Neue Light', 'en_size': 0.022,
        'trendy': True,
    },
    'trendy_cyan': {
        'label': '极简白青',
        'desc': '兰亭黑清爽双语 + 错落分层 + 关键词冰青放大',
        'size': 0.046, 'color': '&H00FFFFFF', 'outline': 3, 'bold': 1, 'shadow': 2,
        'font': 'Lantinghei SC Demibold',
        'highlight': '#00D4D8', 'kw_outline_color': '#0A1E24', 'kw_outline': 7, 'kw_scale': 1.16,
        'en_font': 'Helvetica Neue Light', 'en_size': 0.022,
        'trendy': True,
    },
    'douyin_bottom': {
        'label': '白字黑边',
        'desc': '思源特粗黑体白字 + 厚黑描边 + 柔投影，通用耐看',
        'size': 0.052, 'color': '&H00FFFFFF', 'outline': 4, 'bold': 1, 'shadow': 2,
        'font': 'Noto Sans SC',
    },
    'bar_bottom': {
        'label': '半透明底条',
        'desc': '黑底条压住浅色背景，白墙/雪地/天花板不糊',
        'size': 0.050, 'color': '&H00FFFFFF', 'outline': 8, 'bold': 1,
        'box': 1, 'back': '&H99000000', 'shadow': 0,
        'font': 'Noto Sans SC',
    },
    'keyword': {
        'label': '关键词标色',
        'desc': '特粗白字打底，价格/否定词/品类词标黄放大，讲结论时最抓眼',
        'size': 0.052, 'color': '&H00FFFFFF', 'outline': 4, 'bold': 1, 'shadow': 2,
        'highlight': '#ffd600',
        'font': 'Noto Sans SC',
    },
    'karaoke': {
        'label': '逐字点亮',
        'desc': '跟着口播逐字变黄；没念到的字仍是白字，任何背景都看得见',
        'size': 0.052, 'color': '&H0000D6FF', 'outline': 4, 'bold': 1, 'shadow': 2,
        'unsung': '&H00FFFFFF',
        'font': 'Noto Sans SC',
    },
    # 旧样式，保留兼容（v2 配方可能写的是这两个）
    'clean_center': {
        'label': '无描边居中',
        'desc': '无描边白字，适合深色纯背景',
        'size': 0.060, 'color': '&H00FFFFFF', 'outline': 0, 'bold': 0,
        'font': 'Lantinghei SC Demibold',
    },
    'douyin_black': {
        'label': '粗黑双语（模板）',
        'desc': '思源黑体 Black + 逐条定位/逐条字号，配合 segments 里的 pos/size/color/bar 使用',
        'size': 0.036, 'color': '&H006AE022', 'outline': 4, 'bold': 1,
        'font': 'Noto Sans SC',
    },
    'box_bottom': {
        'label': '底条（旧）',
        'desc': '旧版底条，等同 bar_bottom 的浅色版',
        'size': 0.050, 'color': '&H00FFFFFF', 'outline': 0, 'bold': 1, 'box': 1,
        'font': 'Noto Sans SC',
    },
}

# 词表：品类/交易类高频词。公司档案里的品类词可以在配方里追加。
DEFAULT_LEXICON = [
    '阶梯价', '一客一价', '批发价', '出厂价', '零售价', '到手价', '起送价',
    '送上门', '送货上门', '当天送', '隔天到', '包安装', '包售后', '包邮',
    '整箱', '整件', '起订', '起送', '返点', '利润', '成本', '损耗',
    '免费', '白送', '赠品', '优惠', '折扣', '活动', '名额', '限时',
]

# 否定/强调词：短视频里这些词是"结论"，最值得标出来
NEGATION = ['千万别', '不要', '不能', '不会', '不用', '不是', '别买', '别选', '别急', '别家']

_PRICE_RE = re.compile(r'\d+(?:\.\d+)?\s*(?:元|块|毛|角|万|千|百|斤|件|箱|个|天|年|折|%)')
_NUM_RE = re.compile(r'\d{2,}')


# ───────────────────────────── 颜色 ─────────────────────────────

def ass_color(value: str, default: str = '&H00FFFFFF') -> str:
    """`#ffd600` / `#fff` / `&H0000D6FF&` 都收，统一成 ASS 的 `&H00BBGGRR`。"""
    raw = str(value or '').strip()
    if not raw:
        return default
    if raw.startswith('&H') or raw.startswith('&h'):
        body = raw[2:].strip('&').upper()
        if len(body) == 6:
            body = '00' + body
        return '&H' + body[:8]
    if raw.startswith('#'):
        raw = raw[1:]
    if len(raw) == 3:
        raw = ''.join(c * 2 for c in raw)
    if len(raw) != 6 or not re.fullmatch(r'[0-9a-fA-F]{6}', raw):
        return default
    r, g, b = raw[0:2], raw[2:4], raw[4:6]
    # ASS 是 BGR 顺序，且 alpha=00 表示不透明
    return f'&H00{b}{g}{r}'.upper()


# ───────────────────────────── 样式 ─────────────────────────────

def resolve_style(name: str | None) -> dict:
    key = str(name or 'douyin_bottom')
    st = dict(SUB_STYLES.get(key) or SUB_STYLES['douyin_bottom'])
    st['id'] = key if key in SUB_STYLES else 'douyin_bottom'
    return st


def style_list() -> list[dict]:
    """给接口/界面用：网感口播 + 常用主推 + 兼容款。"""
    primary = ('trendy_red', 'trendy_gold', 'trendy_cyan', 'douyin_bottom', 'bar_bottom', 'keyword', 'karaoke')
    out = []
    for key, st in SUB_STYLES.items():
        out.append({
            'id': key,
            'label': st['label'],
            'desc': st['desc'],
            'primary': key in primary,
            'needs_words': key == 'karaoke',
        })
    return out


# ───────────────────────────── 关键词 ─────────────────────────────

def _spans_for_line(text: str, lexicon: list[str], blacklist: list[str],
                    max_per_line: int) -> list[dict]:
    """在单行文字里找值得标色的片段，按"价格 > 否定 > 词表 > 句尾"优先级取前 N 个。"""
    found: list[tuple[int, int, str, int]] = []   # (start, end, text, priority)

    for m in _PRICE_RE.finditer(text):
        found.append((m.start(), m.end(), m.group(0), 0))
    for m in _NUM_RE.finditer(text):
        found.append((m.start(), m.end(), m.group(0), 1))

    for word in NEGATION:
        for m in re.finditer(re.escape(word), text):
            found.append((m.start(), m.end(), word, 2))

    # 词表按长度倒序匹配，避免"价"把"阶梯价"拆开
    for word in sorted(lexicon, key=len, reverse=True):
        if not word or len(word) < 2:
            continue
        for m in re.finditer(re.escape(word), text):
            found.append((m.start(), m.end(), word, 3))

    # 句尾结论：最后 4 个字（没有标点收尾、句子够长时才算结论）
    tail = text[-4:]
    if len(text) >= 8 and tail and not re.search(r'[，,。.！!？?；;、]$', text):
        found.append((len(text) - 4, len(text), tail, 4))

    if blacklist:
        found = [f for f in found if not any(b and b in f[2] for b in blacklist)]

    # 去掉被别的片段完全包住的（"价"在"阶梯价"里面）
    found.sort(key=lambda f: (f[0], -(f[1] - f[0])))
    kept: list[tuple[int, int, str, int]] = []
    for f in found:
        if any(k[0] <= f[0] and f[1] <= k[1] for k in kept):
            continue
        kept.append(f)

    # 按优先级排，最多 N 个；重叠的丢掉（ASS 里叠加描边会变糊）
    kept.sort(key=lambda f: (f[3], f[0]))
    picked: list[dict] = []
    for start, end, word, prio in kept:
        if len(picked) >= max(1, int(max_per_line)):
            break
        if any(not (end <= p['start'] or start >= p['end']) for p in picked):
            continue
        picked.append({'start': start, 'end': end, 'text': word, 'kind': prio})
    picked.sort(key=lambda p: p['start'])
    return picked


def pick_keywords(segments: list[dict], lexicon: list[str] | None = None,
                  max_per_line: int = 2, blacklist: list[str] | None = None) -> dict:
    """返回 `{行号: [{start,end,text}]}`，start/end 是**字符偏移**，直接用于插颜色标签。"""
    lex = list(lexicon) if lexicon else list(DEFAULT_LEXICON)
    black = [b for b in (blacklist or []) if b]
    out: dict[int, list[dict]] = {}
    for i, seg in enumerate(segments):
        text = str(seg.get('text') or '')
        if not text:
            continue
        spans = _spans_for_line(text, lex, black, max_per_line)
        if spans:
            out[i] = spans
    return out


# ───────────────────────────── 逐字时间 ─────────────────────────────

def char_times(text: str, words: list[dict] | None, start: float, end: float) -> list[tuple]:
    """把一行文字拆成每字的起止时间。

    有词级时间就用词时间（词内按字数均分），没有就整行均分。
    最后强对齐到行的 end，避免累计误差把最后几个字吹到下一句。
    """
    n = max(1, len(text))
    span = max(0.05, float(end) - float(start))
    if not words:
        per = span / n
        return [(start + per * i, start + per * (i + 1)) for i in range(n)]

    total = sum(max(0.001, float(w.get('end', 0)) - float(w.get('start', 0))) for w in words) or 1.0
    out: list[tuple] = []
    t = float(start)
    for w in words:
        wl = max(1, len(str(w.get('text') or '')))
        wd = (float(w.get('end', 0)) - float(w.get('start', 0))) / total * span
        per = wd / wl
        for _ in range(wl):
            out.append((t, t + per))
            t += per
    if len(out) > n:
        out = out[:n]
    elif len(out) < n:
        tail = (float(end) - (out[-1][1] if out else float(start))) / max(1, n - len(out))
        t = out[-1][1] if out else float(start)
        while len(out) < n:
            out.append((t, t + tail))
            t += tail
    out[-1] = (out[-1][0], float(end))
    return out


# ───────────────────────────── ASS 生成 ─────────────────────────────

def _esc(text: str) -> str:
    return str(text or '').replace('\\', '').replace('{', '(').replace('}', ')').replace('\n', r'\N')


def _ass_time(sec: float) -> str:
    sec = max(0.0, float(sec))
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec % 60
    return f'{h}:{m:02d}:{s:05.2f}'


def _est_lines(text: str, canvas_w: int, font_size: int) -> int:
    """估这行会在画布里折成几行（PingFang 中文约 1 字 1 em）。"""
    per_line = max(1, int(canvas_w * 0.86 / max(8, font_size)))
    return max(1, min(3, -(-len(text) // per_line)))


def band_bottom(canvas_h: int, text_h: int, safe: dict | None = None,
                head: dict | None = None, gap_ratio: float = 0.012) -> dict:
    """算字幕块的底边像素位置。

    默认贴安全区底边（88%）；若头部区间跟字幕带重叠（大特写/低机位），
    把字幕抬到头顶上方，但不出顶部安全区。
    """
    s = dict(DEFAULT_SAFE)
    s.update({k: v for k, v in (safe or {}).items() if v is not None})
    bottom = int(canvas_h * (1.0 - float(s['bottom'])))
    top_limit = int(canvas_h * float(s['top']))
    mode = 'safe_bottom'

    if head:
        h0 = int(head.get('top') or 0)
        h1 = int(head.get('bottom') or 0)
        if h1 > h0 > 0 and not (h1 <= bottom - text_h or h0 >= bottom):
            gap = max(8, int(canvas_h * gap_ratio))
            cand = h0 - gap
            if cand - text_h >= top_limit:
                bottom = cand
                mode = 'above_head'
            else:
                bottom = max(top_limit + text_h, min(bottom, h1 - gap))
                mode = 'nudge'
    return {'bottom': int(bottom), 'top': int(bottom - text_h), 'mode': mode,
            'margin_v': int(canvas_h - bottom)}


def _body(seg: dict, spans: list[dict], st: dict, color: str, base_fs: int | None = None) -> str:
    text = str(seg.get('text') or '')
    if not spans:
        return _esc(text)
    kw_oc = ass_color(st['kw_outline_color']) if st.get('kw_outline_color') else ''
    kw_bord = int(st.get('kw_outline') or 0)
    kw_scale = float(st.get('kw_scale') or 1.0)
    base_color = str(st.get('color') or '&H00FFFFFF')
    base_bord = int(st.get('outline') or 3)
    out: list[str] = []
    pos = 0
    for sp in sorted(spans, key=lambda s: s['start']):
        a, b = max(0, int(sp['start'])), min(len(text), int(sp['end']))
        if b <= a or a < pos:
            continue
        out.append(_esc(text[pos:a]))
        if kw_oc and base_fs:
            kw_fs = max(base_fs + 4, int(round(base_fs * kw_scale)))
            # 网感关键词：放大 + 主题主色 + 厚反色描边 + 轻弹动，随后显式复原样式避免破坏行级 \pos
            pop = r'\t(0,180,\fscx112\fscy112)\t(180,320,\fscx100\fscy100)'
            open_tag = f'{{\\c{color}\\3c{kw_oc}\\bord{kw_bord}\\fs{kw_fs}\\b1{pop}}}'
            close_tag = f'{{\\c{base_color}\\3c&H00000000\\bord{base_bord}\\fs{base_fs}\\fscx100\\fscy100}}'
            out.append(open_tag + _esc(text[a:b]) + close_tag)
        else:
            out.append('{\\c' + color + '\\b1}' + _esc(text[a:b]) + '{\\r}')
        pos = b
    out.append(_esc(text[pos:]))
    return ''.join(out)


_PUNC_STRIP_RE = re.compile(r'[\s，。！？、,.!?；;：:“”""\'\'（）()《》\-—…·]+')


def _split_staggered(text: str) -> tuple[str, str]:
    """8–12 字错落双行切分：优先在中间附近的标点/空格切，否则按中点切。"""
    s = str(text or '').strip()
    n = len(s)
    if n <= 1:
        return s, ''
    mid = n // 2
    for offset in (0, -1, 1, -2, 2):
        idx = mid + offset
        if 2 <= idx <= n - 2 and s[idx] in '，。！？、,.;；：: ':
            left = s[:idx].strip()
            right = s[idx + 1:].strip()
            if left and right:
                return left, right
    return s[:mid].strip(), s[mid:].strip()


def _split_en_halves(en_text: str) -> tuple[str, str]:
    words = str(en_text or '').strip().split()
    if len(words) < 4:
        return '', str(en_text or '').strip()
    mid = len(words) // 2
    return ' '.join(words[:mid]), ' '.join(words[mid:])


def _find_keyword_span(text: str, keyword: str) -> list[dict]:
    kw = str(keyword or '').strip()
    if not kw or not text:
        return []
    idx = text.rfind(kw)
    if idx < 0:
        return []
    return [{'start': idx, 'end': idx + len(kw), 'text': kw}]


def _karaoke_body(seg: dict, st: dict) -> str:
    text = str(seg.get('text') or '')
    if not text:
        return ''
    times = char_times(text, seg.get('words') or None, float(seg['start']), float(seg['end']))
    parts: list[str] = []
    for ch, (a, b) in zip(text, times):
        if ch in '\n':
            parts.append(r'\N')
            continue
        cs = max(1, int(round((b - a) * 100)))
        parts.append(f'{{\\kf{cs}}}' + _esc(ch))
    return ''.join(parts)


# libass 把 Fontsize 当"点"来算，实际画出来只有 0.75 倍宽（实测 STHeiti，
# 字号 51 时 PIL 量 561px、libass 画 423px）。量宽要乘这个系数，否则底条会宽出一截。
LIBASS_SIZE_FACTOR = 0.75


def text_width(text: str, font_size: int) -> int:
    """量一行字画出来有多宽（像素）。量不准就按 0.75 em 估，别让底条塌掉。"""
    raw = str(text or '')
    try:
        import xcy_ext as X          # 懒加载：共用同一套字体挑选逻辑
        font = X._load_font(int(font_size))
        return int(font.getlength(raw) * LIBASS_SIZE_FACTOR)
    except Exception:                 # noqa: BLE001
        return int(len(raw) * font_size * LIBASS_SIZE_FACTOR)


def build_subtitles(segments: list[dict], canvas_w: int, canvas_h: int,
                    style: str = 'douyin_bottom', *,
                    highlight: dict | None = None,
                    highlights: dict | list | None = None,
                    safe: dict | None = None,
                    head: dict | None = None,
                    auto_y: bool = False,
                    out_path=None) -> dict:
    """生成字幕。返回 {ass, bars, style, lines}。

    `bars` 是底条要画的矩形（像素 + 时间段），由渲染器用 drawbox 画：
    **不能用 ASS 的 BackColour 做半透明**——实测这版 libass 会忽略它，
    底条会变成纯黑一块（白墙上像贴了块膏药）。

    每行的 MarginV 写在 Dialogue 行里（ASS 允许逐行覆盖），
    所以同一份字幕里"这行贴底、那行抬到头顶"是能混的。
    """
    st = resolve_style(style)
    boxed = bool(st.get('box'))
    font_size = max(24, int(float(canvas_h) * float(st['size'])))
    # 底条自己画，字就用普通描边（厚 3px），别再用 ASS 的 BorderStyle=3
    outline = 3 if boxed else int(st.get('outline') or 0)
    shadow = 0 if st.get('shadow') == 0 else 1

    # 关键词：显式 spans / 单条 seg.keyword 优先，其次是 highlight.mode / 样式本身
    hl = dict(highlight or {})
    color = ass_color(hl.get('color') or st.get('highlight') or '#ffd600')
    want_auto = (
        st['id'] == 'keyword'
        or bool(st.get('trendy'))
        or str(hl.get('mode') or '') in ('keyword', 'auto', 'on')
    )
    if isinstance(highlights, dict):
        # JSON 里 key 是字符串，统一转 int 才能按行号命中
        spans_map = {int(k): v for k, v in highlights.items()}
    elif isinstance(highlights, list):
        spans_map = {i: v for i, v in enumerate(highlights) if v}
    elif want_auto:
        spans_map = pick_keywords(
            segments,
            lexicon=hl.get('lexicon') or None,
            max_per_line=1 if st.get('trendy') else int(hl.get('max_per_line') or 2),
            blacklist=hl.get('blacklist') or None,
        )
    else:
        spans_map = {}

    # 每条字幕显式指定 keyword（来自网感口播语义规划）时，覆盖自动关键词（传 "" 表示本句不高亮）
    for i, sg in enumerate(segments):
        if 'keyword' in sg:
            kw_raw = str(sg.get('keyword') or '').strip()
            spans_map[i] = _find_keyword_span(str(sg.get('text') or ''), kw_raw) if kw_raw else []

    margin_lr = int(canvas_w * 0.06)
    base_bottom = int(canvas_h * (1.0 - float((safe or DEFAULT_SAFE).get('bottom', DEFAULT_SAFE['bottom']))))
    dialogues: list[str] = []
    bars: list[dict] = []
    used = 0
    # 逐条字体：seg.font 指定字体名时生成独立 Style 行（libass 按 fontsdir 解析）
    extra_styles: dict[str, str] = {}
    # 渐变字幕：libass 只支持单色，带 gradient 的条抽出来交给 renderer 用 PIL 画渐变 PNG
    grads: list[dict] = []

    # 自动避让的分组预计算：同一时间重叠、开了 auto_y 的 pos 字幕，
    # 按原纵向顺序整体贴到人像下方，组内自动堆叠，避免互相叠字。
    auto_group: dict[int, int] = {}
    if auto_y or any(sg.get('auto_y') for sg in segments):
        n = len(segments)
        ths = [0] * n
        for i, sg in enumerate(segments):
            t = str(sg.get('text') or '').strip()
            if not t:
                continue
            f = int(sg.get('size') or font_size)
            # pos 字幕按实际行数（\N 手动换行）估算：整行宽折行估算会把大字当两行，堆叠会顶到脸上
            lines = max(1, t.count('\\N') + 1)
            ths[i] = int(f * 1.32 * lines)

        def _auto_on(sg):
            return bool(sg.get('pos')) and (auto_y or sg.get('auto_y'))

        parent = list(range(n))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for i in range(n):
            if not _auto_on(segments[i]):
                continue
            for j in range(i + 1, n):
                if not _auto_on(segments[j]):
                    continue
                si, sj = segments[i], segments[j]
                try:
                    if float(si['start']) < float(sj['end']) and float(sj['start']) < float(si['end']):
                        parent[find(j)] = find(i)
                except (KeyError, TypeError, ValueError):
                    pass
        groups: dict[int, list[int]] = {}
        for i in range(n):
            if _auto_on(segments[i]):
                groups.setdefault(find(i), []).append(i)
        gap = max(8, int(canvas_h * 0.008))
        for _root, idxs in groups.items():
            idxs.sort(key=lambda i: float((segments[i].get('pos') or {}).get('y') or 0))
            band = band_bottom(canvas_h, sum(ths[i] for i in idxs) + gap * (len(idxs) - 1), safe, head)
            y = band['top']
            for i in idxs:
                auto_group[i] = y
                y += ths[i] + gap

    for i, seg in enumerate(segments):
        text = str(seg.get('text') or '').strip()
        if not text:
            continue
        try:
            start, end = float(seg['start']), float(seg['end'])
        except (KeyError, TypeError, ValueError):
            continue
        if end <= start:
            continue
        used += 1

        # 渐变/软阴影条不走 ass：收集原始参数，renderer 用 PIL 画 PNG 叠在人像前
        gcfg = seg.get('gradient')
        if (isinstance(gcfg, dict) and ((gcfg.get('from') and gcfg.get('to')) or gcfg.get('stops'))) or seg.get('soft_shadow'):
            gp = seg.get('pos') or {}
            grads.append({
                'text': text, 'start': start, 'end': end,
                'size': int(seg.get('size') or font_size),
                'color': str(seg.get('color') or '#FFFFFF'),
                'font': str(seg.get('font') or '').strip(),
                'font_file': str(seg.get('font_file') or '').strip(),
                'scale_x': int(seg.get('scale_x') or 100),
                'scale_y': int(seg.get('scale_y') or 100),
                'outline': int(seg.get('outline') if seg.get('outline') is not None else 3),
                'outline_color': str(seg.get('outline_color') or '#000000'),
                'shadow': int(seg.get('shadow') or 0),
                'x': int(gp.get('x', 0)) if isinstance(gp, dict) else int(gp[0]),
                'y': int(gp.get('y', 0)) if isinstance(gp, dict) else int(gp[1]),
                'an': int(gp.get('an', 5)) if isinstance(gp, dict) else 5,
                'from': str(gcfg['from']) if isinstance(gcfg, dict) and gcfg.get('from') else '',
                'to': str(gcfg['to']) if isinstance(gcfg, dict) and gcfg.get('to') else '',
                'dir': str(gcfg.get('dir') or 'v') if isinstance(gcfg, dict) else 'v',
                'stops': list(gcfg.get('stops') or []) if isinstance(gcfg, dict) else [],
            })
            continue

        # ── 网感口播高级排版通道（中英双语 + 8–12 字错落分层 + 关键词放大弹动）──
        if st.get('trendy') and not seg.get('pos') and not seg.get('raw'):
            fsz = int(seg.get('size') or font_size)
            en_text = str(seg.get('en') or seg.get('translation') or '').strip()
            en_fs = max(18, int(float(canvas_h) * float(st.get('en_size') or 0.022)))
            en_font = str(st.get('en_font') or 'Helvetica Neue Light')
            en_style = extra_styles.setdefault((en_font, 100, 100), f'SF{len(extra_styles) + 1}')

            eff_len = len(_PUNC_STRIP_RE.sub('', text))
            is_layered = bool(seg.get('layered')) or (eff_len >= 8 and len(text) >= 8)
            seg_spans = spans_map.get(i) or []

            if is_layered:
                top_txt, bot_txt = _split_staggered(text)
                split_at = text.find(bot_txt, len(top_txt)) if bot_txt else len(top_txt)
                top_spans = [sp for sp in seg_spans if sp['end'] <= len(top_txt)]
                bot_spans = [
                    {'start': sp['start'] - split_at, 'end': sp['end'] - split_at, 'text': sp.get('text', '')}
                    for sp in seg_spans
                    if sp['start'] >= split_at
                ]
                # 左上 + 右下错落双行（避开顶部标题区和底部平台按钮安全区）
                top_x = int(canvas_w * 0.09)
                top_y = int(canvas_h * 0.67)
                bot_x = int(canvas_w * 0.91)
                bot_y = int(canvas_h * 0.77)
                top_body = f'{{\\an4\\pos({top_x},{top_y})}}' + _body({'text': top_txt}, top_spans, st, color, fsz)
                bot_body = f'{{\\an6\\pos({bot_x},{bot_y})}}' + _body({'text': bot_txt}, bot_spans, st, color, fsz)
                dialogues.append(f'Dialogue: 1,{_ass_time(start)},{_ass_time(end)},Default,,0,0,0,,{top_body}')
                if bot_txt:
                    dialogues.append(f'Dialogue: 1,{_ass_time(start)},{_ass_time(end)},Default,,0,0,0,,{bot_body}')
                if en_text:
                    en_top, en_bot = _split_en_halves(en_text)
                    en_off = int(fsz * 0.66)
                    if en_top:
                        dialogues.append(
                            f'Dialogue: 0,{_ass_time(start)},{_ass_time(end)},{en_style},,0,0,0,,'
                            f'{{\\an7\\pos({top_x},{top_y + en_off})\\fs{en_fs}\\bord1.5\\shad1\\3c&H00222222&}}{_esc(en_top)}'
                        )
                    if en_bot:
                        dialogues.append(
                            f'Dialogue: 0,{_ass_time(start)},{_ass_time(end)},{en_style},,0,0,0,,'
                            f'{{\\an9\\pos({bot_x},{bot_y + en_off})\\fs{en_fs}\\bord1.5\\shad1\\3c&H00222222&}}{_esc(en_bot)}'
                        )
            else:
                cy = int(canvas_h * 0.76)
                cx = int(canvas_w * 0.50)
                cn_body = f'{{\\an2\\pos({cx},{cy})}}' + _body({'text': text}, seg_spans, st, color, fsz)
                dialogues.append(f'Dialogue: 1,{_ass_time(start)},{_ass_time(end)},Default,,0,0,0,,{cn_body}')
                if en_text:
                    dialogues.append(
                        f'Dialogue: 0,{_ass_time(start)},{_ass_time(end)},{en_style},,0,0,0,,'
                        f'{{\\an8\\pos({cx},{cy + int(fsz * 0.16)})\\fs{en_fs}\\bord1.5\\shad1\\3c&H00222222&}}{_esc(en_text)}'
                    )
            continue

        # ── 逐条覆盖（模板用的就是这套：@pos 精确定位 / 逐条字号颜色描边 / raw 矢量图形）──
        fsz = int(seg.get('size') or font_size)
        pos = seg.get('pos')
        ov: list[str] = []
        if pos:
            if isinstance(pos, dict):
                px, py, an = int(pos.get('x', 0)), int(pos.get('y', 0)), int(pos.get('an', 5))
            else:
                px, py, an = int(pos[0]), int(pos[1]), 5
            ov += [f'\\an{an}', f'\\pos({px},{py})']
        if seg.get('size'):
            ov.append(f'\\fs{fsz}')
        if seg.get('color'):
            ov.append('\\c' + ass_color(seg['color']))
        if seg.get('outline') is not None:
            ov.append(f'\\bord{int(seg["outline"])}')
        if seg.get('outline_color'):
            ov.append('\\3c' + ass_color(seg['outline_color']))
        if seg.get('bold') is not None:
            ov.append(f'\\b{1 if seg["bold"] else 0}')
        if seg.get('shadow') is not None:
            ov.append(f'\\shad{int(seg["shadow"])}')
        if seg.get('letter_spacing'):
            ov.append(f'\\fsp{int(seg["letter_spacing"])}')

        if seg.get('raw'):
            body = text
        elif st['id'] == 'karaoke':
            body = _karaoke_body({**seg, 'text': text}, st)
        else:
            body = _body({**seg, 'text': text}, spans_map.get(i) or [], st, color, fsz)
        if ov:
            body = '{' + ''.join(ov) + '}' + body

        text_h = int(fsz * 1.32 * _est_lines(text, canvas_w, fsz))
        # 自动避让：即使写了固定 pos，也把纵坐标自动收到人像下方/底部安全带，
        # 保留 px（左右错位）与 an 锚点语义；head 由渲染器按人像检测给出。
        if pos and (auto_y or seg.get('auto_y')):
            th = ths[i] if ths[i] else text_h
            if i in auto_group:
                top_y = int(auto_group[i])
            else:
                band = band_bottom(canvas_h, th, safe, head)
                top_y = int(band['top'])
            if an in (1, 2, 3):
                new_py = top_y + th
            elif an in (4, 5, 6):
                new_py = top_y + th // 2
            else:
                new_py = top_y
            ov = [re.sub(r'\\pos\([^)]*\)', lambda _m: f'\\pos({px},{new_py})', o) for o in ov]
            body = '{' + ''.join(ov) + '}' + (body.split('}', 1)[1] if body.startswith('{') else body)
        if pos:
            ml = mr = mv = 0
        else:
            band = band_bottom(canvas_h, text_h, safe, head)
            ml = mr = margin_lr
            mv = band['margin_v']

        # 逐条字体：有 font 字段就切到对应 Style 行；scale_x/scale_y 支持瘦长/压扁比例
        style_used = 'Default'
        fname = str(seg.get('font') or '').strip()
        sx = int(seg.get('scale_x') or 100)
        sy = int(seg.get('scale_y') or 100)
        if fname or sx != 100 or sy != 100:
            style_used = extra_styles.setdefault((fname, sx, sy), f'SF{len(extra_styles) + 1}')

        dialogues.append(
            f'Dialogue: 0,{_ass_time(start)},{_ass_time(end)},{style_used},,'
            f'{ml},{mr},{mv},,{body}'
        )

        # 逐条底色块（显式矩形，交给 renderer 用 drawbox 画，颜色可指定）
        bar = seg.get('bar')
        if bar:
            if bar.get('x') is not None and bar.get('w') is not None:
                bx, by = int(bar['x']), int(bar['y'])
                bw, bh = int(bar['w']), int(bar['h'])
            else:
                padx = int(bar.get('pad_x', 40)); pady = int(bar.get('pad_y', 14))
                bw = text_width(text, fsz) + padx * 2
                bh = int(fsz * 1.32) + pady * 2
                cx = px if pos else int(canvas_w / 2)
                cy = py if pos else int(canvas_h / 2)
                bx = int(cx - bw / 2); by = int(cy - bh / 2)
            bars.append({
                'x': bx, 'y': by, 'w': bw, 'h': bh,
                'color': str(bar.get('color') or '#000000'),
                'alpha': float(bar.get('alpha', 1.0)),
                'start': round(start, 3), 'end': round(end, 3),
            })

        if boxed:
            pad_x = int(font_size * 0.42)
            pad_y = int(font_size * 0.30)
            w = min(int(canvas_w * 0.94), text_width(text, font_size) + pad_x * 2)
            h = text_h + pad_y * 2
            y = max(0, min(canvas_h - h, band['bottom'] - text_h - pad_y))
            bars.append({
                'x': int((canvas_w - w) / 2), 'y': int(y), 'w': int(w), 'h': int(h),
                'start': round(start, 3), 'end': round(end, 3),
                'alpha': float(hl.get('bar_alpha') or 0.45),
            })

    primary = st['color']
    secondary = st.get('unsung') if st['id'] == 'karaoke' else '&H000000FF'
    back = '&H00000000'
    font_name = str(st.get('font') or 'Noto Sans SC')
    shadow = int(st.get('shadow') if st.get('shadow') is not None else shadow)
    style_line = (
        f'Style: Default,{font_name},{font_size},{primary},{secondary or "&H00FFFFFF"},'
        f'&H00000000,{back},{int(st.get("bold") or 0)},0,0,0,100,100,'
        f'1,0,1,{outline},{shadow},2,{margin_lr},{margin_lr},'
        f'{int(canvas_h - base_bottom)},1'
    )

    style_lines = [style_line]
    for (fname, sx, sy), sname in extra_styles.items():
        sl = style_line.replace(f'Style: Default,', f'Style: {sname},')
        if fname:
            sl = sl.replace(f',{font_name},{font_size},', f',{fname},{font_size},', 1)
        if sx != 100 or sy != 100:
            sl = sl.replace(',100,100,', f',{sx},{sy},', 1)
        style_lines.append(sl)

    ass = (
        '[Script Info]\n'
        'ScriptType: v4.00+\n'
        f'PlayResX: {canvas_w}\n'
        f'PlayResY: {canvas_h}\n'
        'WrapStyle: 0\n'
        'ScaledBorderAndShadow: yes\n'
        '\n'
        '[V4+ Styles]\n'
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, '
        'BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, '
        'BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
        + '\n'.join(style_lines) + '\n'
        '\n'
        '[Events]\n'
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    )
    if dialogues:
        ass += '\n'.join(dialogues) + '\n'

    if out_path:
        from pathlib import Path
        Path(out_path).write_text(ass, encoding='utf8')

    return {'ass': ass, 'bars': bars, 'style': st['id'], 'lines': used, 'grads': grads}


def build_ass(segments: list[dict], canvas_w: int, canvas_h: int,
              style: str = 'douyin_bottom', *, out_path=None, **kwargs) -> str:
    """只要 ASS 文本时用这个（底条样式会丢 bars，出片请用 build_subtitles）。"""
    return build_subtitles(segments, canvas_w, canvas_h, style,
                           out_path=out_path, **kwargs)['ass']


# ───────────────────────────── 样式预览 ─────────────────────────────

def preview_png(text: str, style: str = 'douyin_bottom', canvas: tuple = (768, 1024),
                bg: str | None = None, at: float = 1.0,
                highlight: dict | None = None, safe: dict | None = None,
                head: dict | None = None) -> bytes:
    """出一张"这句字幕长什么样"的 PNG（给界面挑样式用，不整片渲染）。

    bg 给一个视频/图片路径就从里面抽一帧当底；不给就画一段灰蓝渐变，
    这样任何机器上都能预览，不依赖素材。
    """
    import base64
    import shutil
    import subprocess
    import tempfile
    from pathlib import Path

    ffmpeg = os.environ.get('XCY_FFMPEG') or shutil.which('ffmpeg') or 'ffmpeg'
    w, h = int(canvas[0]), int(canvas[1])
    tmp = Path(tempfile.mkdtemp(prefix='xcy-sub-prev-'))
    try:
        frame = tmp / 'frame.png'
        if bg and os.path.exists(os.path.expanduser(bg)):
            src = os.path.expanduser(bg)
            cmd = [ffmpeg, '-y', '-v', 'error']
            if Path(src).suffix.lower() not in ('.png', '.jpg', '.jpeg'):
                cmd += ['-ss', f'{max(0.0, float(at)):.2f}']
            cmd += ['-i', src, '-frames:v', '1',
                    '-vf', f'scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}',
                    str(frame)]
            subprocess.run(cmd, check=True, timeout=60)
        else:
            _dummy_backdrop(w, h).save(frame)

        sub = build_subtitles(
            [{'start': 0.0, 'end': 2.0, 'text': text}], w, h, style,
            highlight=highlight, safe=safe, head=head,
            out_path=tmp / 'p.ass',
        )
        ap = str(tmp / 'p.ass').replace('\\', '\\\\').replace(':', '\\:').replace("'", "\\'")
        chain = []
        if sub['bars']:
            b = sub['bars'][0]
            chain.append(f"drawbox=x={b['x']}:y={b['y']}:w={b['w']}:h={b['h']}:"
                         f"color=black@{b['alpha']:.2f}:t=fill")
        chain.append(f"ass=filename='{ap}'")
        out = tmp / 'out.png'
        subprocess.run([ffmpeg, '-y', '-v', 'error', '-i', str(frame),
                        '-vf', ','.join(chain), '-frames:v', '1', str(out)],
                       check=True, timeout=120)
        return out.read_bytes()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _dummy_backdrop(w: int, h: int):
    """没有素材时用的底图：上浅下深的灰蓝，接近白墙办公室的观感。"""
    import numpy as np
    from PIL import Image

    t = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
    rows = np.stack([232 - 72 * t, 234 - 70 * t, 238 - 64 * t], axis=-1)
    arr = np.repeat(rows, w, axis=1).astype('uint8')
    return Image.fromarray(arr, 'RGB')
