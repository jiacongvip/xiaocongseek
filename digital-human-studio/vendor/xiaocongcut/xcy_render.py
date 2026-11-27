"""xcy_render.py —— 配方直接渲染成 mp4（不经过剪映）

设计要点
--------
1. **配方是唯一真源**：不读剪映草稿，绕开 11.x 的加密问题。
2. **单条 ffmpeg 直通**：黑底 + 各层 overlay，滤镜链流式处理，
   内存占用与片长无关（10 分钟和 10 秒一样）。
3. **时间轴统一**：先把配方算成绝对时间（哪个东西在第几秒到第几秒），
   再生成 filter_complex。所有位置换算只此一处，别的函数不自己算。
4. **能缺就缺**：没音频就输出无声片；没字幕就不烧；缺素材**渲染前**报错。

不支持（后续里程碑）
------------------
- 片段之间的转场（xfade 需要先拼流，与 overlay 方案冲突，M3 单独做）
- 变速后的音画同步（M3）
"""
from __future__ import annotations

import hashlib
import json
import os

_FONTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts')
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from PIL import Image

CACHE_ROOT = Path(os.environ.get('XCY_CACHE', str(Path.home() / '.xiaocongcut' / 'cache')))
FFMPEG = os.environ.get('XCY_FFMPEG') or shutil.which('ffmpeg') or 'ffmpeg'
FFPROBE = os.environ.get('XCY_FFPROBE') or shutil.which('ffprobe') or 'ffprobe'

POS_MAP = {'lower_third': 0.66, 'center': 0.50, 'top': 0.18, 'bottom': 0.82}


# ───────────────────────────── 基础工具 ─────────────────────────────

def _run(cmd: list[str], timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def probe(path: str) -> dict:
    """宽、高、帧率、时长。图片没有时长，按 0 处理。"""
    out = _run([
        FFPROBE, '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
        '-of', 'json', path,
    ], timeout=30)
    if out.returncode != 0:
        raise RuntimeError(f'读不了这个文件：{path}（{out.stderr.strip()[:120]}）')
    data = json.loads(out.stdout or '{}')
    stream = (data.get('streams') or [{}])[0]
    rate = str(stream.get('r_frame_rate') or '30/1')
    try:
        num, den = rate.split('/')
        fps = float(num) / float(den or 1)
    except Exception:
        fps = 30.0
    duration = float((data.get('format') or {}).get('duration') or 0)
    return {
        'width': int(stream.get('width') or 0),
        'height': int(stream.get('height') or 0),
        'fps': round(fps or 30.0, 3),
        'duration': duration,
    }


def has_audio(path: str) -> bool:
    try:
        out = _run([
            FFPROBE, '-v', 'error', '-select_streams', 'a:0',
            '-show_entries', 'stream=codec_type', '-of', 'json', path,
        ], timeout=20)
        if out.returncode != 0:
            return False
        return bool((json.loads(out.stdout or '{}').get('streams') or []))
    except Exception:
        return False


def resolve(path: str, base: Path) -> str:
    p = os.path.expanduser(str(path or ''))
    if os.path.isabs(p):
        return p
    return str((base / p).resolve())


def kind_of(path: str) -> str:
    ext = Path(path).suffix.lower()
    if ext in ('.jpg', '.jpeg', '.png', '.webp', '.bmp'):
        return 'photo'
    return 'video'


def _sha(text: str, n: int = 16) -> str:
    return hashlib.sha1(text.encode('utf8')).hexdigest()[:n]


# ───────────────────────────── 时间轴 ─────────────────────────────

def _resolve_bgm(cfg, base_dir: Path, duration: float) -> dict | None:
    """BGM 解析：给了 path 就用它，写 auto（或不写 path）就从本地曲库挑一首。"""
    if not cfg:
        return None
    if isinstance(cfg, str):
        cfg = {'path': cfg}
    b = dict(cfg)
    mode = str(b.get('mode') or ('path' if b.get('path') else 'auto')).lower()
    picked = None
    path = ''
    if mode == 'auto' and not b.get('path'):
        import xcy_audiofx as A
        picked = A.pick_bgm(duration, b.get('genre'), b.get('tone'))
        if not picked:
            return None            # 曲库为空就当没配 BGM，不要让整条片子失败
        path = picked['path']
    else:
        path = resolve(str(b.get('path') or ''), base_dir)
    if not os.path.exists(path):
        raise FileNotFoundError('BGM 文件不存在：' + path)

    fade_out = b.get('fade_out')
    return {
        'path': path,
        'volume': float(b.get('volume') if b.get('volume') is not None else 0.12),
        # auto 默认压人声（说话段自动让路）
        'duck': bool(b.get('duck', mode == 'auto')),
        'loop': bool(b.get('loop', True)),
        'fade_in': float(b.get('fade_in') if b.get('fade_in') is not None else 0.5),
        'fade_out': float(fade_out if fade_out is not None else min(1.2, max(0.4, duration * 0.1))),
        'name': (picked or {}).get('name') or Path(path).stem,
        'reason': (picked or {}).get('reason') or '配方指定',
        'mode': mode,
    }


def _shot_bounds(s0: float, s1: float, cuts: list[float],
                 min_shot: float = 2.2, max_shot: float = 7.0) -> list[tuple]:
    """把 [s0,s1] 按句子边界切成镜头：太短的并、太长的等分。"""
    import math

    points = [s0] + [c for c in sorted(cuts) if s0 < c < s1] + [s1]
    merged = [points[0]]
    for p in points[1:-1]:
        if p - merged[-1] >= min_shot:
            merged.append(p)
    merged.append(s1)
    # 最后一段太短就并回上一段（避免出现 0.4 秒的碎镜）
    if len(merged) >= 3 and merged[-1] - merged[-2] < min_shot:
        merged.pop(-2)

    out: list[tuple] = []
    for a, b in zip(merged, merged[1:]):
        d = b - a
        if d <= max_shot:
            out.append((round(a, 3), round(b, 3)))
            continue
        n = max(2, int(math.ceil(d / max_shot)))
        step = d / n
        for i in range(n):
            out.append((round(a + i * step, 3), round(a + (i + 1) * step, 3)))
    return out


def _apply_rhythm(clips: list[dict], rhythm: dict, base_dir: Path,
                  look_cfg: dict | None = None) -> list[dict]:
    """按停顿切镜：口播一片到底太闷，按句子边界切，每镜交替轻微推拉。

    只在"片段本身就是一条长口播、没变速"时才切；有关键帧/画中画的片段原样放过，
    免得把用户已经排好的运镜搅乱。

    **和背景虚化互斥**：虚化要整段抠像，切开就等于一段一段重抠（8 秒素材抠四次，
    又慢又吃内存）。虚化已经把背景压掉了，切镜收益也不大，所以直接不切。
    """
    if not clips:
        return clips
    look_cfg = look_cfg or {}
    if look_cfg.get('bg_blur') or look_cfg.get('bg_dim'):
        return clips
    min_shot = float(rhythm.get('min_shot') or 2.2)
    max_shot = float(rhythm.get('max_shot') or 7.0)
    zoom = rhythm.get('zoom') or [1.02, 1.06]
    try:
        za, zb = float(zoom[0]), float(zoom[1])
    except (TypeError, ValueError, IndexError):
        za, zb = 1.02, 1.06
    model = str(rhythm.get('model') or 'small')
    lang = str(rhythm.get('language') or 'zh')

    out: list[dict] = []
    shot_no = 0
    for c in clips:
        if (c['kind'] != 'video' or abs(c['speed'] - 1.0) > 0.001
                or c.get('zoom') or c.get('pip') or c['duration'] < min_shot * 1.4):
            out.append(c)
            continue
        try:
            import xcy_subtitle as SUB
            segs = SUB.transcribe(c['src'], model=model, language=lang)
        except Exception:  # noqa: BLE001
            out.append(c)     # 转写不可用就当没开节奏，片子照常出
            continue

        s0, s1 = c['start'], c['start'] + c['src_len']
        cuts = [float(sg['end']) for sg in segs if s0 < float(sg['end']) < s1]
        bounds = _shot_bounds(s0, s1, cuts, min_shot, max_shot)
        if len(bounds) <= 1:
            out.append(c)
            continue

        t = c['target']
        for i, (a, b) in enumerate(bounds):
            z = (za, zb) if shot_no % 2 == 0 else (zb, za)
            out.append({
                **c,
                'start': round(a, 3), 'src_len': round(b - a, 3),
                'duration': round(b - a, 3),
                'target': round(t, 3),
                'zoom': z,
                'matte': None,          # 切镜后透明层区间要重算，先不叠
                'transition': None,     # 镜头之间要硬切，不要交叉溶解
                'hold': 0,
                'shot': i + 1,
            })
            t += b - a
            shot_no += 1
    return out


def build_plan(recipe: dict, base_dir: Path) -> dict:
    """把配方算成绝对时间轴。所有校验都在这里做，缺东西直接抛。"""
    size = recipe.get('size') or [1080, 1920]
    width, height = int(size[0]), int(size[1])
    fps = float(recipe.get('fps') or 30)

    missing: list[str] = []
    clips: list[dict] = []
    cursor = 0.0
    for c in recipe.get('clips') or []:
        src = resolve(c['source'], base_dir)
        if not os.path.exists(src):
            missing.append(src)
            continue
        info = probe(src)
        if kind_of(src) == 'photo':
            dur = float(c.get('duration') or 3.0)
            start = 0.0
        else:
            start = float(c.get('start') or 0)
            end = c.get('end')
            dur = (float(end) - start) if end is not None else max(0.5, info['duration'] - start)
        if dur <= 0:
            raise ValueError(f'片段时长算出来是 {dur}：{Path(src).name}')
        speed = min(4.0, max(0.25, float(c.get('speed') or 1.0)))
        src_len = dur                      # 源片里要取多长
        dur = src_len / speed              # 落到时间线上的长度
        target = float(c['target']) if c.get('target') is not None else cursor
        cursor = max(cursor, target + dur)

        # 推拉：keyframes 可带任意中间时间点，统一成 [(at, scale), ...] 线性分段
        zoom = None
        kfs = c.get('keyframes') or []
        if isinstance(kfs, list) and len(kfs) >= 2:
            try:
                pts = []
                for kf in kfs:
                    at = float(kf.get('at', 0))
                    sc = float(kf.get('scale', 1.0))
                    at = min(1.0, max(0.0, at))
                    sc = min(1.5, max(0.8, sc))
                    pts.append((round(at, 4), round(sc, 4)))
                pts.sort(key=lambda x: x[0])
                # 去掉重复时间点，保留最后一个
                dedup = []
                for at, sc in pts:
                    if dedup and abs(at - dedup[-1][0]) < 0.0005:
                        dedup[-1] = (at, sc)
                    else:
                        dedup.append((at, sc))
                if len(dedup) >= 2 and any(abs(sc - dedup[0][1]) > 0.001 for _, sc in dedup[1:]):
                    zoom = dedup
            except Exception:
                zoom = None

        clips.append({
            'src': src, 'kind': kind_of(src), 'start': start, 'src_len': round(src_len, 3),
            'duration': round(dur, 3), 'speed': speed, 'has_audio': has_audio(src),
            'target': round(target, 3), 'info': info,
            'volume': float(c.get('volume') if c.get('volume') is not None else 1.0),
            'pip': c.get('pip'),
            'matte': c.get('matte'),
            'transition': c.get('transition_in'),
            'zoom': zoom,
        })

    # 按停顿切镜：一条长口播切成几个镜头，每镜轻微推拉，节奏不死
    rhythm = recipe.get('rhythm') or {}
    if rhythm.get('cut_on_pause'):
        _look_cfg = recipe.get('look') or {}
        clips = _apply_rhythm(clips, rhythm, base_dir, _look_cfg)
        rhythm = {**rhythm, 'applied': clips is not None and any(c.get('shot') for c in clips),
                  'skipped': bool(_look_cfg.get('bg_blur') or _look_cfg.get('bg_dim'))}

    graphics: list[dict] = []
    for g in recipe.get('graphics') or []:
        kind = str(g.get('type') or g.get('kind') or '').strip()
        if not kind:
            continue
        graphics.append({
            'type': kind,
            'at': float(g.get('at') or 0),
            'dur': float(g.get('dur') or 1.2),
            'x': float(g.get('x') if g.get('x') is not None else 0.5),
            'y': float(g.get('y') if g.get('y') is not None else 0.5),
            'size': float(g.get('size') or 0.26),
            'thick': float(g.get('thick') or 0.012),
            'color': str(g.get('color') or '#ff3b30'),
            'rotate': float(g.get('rotate') or 0),
            'aspect': float(g.get('aspect') or 0.42),
            'animate': str(g.get('animate') or 'fade'),
        })

    cards: list[dict] = []
    for key, at_end in (('intro', False), ('outro', True)):
        cfg = recipe.get(key)
        if not isinstance(cfg, dict) or not cfg.get('text'):
            continue
        cards.append({
            'kind': key,
            'text': str(cfg['text']),
            'sub': str(cfg.get('sub') or ''),
            'dur': float(cfg.get('dur') or (3.0 if key == 'intro' else 3.5)),
            'bg': str(cfg.get('bg') or '#12141a'),
            'fg': str(cfg.get('fg') or '#ffffff'),
            'accent': str(cfg.get('accent') or '#ffd600'),
            'at_end': at_end,
        })

    texts: list[dict] = []
    for t in recipe.get('texts') or []:
        body = str(t.get('text') or '').strip()
        if not body:
            continue
        texts.append({
            'text': body,
            'style': str(t.get('style') or 'hook_yellow'),
            'start': float(t.get('start') or 0),
            'end': float(t.get('end') or 0),
            'pos': str(t.get('pos') or ('auto' if t.get('avoid') else 'lower_third')),
            'avoid': str(t.get('avoid') or ''),
            'x_ratio': t.get('x_ratio'),
            'y_ratio': t.get('y_ratio'),
            'pos_raw': t.get('pos'),
            'color': str(t.get('color') or ''),
            'outline_color': str(t.get('outline_color') or ''),
            'outline': t.get('outline'),
            'letter_spacing': t.get('letter_spacing'),
            'intro': str(t.get('intro') or 'Fade_In'),
            'font_size': int(t.get('font_size') or 0),
            'max_width': int(t.get('max_width') or 0),
            'font': str(t.get('font') or ''),
        })

    sfx: list[dict] = []
    for s in recipe.get('sfx') or []:
        path = resolve(s['path'], base_dir)
        if not os.path.exists(path):
            missing.append(path)
            continue
        sfx.append({
            'path': path, 'at': float(s.get('at') or 0),
            'dur': probe(path)['duration'],
            'volume': float(s.get('volume') if s.get('volume') is not None else 1.0),
            'fade_in': float(s.get('fade_in') or 0),
            'fade_out': float(s.get('fade_out') or 0),
        })

    audio_cfg = recipe.get('audio') or {}
    if missing:
        raise FileNotFoundError('配方引用的文件不存在：' + chr(10) + chr(10).join(missing))
    if not clips and not texts:
        raise ValueError('配方里既没有 clips 也没有 texts，没什么可渲染')

    duration = max([c['target'] + c['duration'] for c in clips] +
                   [t['end'] for t in texts] + [0]) or 1.0

    # 片头/片尾是"加时间"，不是"盖在画面上"——盖上去等于把开场那句口播吃掉。
    # 片头：整体后移 shift 秒；片尾：总时长再往后延 outro 秒。
    intro = next((c for c in cards if c['kind'] == 'intro'), None)
    outro = next((c for c in cards if c['kind'] == 'outro'), None)
    shift = float(intro['dur']) if intro else 0.0
    if shift > 0:
        for c in clips:
            c['target'] = round(c['target'] + shift, 3)
        for t in texts:
            t['start'] += shift
            t['end'] += shift
        for g in graphics:
            g['at'] += shift
        for s in sfx:
            s['at'] += shift
    duration += shift + (float(outro['dur']) if outro else 0.0)
    for c in cards:
        c['at'] = 0.0 if c['kind'] == 'intro' else round(max(0.0, duration - float(c['dur'])), 3)

    # 注意：BGM 比片子长不该把片子拉长 —— 片长只由 clips/texts 决定
    bgm = _resolve_bgm(audio_cfg.get('bgm'), base_dir, duration)

    # 交叉溶解：下一段要淡入/滑入时，让上一段多撑 `hold` 秒（克隆最后一帧），
    # 否则淡入时下面什么都没有，会看到一下黑场。
    for i, c in enumerate(clips):
        nxt = clips[i + 1] if i + 1 < len(clips) else None
        tr = (nxt or {}).get('transition')
        if isinstance(tr, dict) and str(tr.get('type', 'fade')) in ('fade', 'dissolve', 'slide_up', 'slide_down', 'slide_left', 'slide_right', 'fade_black', 'flash_white'):
            c['hold'] = round(float(tr.get('duration') or 0.35), 3)

    return {
        'width': width, 'height': height, 'fps': fps, 'duration': round(duration, 3),
        'clips': clips, 'texts': texts, 'sfx': sfx, 'bgm': bgm,
        'subtitles': recipe.get('subtitles') or None,
        'audio': audio_cfg, 'look': recipe.get('look') or {},
        'graphics': graphics, 'cards': cards, 'rhythm': rhythm,
        'time_shift': round(shift, 3),
    }


# ───────────────────────────── 花字图 ─────────────────────────────

def _styled_png(text: dict, canvas_w: int, tmp: Path) -> str:
    """复用引擎已有的花字渲染（xcy_ext 里的预设与排版），结果按指纹缓存。"""
    import xcy_ext as X  # 同目录

    cfg = dict(X.PRESETS.get(text['style']) or X.PRESETS['hook_yellow'])
    if text.get('font'):
        cfg['font'] = text['font']  # 按层指定字体（PIL 通道，路径或族名走 FONT_CANDIDATES）
    # 逐层覆盖颜色/描边：花字也能做红字白边这类组合
    if text.get('color'):
        cfg['fg'] = text['color']
    if text.get('outline_color'):
        cfg['stroke'] = text['outline_color']
    if text.get('outline'):
        cfg['stroke_width'] = int(text['outline'])
    font_size = text['font_size'] or max(48, int(canvas_w * 0.11))
    max_width = text['max_width'] or int(canvas_w * 0.86)
    key = _sha("|".join([str(text['text']), str(text['style']), str(font_size), str(max_width), str(canvas_w),
                         str(text.get('font') or ''), str(cfg.get('fg')), str(cfg.get('stroke')),
                         str(cfg.get('stroke_width'))]))
    out_dir = CACHE_ROOT / 'styled-text'
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f'r_{key}.png'
    if not out.exists():
        img, _size = X._fit(text['text'], cfg, font_size, max_width)
        img.save(out)
    return str(out)


# ───────────────────────────── 字幕 ─────────────────────────────
# 样式、关键词、安全区都在 xcy_style.py，这边只负责"什么时候调、用哪段字幕"。

_FONT_FAMILY_CACHE: dict = {}


def _family_path(fam: str) -> str | None:
    """字体族名 → fontsdir 里的文件路径（渐变字幕用 PIL 画，需要真文件）。"""
    if not fam:
        return None
    if os.path.isfile(fam):
        return fam
    if not _FONT_FAMILY_CACHE:
        try:
            from fontTools.ttLib import TTFont
            for fn in os.listdir(_FONTS_DIR):
                if not fn.lower().endswith(('.otf', '.ttf', '.ttc')):
                    continue
                p = os.path.join(_FONTS_DIR, fn)
                try:
                    t = TTFont(p, fontNumber=0, lazy=True)
                    for n in t['name'].names:
                        if n.nameID in (1, 4):
                            _FONT_FAMILY_CACHE.setdefault(n.toUnicode().lower(), p)
                    t.close()
                except Exception:
                    continue
        except Exception:
            pass
    return _FONT_FAMILY_CACHE.get(fam.lower())


def _grad_png(g: dict, tmp) -> tuple:
    """渐变字幕条：PIL 画 竖向/横向渐变填充 + 描边 + 轻阴影 + 瘦长缩放，出透明 PNG。"""
    from PIL import Image, ImageDraw, ImageFont
    path = g.get('font_file') or _family_path(g.get('font') or '') or _family_path('Noto Sans SC Black')
    size = max(8, int(g['size']))
    outline = max(0, int(g['outline']))
    font = ImageFont.truetype(path, size) if path else ImageFont.load_default()
    text = g['text']
    probe = ImageDraw.Draw(Image.new('L', (8, 8)))
    bb = probe.textbbox((0, 0), text, font=font, stroke_width=outline)
    shad = max(0, int(g.get('shadow') or 0))
    pad = outline + shad + 4
    w, h = bb[2] - bb[0] + pad * 2, bb[3] - bb[1] + pad * 2
    ox, oy = pad - bb[0], pad - bb[1]
    glyph = Image.new('L', (w, h), 0)
    ImageDraw.Draw(glyph).text((ox, oy), text, font=font, fill=255)
    stroke_m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(stroke_m).text((ox, oy), text, font=font, fill=255,
                                  stroke_width=outline, stroke_fill=255)

    def rgb(hexs):
        s = hexs.lstrip('#')
        return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))
    if g.get('from') and g.get('to'):
        c0, c1 = rgb(g['from']), rgb(g['to'])
    else:
        c0 = c1 = rgb(g.get('color') or '#FFFFFF')

    # 多色标（烫金反光：高光近奶白 → 中金 → 深琥珀）
    stops = []
    for sp in (g.get('stops') or []):
        try:
            stops.append((float(sp.get('pos', 0)), rgb(str(sp.get('color')))))
        except Exception:
            continue
    stops.sort(key=lambda x: x[0])

    def stop_color(k):
        if not stops:
            return tuple(int(c0[i] + (c1[i] - c0[i]) * k) for i in range(3))
        if k <= stops[0][0]:
            return stops[0][1]
        if k >= stops[-1][0]:
            return stops[-1][1]
        for j in range(len(stops) - 1):
            p0, v0 = stops[j]; p1, v1 = stops[j + 1]
            if p0 <= k <= p1:
                t = (k - p0) / max(1e-6, p1 - p0)
                return tuple(int(v0[i] + (v1[i] - v0[i]) * t) for i in range(3))
        return stops[-1][1]

    grad = Image.new('RGB', (w, h))
    gp = grad.load()
    if str(g.get('dir') or 'v') == 'h':
        for x in range(w):
            col = stop_color(x / max(1, w - 1))
            for y in range(h):
                gp[x, y] = col
    else:
        for y in range(h):
            col = stop_color(y / max(1, h - 1))
            for x in range(w):
                gp[x, y] = col
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    if shad:
        sh = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        sh.paste(Image.new('RGBA', (w, h), (0, 0, 0, 110)), (shad, shad), glyph)
        from PIL import ImageFilter
        sh = sh.filter(ImageFilter.GaussianBlur(max(2, shad // 3)))
        out = Image.alpha_composite(out, sh)
    oc = rgb(g.get('outline_color') or '#000000')
    out.paste(Image.new('RGBA', (w, h), oc + (255,)), (0, 0), stroke_m)
    out.paste(grad.convert('RGBA'), (0, 0), glyph)
    sx, sy = int(g.get('scale_x') or 100), int(g.get('scale_y') or 100)
    if sx != 100 or sy != 100:
        out = out.resize((max(1, int(w * sx / 100)), max(1, int(h * sy / 100))), Image.LANCZOS)
    fp = tmp / f"grad_{abs(hash((text, g['from'], g['to'], str(sorted((sp.get('pos'), sp.get('color')) for sp in (g.get('stops') or []))), g.get('color'), size, sx, sy, outline, shad))) % (10 ** 10)}.png"
    out.save(fp)
    return str(fp), out.size


def write_ass(segments: list[dict], canvas_w: int, canvas_h: int,
              style_name: str, out: Path, **kwargs) -> str:
    """兼容旧调用：直接转给 xcy_style.build_ass。"""
    import xcy_style
    return xcy_style.build_ass(segments, canvas_w, canvas_h, style_name,
                               out_path=out, **kwargs)


def load_subtitle_segments(recipe_sub: dict, base: Path, plan: dict,
                           on_progress=None, need_words: bool = False) -> list[dict]:
    """inline（配方里写）/ file（外部 srt）/ auto（本地转写）。"""
    mode = str(recipe_sub.get('mode') or 'inline')
    if mode == 'inline' or recipe_sub.get('segments'):
        return list(recipe_sub.get('segments') or [])
    if mode == 'file':
        path = resolve(recipe_sub.get('path') or '', base)
        if not path.endswith('.srt'):
            raise ValueError('字幕文件目前只支持 .srt（.ass 直接烧会把我们的样式覆盖掉）')
        return parse_srt(Path(path).read_text(encoding='utf8'))
    if mode == 'auto':
        import xcy_subtitle as SUB

        raw_src = str(recipe_sub.get('source') or 'clips[0]')
        m = re.match(r'clips\[(\d+)\]', raw_src)
        if m:
            idx = int(m.group(1))
            if idx >= len(plan['clips']):
                raise ValueError(f'字幕来源 clips[{idx}] 不存在')
            src = plan['clips'][idx]['src']
        else:
            src = resolve(raw_src, base)
        if not os.path.exists(src):
            raise FileNotFoundError(f'字幕来源不存在：{src}')

        segs = SUB.transcribe(
            src,
            model=str(recipe_sub.get('model') or 'small'),
            language=str(recipe_sub.get('language') or 'zh'),
            on_progress=on_progress,
            words=need_words,
        )
        return SUB.merge_segments(segs, int(recipe_sub.get('max_chars') or 14))
    return []


def parse_srt(raw: str) -> list[dict]:
    segs = []
    blocks = [b.strip() for b in raw.replace('\r\n', '\n').split('\n\n') if b.strip()]
    for block in blocks:
        lines = block.split('\n')
        idx = next((i for i, l in enumerate(lines) if '-->' in l), None)
        if idx is None:
            continue
        tm = lines[idx]
        try:
            a, b = [x.strip() for x in tm.split('-->')]
            segs.append({'start': _srt_sec(a), 'end': _srt_sec(b), 'text': ' '.join(lines[idx + 1:]).strip()})
        except Exception:
            continue
    return segs


def _srt_sec(t: str) -> float:
    t = t.replace(',', '.')
    h, m, s = t.split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)


# ───────────────────────────── 渲染 ─────────────────────────────

def render_recipe(recipe: dict, out_path: str, base_dir: Path | str = '.',
                  preset: str = 'final', hardware: bool = True,
                  on_progress=None, cancel_flag: threading.Event | None = None,
                  on_stage=None) -> dict:
    """全程渲染。on_stage(阶段, 说明) 用于把"准备素材"这类耗时步骤也报给界面。"""
    base = Path(base_dir).resolve()

    def stage(name: str) -> None:
        if on_stage:
            try:
                on_stage(name)
            except Exception:
                pass

    stage('解析配方')
    plan = build_plan(recipe, base)
    W, H, FPS, TOTAL = plan['width'], plan['height'], plan['fps'], plan['duration']
    look_cfg = plan.get('look') or {}
    voice_fx = _voice_chain(plan)
    if look_cfg.get('wb') is True:
        stage('算白平衡')
        look_cfg = {**look_cfg, 'wb': _auto_wb(plan)}
    out_path = os.path.expanduser(out_path)
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)

    tmp = Path(tempfile.mkdtemp(prefix='xcy-render-'))
    inputs: list[str] = []
    filters: list[str] = []
    idx = 0

    def add_input(args: list[str]) -> int:
        nonlocal idx
        inputs.extend(args)
        idx += 1
        return idx - 1

    # 1) 黑底
    base_idx = add_input(['-f', 'lavfi', '-i', f'color=c=black:s={W}x{H}:r={FPS}:d={TOTAL:.3f}'])
    v_cur = f'[v{base_idx}]'
    # 底图用 rgba：后面所有层都靠 alpha 叠加，底是 yuv420p 的话 overlay 会把
    # 半透明补边当不透明黑块，滑动入场就变成"黑片盖住下面"。最后再转 yuv420p。
    filters.append(f'[{base_idx}:v]format=rgba[base{base_idx}]')
    filters.append(f'[base{base_idx}]null[v{base_idx}]')
    # 用统一的 label 起点
    last = f'v{base_idx}'

    # 2) 片段层（视频/图片，含画中画与透明人像）
    for ci, c in enumerate(plan['clips']):
        src = c['src']
        if c['kind'] == 'photo':
            i = add_input(['-loop', '1', '-t', f"{c['duration']:.3f}", '-i', src])
        else:
            i = add_input(['-ss', f"{c['start']:.3f}", '-t', f"{c['src_len']:.3f}", '-i', src])

        c['input'] = i
        pip = c.get('pip')
        scale_w = int(W * float(pip.get('width'))) if pip else W
        # 统一到画布：等比缩放 + 补边
        head = (
            f'[{i}:v]scale={scale_w}:-2:force_original_aspect_ratio=decrease,'
            f'setsar=1,fps={FPS},format=rgba'
        )

        # 背景虚化：先糊底 + 压暗，再把清晰人像贴回去（用现成的 alpha，不重抠）
        bg_fx = ''
        fg_input = None
        if look_cfg.get('bg_blur') or look_cfg.get('bg_dim'):
            bg_fx = _bg_chain(look_cfg)
            if bg_fx:
                try:
                    alpha = _person_alpha(c['src'], c['start'], c['start'] + c['src_len'])
                    fg_input = add_input(['-i', alpha])
                except Exception:  # noqa: BLE001
                    fg_input = None

        # 调色：LUT + 白平衡。只作用素材，字幕花字不跟着变
        look_fx = _look_chain(look_cfg, c['src']) if look_cfg else ''

        # 给下一段的转场留余量：克隆最后一帧多撑 hold 秒（时间线时长）。
        # 必须放在变速之前 —— tpad 依赖原始时间戳，放在 setpts 之后不生效。
        tail = ''
        if c.get('hold'):
            tail += f",tpad=stop_mode=clone:stop_duration={c['hold'] * c['speed']:.3f}"

        # 变速：源片时长 / speed；倍数被夹在 0.25–4
        if abs(c['speed'] - 1.0) > 0.001:
            tail += f",setpts=(PTS-STARTPTS)/{c['speed']:.4f}"

        # 推拉（Ken Burns）：zoompan 逐帧放大；keyframes 支持任意中间时间点
        if c.get('zoom'):
            pts = c['zoom']
            frames = max(1, int(round(c['duration'] * FPS)))

            def seg_expr(i):
                a_at, a_sc = pts[i]
                b_at, b_sc = pts[i + 1]
                f0 = a_at * frames
                span = max(1.0, (b_at - a_at) * frames)
                return f"({a_sc:.4f}+({b_sc - a_sc:.4f})*(on-{f0:.4f})/{span:.4f})"

            # 从最后一段往前套 if；最后一帧以后保持最后关键帧的 scale
            zexpr = f"{pts[-1][1]:.4f}"
            for i in range(len(pts) - 2, -1, -1):
                zexpr = f"if(lte(on,{pts[i + 1][0] * frames:.4f}),{seg_expr(i)},{zexpr})"
            tail += (
                f",zoompan=z='{zexpr}':"
                f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS}"
            )

        # 入场转场：淡入/溶解/黑场/闪白（叠在前段留下的画面上）
        tr = c.get('transition')
        tr_type = str(tr.get('type', 'fade')) if isinstance(tr, dict) else ''
        if tr_type in ('fade', 'dissolve', 'fade_black', 'flash_white'):
            d = float(tr.get('duration') or 0.3)
            color = {'fade_black': 'black', 'flash_white': 'white'}.get(tr_type)
            tail += f",fade=t=in:st=0:d={d:.3f}" + (f":color={color}" if color else '')

        tail += f',setpts=PTS-STARTPTS+{c["target"]:.3f}/TB[mid{ci}]'

        if bg_fx and fg_input is not None:
            # 人像层的 alpha 边缘会粘一圈原来的背景，直接叠上去就是"发光的描边"。
            # 先腐蚀 3px 把背景剥掉，再轻微羽化，过渡才像景深。
            geo = f'scale={scale_w}:-2:force_original_aspect_ratio=decrease,setsar=1,fps={FPS}'
            filters.append(f'[{i}:v]split=2[cbs{ci}][cps{ci}]')
            filters.append(f'[cbs{ci}]{geo},format=rgba{bg_fx}[cb{ci}]')
            filters.append(f'[cps{ci}]{geo},format=rgb24[cc{ci}]')
            # alphaextract 必须有带 alpha 的像素格式，先转 rgba，否则报
            # "could not choose their formats: Parsed_alphaextract"
            filters.append(f'[{fg_input}:v]{geo},format=rgba,alphaextract,'
                           f'erosion,erosion,erosion,gblur=sigma=1.2,format=gray[ca{ci}]')
            filters.append(f'[cc{ci}][ca{ci}]alphamerge[cf{ci}]')
            filters.append(f'[cb{ci}][cf{ci}]overlay=x=0:y=0:format=auto[cm{ci}]')
            filters.append(f'[cm{ci}]null{look_fx}{tail}')
        else:
            filters.append(f'{head}{look_fx}{tail}')

        x = f'(W-w)*{float(pip.get("x")):.4f}' if pip else '(W-w)/2'
        y = f'(H-h)*{float(pip.get("y")):.4f}' if pip else '(H-h)/2'
        # 四向滑入：整段画面从画外推到位置。表达式含逗号，必须整体加引号。
        tr = c.get('transition')
        tr_type = str(tr.get('type', '')) if isinstance(tr, dict) else ''
        if tr_type in ('slide_up', 'slide_down', 'slide_left', 'slide_right'):
            d = float(tr.get('duration') or 0.35)
            prog = f'(1-min((t-{c["target"]:.3f})/{d:.3f},1))'
            if tr_type == 'slide_up':
                y = f"'{y}+altitude*{prog}'".replace('altitude', str(H))
            elif tr_type == 'slide_down':
                y = f"'{y}-altitude*{prog}'".replace('altitude', str(H))
            elif tr_type == 'slide_left':
                x = f"'{x}+altitude*{prog}'".replace('altitude', str(W))
            else:
                x = f"'{x}-altitude*{prog}'".replace('altitude', str(W))
        # 显示区间要算上 hold：前段多留的那几帧必须继续可见，交叉溶解才有底
        show_end = c['target'] + c['duration'] + float(c.get('hold') or 0)
        filters.append(
            f'[v{ci if ci else base_idx}][mid{ci}]overlay=x={x}:y={y}:format=auto:'
            f'eof_action=pass:enable=\'between(t,{c["target"]:.3f},{show_end:.3f})\'[v{ci + 1}]'
        )
        # 层的输出编号统一成 v{ci+1}，下一轮接着用
        last = f'v{ci + 1}'

    layer_no = len(plan['clips'])
    cur = last

    # 3) 花字层
    for ti, t in enumerate(plan['texts']):
        if t['end'] <= t['start']:
            continue
        png = _styled_png(t, W, tmp)
        layout = None
        if t.get('avoid') == 'person':
            layout = _layout_for(t, plan, png, H)
            if layout:
                t['layout'] = layout
        i = add_input(['-loop', '1', '-t', f"{t['end'] - t['start']:.3f}", '-i', png])
        intro = t['intro']
        pre = f'[{i}:v]format=rgba'
        if intro.lower() in ('fade_in', 'fadein', 'fade'):
            pre += f',fade=t=in:st=0:d=0.45:alpha=1'
        # 关键：淡入是相对"它自己出现的时刻"，所以先做动画，再把整条流平移到时间线位置。
        # 少了这一步，第二句花字会跑到片头去（PTS 从 0 开始）。
        pre += f',setpts=PTS-STARTPTS+{t["start"]:.3f}/TB[txt{ti}]'
        filters.append(pre)

        if layout and layout.get('y_center'):
            # 避让时用像素坐标：字垂直居中在选中的那条空带上
            y_expr = f"{int(layout['y_center'])}-h/2"
        elif t.get('y_ratio') is not None:
            # 画布拖动定位：y_ratio 为文字中心的归一化纵坐标（0-1）
            y_expr = f'H*{float(t["y_ratio"]):.4f}-h/2'
        else:
            y_expr = f'H*{POS_MAP.get(t["pos"], 0.66):.3f}-h/2'
        if t.get('x_ratio') is not None:
            # 画布拖动定位：x_ratio 为文字中心的归一化横坐标（0-1）
            x_expr = f'W*{float(t["x_ratio"]):.4f}-w/2'
        else:
            x_expr = '(W-w)/2'
        # 九宫格锚点定位：pos 传 {an,x,y}，x/y 大于 1 视为像素，否则视为归一化
        praw = t.get('pos_raw')
        if isinstance(praw, dict) and (praw.get('x') is not None or praw.get('y') is not None):
            an = int(praw.get('an') or 5)

            def _coord(v, total, expr_for_px):
                if v is None:
                    return None
                v = float(v)
                return expr_for_px(v) if abs(v) > 1 else f'{total}*{v:.4f}'

            ax = _coord(praw.get('x'), 'W', lambda v: f'{v:.1f}')
            ay = _coord(praw.get('y'), 'H', lambda v: f'{v:.1f}')
            if ax is not None:
                x_expr = ax if an in (1, 4, 7) else (f'{ax}-w/2' if an in (2, 5, 8) else f'{ax}-w')
            if ay is not None:
                if t.get('y_ratio') is None:
                    y_expr = ay if an in (7, 8, 9) else (f'{ay}-h/2' if an in (4, 5, 6) else f'{ay}-h')
        if intro.lower() in ('slide_up', 'slideup'):
            # 从下方 110px 滑到目标位置，0.45 秒
            y_expr = f'({y_expr})+110*(1-min((t-{t["start"]:.3f})/0.45,1))'
        layer_no += 1
        filters.append(
            f"[{cur}][txt{ti}]overlay=x={x_expr}:y='{y_expr}':format=auto:eof_action=pass:"
            f"enable='between(t,{t['start']:.3f},{t['end']:.3f})'[v{layer_no}]"
        )
        cur = f'v{layer_no}'

    # 4) 透明人像层（在花字之上，文字就落到人后面）
    matte_clips = [c for c in plan['clips'] if _matte_span(c)]
    for mi, c in enumerate(matte_clips):
        stage(f'抠像 {mi + 1}/{len(matte_clips)}（首次较慢，之后走缓存）')
        span = _matte_span(c)
        if not span:
            continue
        ms, me = span
        alpha = _person_alpha(c['src'], ms, me)
        i = add_input(['-i', alpha])
        layer_no += 1
        # 开了背景虚化时，这层透明人像的边缘会带一圈原始背景（糊底上就是发光描边），
        # 所以同样要收一下 alpha；没开虚化就保持原样（文字压边更准）。
        if look_cfg.get('bg_blur') or look_cfg.get('bg_dim'):
            filters.append(
                f'[{i}:v]format=rgba,split=2[mp{layer_no}][mm{layer_no}]'
            )
            filters.append(
                f'[mm{layer_no}]alphaextract,erosion,erosion,gblur=sigma=0.8,format=gray[mk{layer_no}]'
            )
            filters.append(
                f'[mp{layer_no}]format=rgb24[mc{layer_no}]'
            )
            filters.append(
                f'[mc{layer_no}][mk{layer_no}]alphamerge,'
                f'setpts=PTS-STARTPTS+{c["target"] + max(0.0, ms - c["start"]):.3f}/TB[matte{layer_no}]'
            )
        else:
            filters.append(
                f'[{i}:v]format=rgba,setpts=PTS-STARTPTS+{c["target"] + max(0.0, ms - c["start"]):.3f}/TB[matte{layer_no}]'
            )
        filters.append(
            f'[{cur}][matte{layer_no}]overlay=x=0:y=0:format=auto:eof_action=pass:'
            f"enable='between(t,{c['target'] + max(0.0, ms - c['start']):.3f},"
            f"{c['target'] + max(0.0, ms - c['start']) + (me - ms):.3f})'[v{layer_no}m]"
        )
        cur = f'v{layer_no}m'

    # 4.5) 图形层：箭头/圈注/高亮框/下划线（压在人物之上，标注才看得见）
    for gi, g in enumerate(plan.get('graphics') or []):
        import xcy_pack as P

        png = P.graphic_png(g['type'], W, g['color'], g['size'], g['thick'],
                            g['rotate'], g['aspect'])
        try:
            gw, gh = Image.open(png).size
        except Exception:  # noqa: BLE001
            continue
        i = add_input(['-loop', '1', '-t', f"{max(0.2, g['dur']):.3f}", '-i', png])
        pre = f'[{i}:v]format=rgba'
        if g['animate'] in ('fade', 'pop', 'slide_up'):
            pre += ',fade=t=in:st=0:d=0.28:alpha=1'
        pre += f',setpts=PTS-STARTPTS+{g["at"]:.3f}/TB[gfx{gi}]'
        filters.append(pre)
        gx = int(W * g['x'] - gw / 2)
        gy = int(H * g['y'] - gh / 2)
        if g['animate'] == 'slide_up':
            gy_expr = f"{gy}+40*(1-min((t-{g['at']:.3f})/0.35,1))"
        else:
            gy_expr = str(gy)
        layer_no += 1
        filters.append(
            f"[{cur}][gfx{gi}]overlay=x={gx}:y='{gy_expr}':format=auto:eof_action=pass:"
            f"enable='between(t,{g['at']:.3f},{g['at'] + max(0.2, g['dur']):.3f})'[v{layer_no}g]"
        )
        cur = f'v{layer_no}g'

    # 5) 字幕（烧入，放最后）
    subs = plan.get('subtitles') or {}
    sub_info = None
    if subs:
        import xcy_style

        style = str(subs.get('style') or 'douyin_bottom')
        st = xcy_style.resolve_style(style)
        stage('转写字幕（首次会下载模型）')
        segs = load_subtitle_segments(subs, base, plan, need_words=st['id'] == 'karaoke')
        shift = float(plan.get('time_shift') or 0)
        if shift and segs:
            segs = [{**sg, 'start': round(float(sg['start']) + shift, 3),
                     'end': round(float(sg['end']) + shift, 3)} for sg in segs]
        if segs:
            head = None
            if subs.get('avoid_face', True):
                stage('看人像头部（字幕避脸）')
                head = _sub_head_band(plan, W, H)
            ass_file = tmp / 'sub.ass'
            sub = xcy_style.build_subtitles(
                segs, W, H, style,
                highlight=subs.get('highlight'),
                highlights=subs.get('highlights'),
                safe=subs.get('safe'),
                head=head,
                auto_y=bool(subs.get('auto_y')),
                out_path=ass_file,
            )
            # 底条：ASS 的半透明背景这版 libass 不认，改用 drawbox 画在字下面
            if sub.get('bars'):
                def _bx(b):
                    c = str(b.get('color') or '#000000')
                    if c.startswith('#'):
                        c = '0x' + c[1:]
                    return (f"drawbox=x={b['x']}:y={b['y']}:w={b['w']}:h={b['h']}:"
                            f"color={c}@{b['alpha']:.2f}:t=fill:"
                            f"enable='between(t,{b['start']:.3f},{b['end']:.3f})'")
                boxes = ','.join(_bx(b) for b in sub['bars'])
                layer_no += 1
                filters.append(f'[{cur}]{boxes}[v{layer_no}bar]')
                cur = f'v{layer_no}bar'
            layer_no += 1
            # ass 滤镜的路径要转义冒号和单引号
            ap = str(ass_file).replace('\\', '\\\\').replace(':', '\\:').replace("'", "\\'")
            _fd = f":fontsdir='{_FONTS_DIR}'" if os.path.isdir(_FONTS_DIR) else ''
            filters.append(f"[{cur}]ass=filename='{ap}'{_fd}[v{layer_no}s]")
            cur = f'v{layer_no}s'
            # 渐变字幕条：PIL 渐变 PNG 叠在 ass 之后（人像前面），按 pos/an 锚点定位
            for gi, g in enumerate(sub.get('grads') or []):
                if g['end'] <= g['start']:
                    continue
                gpng, (gw, gh) = _grad_png(g, tmp)
                i = add_input(['-loop', '1', '-t', f"{g['end'] - g['start']:.3f}", '-i', gpng])
                filters.append(f'[{i}:v]format=rgba,setpts=PTS-STARTPTS+{g["start"]:.3f}/TB[gr{gi}]')
                an = int(g.get('an') or 5)
                xe = f"{g['x']}" if an % 3 == 1 else (f"{g['x']}-w/2" if an % 3 == 2 else f"{g['x']}-w")
                ye = f"{g['y']}-h" if an <= 3 else (f"{g['y']}-h/2" if an <= 6 else f"{g['y']}")
                layer_no += 1
                filters.append(
                    f"[{cur}][gr{gi}]overlay=x={xe}:y='{ye}':format=auto:eof_action=pass:"
                    f"enable='between(t,{g['start']:.3f},{g['end']:.3f})'[v{layer_no}g]"
                )
                cur = f'v{layer_no}g'
            sub_info = {
                'style': st['id'],
                'lines': sub.get('lines') or len(segs),
                'bars': len(sub.get('bars') or []),
                'avoid_face': bool(head),
                'head_band': head,
            }

    # 5.5) 片头/片尾卡（整屏覆盖，字幕也不露）
    for ci, card in enumerate(plan.get('cards') or []):
        import xcy_pack as P

        dur = min(float(card['dur']), max(1.0, TOTAL))
        at = float(card.get('at') or (0.0 if not card['at_end'] else max(0.0, TOTAL - dur)))
        png = P.title_card_png(card['text'], card['sub'], (W, H),
                               card['bg'], card['fg'], card['accent'])
        i = add_input(['-loop', '1', '-t', f'{dur:.3f}', '-i', png])
        pre = f'[{i}:v]format=rgba,scale={W}:{H},setsar=1'
        if card['at_end']:
            pre += ',fade=t=in:st=0:d=0.45:alpha=1'
        else:
            pre += f',fade=t=out:st={max(0.0, dur - 0.5):.3f}:d=0.5:alpha=1'
        pre += f',setpts=PTS-STARTPTS+{at:.3f}/TB[card{ci}]'
        filters.append(pre)
        layer_no += 1
        filters.append(
            f"[{cur}][card{ci}]overlay=x=0:y=0:format=auto:eof_action=pass:"
            f"enable='between(t,{at:.3f},{at + dur:.3f})'[v{layer_no}c]"
        )
        cur = f'v{layer_no}c'

    # 6) 音频：音效 / 人声 / BGM → 混音 → 响度
    audio_labels: list[str] = []

    # 片段原声（口播就在里面）。以前只混了音效，人物的声音整条丢掉 —— 这是个硬伤。
    for vi, c in enumerate(plan['clips']):
        if c['kind'] != 'video' or c.get('input') is None or not c.get('has_audio'):
            continue
        if float(c.get('volume', 1.0)) <= 0:
            continue
        ms = int(round(c['target'] * 1000))
        chain = f'[{c["input"]}:a]asetpts=PTS-STARTPTS'
        if voice_fx:
            chain += ',' + voice_fx
        chain += f',volume={c["volume"]:.3f}'
        if abs(c['speed'] - 1.0) > 0.001:
            chain += ',' + _atempo_chain(c['speed'])

        # 转场音频：当前段淡入；下一段有转场时本段淡出。两边各占转场时长的一半，
        # 接点不再是硬切，也不会把两边音量叠到 2 倍。
        tr = c.get('transition')
        tr_audio = isinstance(tr, dict) and str(tr.get('type') or '') in ('fade', 'dissolve', 'slide_up', 'slide_down', 'slide_left', 'slide_right', 'fade_black', 'flash_white') and tr.get('audio_crossfade', True) is not False
        if tr_audio:
            d = min(float(tr.get('duration') or 0.35), float(c['duration']) * 0.5, 1.0)
            if d >= 0.05:
                chain += f',afade=t=in:st=0:d={d:.3f}'
        next_tr = None
        if vi + 1 < len(plan['clips']):
            next_tr = plan['clips'][vi + 1].get('transition')
        if isinstance(next_tr, dict) and str(next_tr.get('type') or '') in ('fade', 'dissolve', 'slide_up', 'slide_down', 'slide_left', 'slide_right', 'fade_black', 'flash_white') and next_tr.get('audio_crossfade', True) is not False:
            d = min(float(next_tr.get('duration') or 0.35), float(c['duration']) * 0.5, 1.0)
            if d >= 0.05:
                chain += f',afade=t=out:st={max(0.0, float(c["duration"]) - d):.3f}:d={d:.3f}'

        chain += f',adelay={ms}|{ms}[vo{vi}]'
        filters.append(chain)
        audio_labels.append(f'vo{vi}')
    for si, s in enumerate(plan['sfx']):
        i = add_input(['-i', s['path']])
        ms = int(round(s['at'] * 1000))
        chain = f'[{i}:a]asetpts=PTS-STARTPTS,volume={s["volume"]:.3f}'
        if s['fade_in'] > 0:
            chain += f',afade=t=in:st=0:d={s["fade_in"]:.3f}'
        if s['fade_out'] > 0 and s.get('dur'):
            chain += f',afade=t=out:st={max(0.0, s["dur"] - s["fade_out"]):.3f}:d={s["fade_out"]:.3f}'
        chain += f',adelay={ms}|{ms}[a{si}]'
        filters.append(chain)
        audio_labels.append(f'a{si}')

    bgm = plan.get('bgm')
    if bgm:
        i = add_input(['-stream_loop', '-1', '-i', bgm['path']] if bgm['loop'] else ['-i', bgm['path']])
        ch = f'[{i}:a]atrim=0:{TOTAL:.3f},asetpts=PTS-STARTPTS,volume={bgm["volume"]:.3f}'
        if bgm.get('fade_in', 0) > 0:
            ch += f',afade=t=in:st=0:d={bgm["fade_in"]:.3f}'
        if bgm['fade_out'] > 0:
            ch += f',afade=t=out:st={max(0.0, TOTAL - bgm["fade_out"]):.3f}:d={bgm["fade_out"]:.3f}'
        ch += '[bgmraw]'
        filters.append(ch)
        bgm_label = 'bgmraw'
    else:
        bgm_label = ''

    if audio_labels or bgm_label:
        sfx_label = ''
        if audio_labels:
            filters.append(''.join(f'[{l}]' for l in audio_labels) +
                           f'amix=inputs={len(audio_labels)}:normalize=0[sfxmix]')
            sfx_label = 'sfxmix'

        bgm_use = bgm_label
        if bgm_label and sfx_label and bgm.get('duck'):
            # 旁链压缩会把 [sfxmix] 当侧链吃掉，标签只能用一次 —— 先 split 一份出来，
            # 否则后面 amix 再引用 [sfxmix] 会报 "Stream specifier 'sfxmix'"。
            filters.append(f'[{sfx_label}]asplit=2[{sfx_label}sc][{sfx_label}main]')
            filters.append(f'[{bgm_label}][{sfx_label}sc]sidechaincompress='
                           'threshold=0.05:ratio=8:attack=20:release=400[bgmduck]')
            bgm_use = 'bgmduck'
            sfx_label = f'{sfx_label}main'

        if sfx_label and bgm_use:
            filters.append(f'[{sfx_label}][{bgm_use}]amix=inputs=2:normalize=0[mixed]')
        elif sfx_label:
            filters.append(f'[{sfx_label}]anull[mixed]')
        else:
            filters.append(f'[{bgm_use}]anull[mixed]')

        target_lufs = float(((plan.get('audio') or {}).get('loudness') or {}).get('target_lufs') or -14)
        filters.append(f'[mixed]loudnorm=I={target_lufs}:TP=-1.5:LRA=11,'
                       f'aresample=48000,aformat=channel_layouts=stereo[aout]')
        audio_map = ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k']
    else:
        audio_map = ['-an']

    # 预览：先缩一半，再统一像素格式（不能再用 -vf，会跟 filter_complex 冲突）
    if preset == 'preview':
        layer_no += 1
        filters.append(f'[{cur}]scale={W // 2}:-2[vprev]')
        cur = 'vprev'

    # 统一转成编码器要的像素格式
    layer_no += 1
    filters.append(f'[{cur}]format=yuv420p[vfinal]')
    cur = 'vfinal'

    stage('编码渲染')
    filtergraph = ';'.join(filters)
    (tmp / 'filter.txt').write_text(filtergraph, encoding='utf8')

    sw_enc = (['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30'] if preset == 'preview'
              else ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'])
    use_hw = (preset != 'preview') and bool(hardware) and (sys.platform == 'darwin')
    enc = ['-c:v', 'h264_videotoolbox', '-b:v', '8M', '-allow_sw', '1'] if use_hw else sw_enc

    if os.environ.get('XCY_DEBUG_FILTER'):
        shutil.copy(tmp / 'filter.txt', os.environ['XCY_DEBUG_FILTER'])

    def _run_encode(enc_args: list[str]) -> tuple[int, list[str]]:
        cmd = [FFMPEG, '-y', '-v', 'error', *inputs,
               '-filter_complex_script', str(tmp / 'filter.txt'),
               '-map', f'[{cur}]', *audio_map, *enc_args,
               '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
               '-progress', 'pipe:1', '-nostats', out_path]

        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        tail: list[str] = []
        assert proc.stdout is not None and proc.stderr is not None

        def read_err():
            for line in proc.stderr:
                tail.append(line.rstrip())
                if len(tail) > 40:
                    tail.pop(0)

        err_thread = threading.Thread(target=read_err, daemon=True)
        err_thread.start()

        # 取消看门狗：ffmpeg 的 -progress 行可能很稀疏（短预览整段只有一两行），
        # 只靠读行检查取消会漏掉；独立线程每 0.15s 查一次，置位就立刻 terminate。
        if cancel_flag is not None:
            def _cancel_watch():
                while proc.poll() is None:
                    if cancel_flag.is_set():
                        try:
                            proc.kill()
                        except Exception:  # noqa: BLE001
                            pass
                        return
                    time.sleep(0.15)
            threading.Thread(target=_cancel_watch, daemon=True).start()

        for line in proc.stdout:
            if cancel_flag is not None and cancel_flag.is_set():
                proc.kill()
                break
            line = line.strip()
            if line.startswith('out_time_ms=') and on_progress:
                try:
                    done = int(line.split('=')[1]) / 1_000_000
                    on_progress(min(0.99, done / max(0.1, TOTAL)))
                except Exception:
                    pass

        rc = proc.wait()
        err_thread.join(timeout=2)
        return rc, tail

    started = time.time()
    code, err_tail = _run_encode(enc)
    fallback_sw = False
    if code != 0 and use_hw and not (cancel_flag is not None and cancel_flag.is_set()):
        stage('硬件编码失败，回退软件编码')
        try:
            os.remove(out_path)
        except OSError:
            pass
        fallback_sw = True
        code, err_tail = _run_encode(sw_enc)
    elapsed = round(time.time() - started, 1)
    # 取消优先判定：ffmpeg 收到 SIGTERM 会“优雅收尾”退出码 0，不能当成功；
    # 半截产物必须删掉，否则下次同键请求会命中缓存拿到截断视频。
    if cancel_flag is not None and cancel_flag.is_set():
        shutil.rmtree(tmp, ignore_errors=True)
        try:
            os.remove(out_path)
        except OSError:
            pass
        raise RuntimeError('渲染已取消')
    if code != 0:
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError('渲染失败：' + ' / '.join(err_tail[-4:])[:600])

    shutil.rmtree(tmp, ignore_errors=True)
    return {
        'out': out_path, 'duration': TOTAL, 'width': W, 'height': H,
        'elapsed': elapsed, 'size_mb': round(os.path.getsize(out_path) / 1024 / 1024, 1),
        'layers': layer_no, 'subtitles': sub_info,
        'audio_fx': {'voice': str((plan.get('audio') or {}).get('voice_fx') or 'off'),
                     'bgm': (plan.get('bgm') or {}).get('name') if plan.get('bgm') else None,
                     'bgm_reason': (plan.get('bgm') or {}).get('reason') if plan.get('bgm') else None},
        'look': {k: v for k, v in (plan.get('look') or {}).items() if k != 'wb'},
    }


def _atempo_chain(speed: float) -> str:
    """atempo 单级只支持 0.5–2.0，超出就串联多级。"""
    parts = []
    rest = speed
    while rest > 2.0:
        parts.append('atempo=2.0')
        rest /= 2.0
    while rest < 0.5:
        parts.append('atempo=0.5')
        rest /= 0.5
    parts.append(f'atempo={rest:.4f}')
    return ','.join(parts)


def _layout_for(text: dict, plan: dict, png: str, canvas_h: int) -> dict | None:
    """给花字找一条不被人物挡住的空带。找不到就返回 None，走原来的固定位置。"""
    import xcy_layout

    clip = None
    for c in plan['clips']:
        if c['kind'] != 'video':
            continue
        cs, ce = c['target'], c['target'] + c['duration']
        if ce <= text['start'] or cs >= text['end']:
            continue
        clip = c
        break
    if clip is None:
        return None

    # 只抠"花字出现的那一段"，不要整条素材
    rel_start = max(0.0, text['start'] - clip['target'])
    rel_end = min(clip['duration'], text['end'] - clip['target'])
    ms = clip['start'] + rel_start
    me = clip['start'] + rel_end
    if me - ms < 0.2:
        return None

    try:
        alpha = _person_alpha(clip['src'], round(ms, 3), round(me, 3))
        h_png = Image.open(png).height
        place = xcy_layout.placement(alpha, h_png, canvas_h, prefer='auto')
        place['text'] = text['text']
        return place
    except Exception:
        return None


def _voice_chain(plan: dict) -> str:
    """人声链：只给"有人声的片段音频"用，音效与 BGM 不处理。"""
    import xcy_audiofx as A

    level = str((plan.get('audio') or {}).get('voice_fx') or 'off')
    return A.voice_chain(level)


def _bg_chain(look_cfg: dict) -> str:
    import xcy_look as L

    return L.bg_chain(look_cfg.get('bg_blur') or 0, look_cfg.get('bg_dim') or 0)


def _look_chain(look_cfg: dict, src: str) -> str:
    """调色链：LUT（强度已烘焙）+ 白平衡。wb 传 True 时用外部算好的增益。"""
    import xcy_look as L

    chain = ''
    lut = look_cfg.get('lut')
    if lut and str(lut) not in ('none', 'off', 'None'):
        chain += L.look_chain(str(lut), float(look_cfg.get('strength') or 0.8))
    wb = look_cfg.get('wb')
    if isinstance(wb, dict) and wb:
        chain += L.wb_chain(wb)
    return chain


def _auto_wb(plan: dict) -> dict:
    """拿第一条视频片段算白平衡增益（整片共用一个，避免逐段跳色）。"""
    import xcy_look as L

    clip = next((c for c in plan['clips'] if c['kind'] == 'video'), None)
    if not clip:
        return {}
    return L.auto_white_balance(clip['src']).get('gains') or {}


def _matte_span(c: dict):
    """透明人像要覆盖源片哪一段；没有就返回 None。"""
    m = c.get('matte')
    if not m:
        return None
    if m == 'person':
        return (c['start'], c['start'] + c['duration'])
    if isinstance(m, dict):
        ms = max(float(m.get('start', c['start'])), c['start'])
        me = min(float(m.get('end', c['start'] + c['duration'])), c['start'] + c['duration'])
        return (ms, me) if me - ms > 0.05 else None
    return None


def _person_alpha(src: str, start: float, end: float) -> str:
    import xcy_matte
    return xcy_matte.alpha_cache(src, 'u2net', start, end)


def _sub_head_band(plan: dict, canvas_w: int, canvas_h: int) -> dict | None:
    """字幕避脸用：估出人像头部在画布上的上下边界（像素）。

    只抠 0.6 秒（片段中点）：口播里人几乎不动，一个窗口就够。
    整条抠一遍太贵 —— 8.6 秒要 90 秒，为了知道"头在哪"不值。

    注意：alpha 的分辨率是**源片**的，跟画布不一定一样（素材常被等比缩放后居中），
    所以比例要先换算成画布像素，否则字幕会跑到错误的高度上。
    """
    import xcy_layout

    clip = next((c for c in plan['clips'] if c['kind'] == 'video'), None)
    if clip is None:
        return None

    try:
        mid = clip['start'] + max(0.0, clip['src_len'] / 2)
        alpha = _person_alpha(clip['src'], round(mid, 2), round(mid + 0.6, 2))
        band = xcy_layout.head_band(alpha, samples=3)
    except Exception:  # noqa: BLE001
        # 抠像失败不该让整条片子渲不出来 —— 退回"不避脸"
        return None

    if not band:
        return None

    info = clip.get('info') or {}
    sw, sh = float(info.get('width') or 0), float(info.get('height') or 0)
    if sw <= 0 or sh <= 0:
        disp_h, off_y = float(canvas_h), 0.0
    else:
        target_w = canvas_w * (float((clip.get('pip') or {}).get('width') or 1.0))
        disp_h = target_w * sh / sw
        if disp_h > canvas_h:
            disp_h = float(canvas_h)
        off_y = max(0.0, (canvas_h - disp_h) / 2)

    return {
        'top': int(off_y + band['top'] * disp_h),
        'bottom': int(off_y + band['bottom'] * disp_h),
        'ratio': band['height'],
    }
