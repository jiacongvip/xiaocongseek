"""xcy_pack.py —— 包装层：箭头/圈注/高亮框 + 片头片尾卡

都是"画一张透明 PNG，交给渲染器按时间叠上去"，不碰视频编码。
和花字的区别：花字有 ASS 排版与入场动画，这里只做几何图形和整屏卡。

用法
----
    import xcy_pack as P
    P.graphic_png('arrow', 768, '#ff3b30', size=0.26, rotate=-20)   # → png 路径
    P.title_card_png('一客一价', '新老客户不同价', (768, 1024))       # → png 路径
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

from PIL import Image, ImageDraw

CACHE_ROOT = Path(os.environ.get('XCY_CACHE', str(Path.home() / '.xiaocongcut' / 'cache')))
PACK_DIR = CACHE_ROOT / 'pack'
SUPERSAMPLE = 3          # 先画 3 倍大再缩，边缘才不毛


def _hex(color: str, alpha: int = 255) -> tuple:
    raw = str(color or '#ffffff').lstrip('#')
    if len(raw) == 3:
        raw = ''.join(c * 2 for c in raw)
    try:
        r, g, b = int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)
    except Exception:  # noqa: BLE001
        r, g, b = 255, 255, 255
    return (r, g, b, alpha)


def _font(size: int):
    import xcy_ext as X   # 共用同一套字体挑选逻辑
    return X._load_font(int(size))


def _cache(name: str, key: str) -> Path:
    PACK_DIR.mkdir(parents=True, exist_ok=True)
    tag = hashlib.sha1(key.encode('utf8')).hexdigest()[:12]
    return PACK_DIR / f'{name}_{tag}.png'


def _save(img: Image.Image, path: Path) -> str:
    img.save(path)
    return str(path)


# ───────────────────────────── 图形 ─────────────────────────────

def _arrow(w: int, color: str, thick: int) -> Image.Image:
    h = int(w * 0.34)
    W, H = w * SUPERSAMPLE, h * SUPERSAMPLE
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = _hex(color)
    t = thick * SUPERSAMPLE
    cy = H // 2
    head = int(W * 0.26)
    d.line([(t // 2, cy), (W - head, cy)], fill=c, width=t)
    d.polygon([(W - 1, cy), (W - head, cy - head * 0.62), (W - head, cy + head * 0.62)], fill=c)
    return img.resize((w, h), Image.LANCZOS)


def _circle(d: int, color: str, thick: int) -> Image.Image:
    W = d * SUPERSAMPLE
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    t = thick * SUPERSAMPLE
    dr.ellipse([t // 2, t // 2, W - t // 2 - 1, W - t // 2 - 1], outline=_hex(color), width=t)
    return img.resize((d, d), Image.LANCZOS)


def _box(w: int, h: int, color: str, thick: int, radius: float = 0.22) -> Image.Image:
    W, H = w * SUPERSAMPLE, h * SUPERSAMPLE
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    t = thick * SUPERSAMPLE
    r = int(min(W, H) * radius)
    dr.rounded_rectangle([t // 2, t // 2, W - t // 2 - 1, H - t // 2 - 1],
                         radius=r, outline=_hex(color), width=t)
    return img.resize((w, h), Image.LANCZOS)


def _underline(w: int, color: str, thick: int) -> Image.Image:
    h = max(6, int(thick * 2.2))
    W, H = w * SUPERSAMPLE, h * SUPERSAMPLE
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    t = max(2, thick) * SUPERSAMPLE
    dr.rounded_rectangle([0, H // 2 - t // 2, W - 1, H // 2 + t // 2],
                         radius=t // 2, fill=_hex(color))
    return img.resize((w, h), Image.LANCZOS)


def graphic_png(kind: str = 'arrow', canvas_w: int = 1080, color: str = '#ff3b30',
                size: float = 0.26, thick: float = 0.012, rotate: float = 0,
                aspect: float = 0.42) -> str:
    """画一个图形，返回 PNG 绝对路径（按参数缓存）。

    size 是**画布宽度的比例**：箭头=长度，圆圈=直径，框=宽度，下划线=长度。
    """
    cw = int(canvas_w)
    px = max(24, int(cw * float(size)))
    t = max(2, int(cw * float(thick)))
    key = f'{kind}|{cw}|{color}|{size}|{thick}|{rotate}|{aspect}'
    out = _cache(kind, key)
    if out.exists():
        return str(out)

    if kind == 'circle':
        img = _circle(px, color, t)
    elif kind == 'box':
        img = _box(px, max(12, int(px * float(aspect))), color, t)
    elif kind == 'underline':
        img = _underline(px, color, t)
    else:
        img = _arrow(px, color, t)

    if abs(float(rotate)) > 0.01:
        img = img.rotate(float(rotate), resample=Image.BICUBIC, expand=True)
    return _save(img, out)


def graphic_kinds() -> list[dict]:
    return [
        {'id': 'arrow', 'label': '箭头', 'note': '指价格、指细节；size=长度，rotate=角度'},
        {'id': 'circle', 'label': '圈注', 'note': '圈住一个数字/标签；size=直径'},
        {'id': 'box', 'label': '高亮框', 'note': '框住一块区域；size=宽度，aspect=高宽比'},
        {'id': 'underline', 'label': '下划线', 'note': '划重点；size=长度'},
    ]


# ───────────────────────────── 片头 / 片尾 ─────────────────────────────

def _card(text: str, sub: str, w: int, h: int, bg: str, fg: str, accent: str) -> Image.Image:
    """整屏卡：深色底 + 顶部一条色带 + 大字 + 小字。"""
    img = Image.new('RGB', (w, h), _hex(bg)[:3])
    d = ImageDraw.Draw(img)

    # 背景：上浅下深的斜向渐变，纯色底太死板
    top, bottom = _hex(bg)[:3], tuple(max(0, int(v * 0.55)) for v in _hex(bg)[:3])
    for y in range(h):
        k = y / max(1, h - 1)
        d.line([(0, y), (w, y)],
               fill=tuple(int(top[i] + (bottom[i] - top[i]) * k) for i in range(3)))

    # 左边一条竖色带，品牌感
    d.rectangle([0, 0, int(w * 0.012), h], fill=_hex(accent)[:3])

    size = int(h * 0.085)
    while size > 40:
        f = _font(size)
        if d.textlength(text, font=f) <= w * 0.78:
            break
        size = int(size * 0.92)
    f = _font(size)
    tw = d.textlength(text, font=f)
    d.text(((w - tw) / 2, h * 0.42 - size * 0.6), text, font=f, fill=_hex(fg)[:3])

    if sub:
        ssize = int(size * 0.42)
        sf = _font(ssize)
        sw = d.textlength(sub, font=sf)
        d.text(((w - sw) / 2, h * 0.42 + size * 0.55), sub, font=sf, fill=_hex(accent)[:3])

    # 底部一条细线，收个尾
    d.rectangle([int(w * 0.18), int(h * 0.62), int(w * 0.82), int(h * 0.62) + 2],
                fill=_hex(accent)[:3])
    return img


def title_card_png(text: str, sub: str = '', canvas: tuple = (1080, 1920),
                   bg: str = '#12141a', fg: str = '#ffffff', accent: str = '#ffd600') -> str:
    """片头/片尾卡（整屏 PNG，按参数缓存）。"""
    w, h = int(canvas[0]), int(canvas[1])
    key = f'{text}|{sub}|{w}x{h}|{bg}|{fg}|{accent}'
    out = _cache('card', key)
    if out.exists():
        return str(out)
    return _save(_card(text, sub, w, h, bg, fg, accent), out)
