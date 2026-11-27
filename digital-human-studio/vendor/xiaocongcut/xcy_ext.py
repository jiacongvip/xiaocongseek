"""Xiaocongcut 通用扩展（旁挂，不改官方逻辑）

只补一类能力：**参数化花字**——传一句话 + 样式名，引擎自己画图、自己贴进草稿，
带入场动画。任何调用方（插件、脚本、别的客户端）都能用，不依赖 digital-human-studio。

挂载方式：capcut_server.py 末尾两行 register_blueprint。

POST /xcy/add_styled_text
  {
    "text": "这批砖别买错",
    "style": "hook_yellow",            # 预设名，见 PRESETS；也可用 "custom"
    "draft_id": "...",                  # 必填
    "draft_folder": "/path/Projects",   # 可选，默认取草稿所在目录
    "start": 0.5, "end": 2.5,
    "font_size": 96, "max_width": 940,  # 超宽自动缩字号
    "transform_y": -0.58,               # 半画布单位，负=向下；默认下三分之一
    "transform_x": 0,
    "intro": "Fade_In",                 # Fade_In / Slide_Up / Mini_Zoom / None
    "intro_duration": 0.45,
    "fg": "#ffffff", "bg": "#ffd600", "stroke": "#000000", "stroke_width": 0,  # custom 时可用
    "radius": 18
  }

返回：{ success, draft_id, draft_url, png, style, cached }
"""

from __future__ import annotations

import json

import hashlib
import subprocess
import os
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from flask import Blueprint, jsonify, request, send_file
from PIL import Image, ImageDraw, ImageFont

from add_image_impl import add_image_impl

xcy_bp = Blueprint('xcy', __name__)

CACHE_ROOT = Path(os.environ.get('XCY_CACHE', str(Path.home() / '.xiaocongcut' / 'cache')))
STYLE_DIR = CACHE_ROOT / 'styled-text'

_BUNDLED_FONTS = Path(__file__).resolve().parent / 'fonts'
_ASSETS_FONTS = Path(__file__).resolve().parent.parent.parent / 'assets' / 'fonts'
_USER_FONTS = Path.home() / '.xiaocongcut' / 'fonts'
_FONT_DIRS = [_BUNDLED_FONTS, _ASSETS_FONTS, _USER_FONTS]

FONT_CANDIDATES = [
    os.environ.get('XCY_FONT', ''),
    str(_BUNDLED_FONTS / 'NotoSansSC-Black.otf'),
    str(_ASSETS_FONTS / 'NotoSansSC-Black.otf'),
    str(_BUNDLED_FONTS / 'Full-SourceHanSerifSC-Bold.otf'),
    str(_BUNDLED_FONTS / 'Full-LantingheiSC-Demibold.otf'),
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    '/Library/Fonts/Arial Unicode.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    'C:/Windows/Fonts/msyhbd.ttc',
]

# 样式预设：bg 为 None 表示透明底（靠描边/阴影保证可读）
PRESETS = {
    'trendy_red_top':     dict(bg=None,      fg='#ffffff', stroke='#a81c23', stroke_width=14, radius=0,  pad_x=16, pad_y=10, shadow=True,  font='NotoSansSC-Black.otf'),
    'trendy_red_bottom':  dict(bg=None,      fg='#a81c23', stroke='#ffffff', stroke_width=14, radius=0,  pad_x=16, pad_y=10, shadow=True,  font='Full-SourceHanSerifSC-Bold.otf'),
    'trendy_gold_top':    dict(bg=None,      fg='#fff8e7', stroke='#1a1410', stroke_width=12, radius=0,  pad_x=16, pad_y=10, shadow=True,  font='NotoSansSC-Black.otf'),
    'trendy_gold_bottom': dict(bg=None,      fg='#e5b54f', stroke='#1a1410', stroke_width=12, radius=0,  pad_x=16, pad_y=10, shadow=True,  font='Full-SourceHanSerifSC-Bold.otf'),
    'trendy_cyan_top':    dict(bg=None,      fg='#ffffff', stroke='#0b5e68', stroke_width=12, radius=0,  pad_x=16, pad_y=10, shadow=True,  font='NotoSansSC-Black.otf'),
    'trendy_cyan_bottom': dict(bg=None,      fg='#00d4d8', stroke='#0a1e24', stroke_width=12, radius=0,  pad_x=16, pad_y=10, shadow=True,  font='Full-LantingheiSC-Demibold.otf'),
    'hook_yellow':        dict(bg='#ffd600', fg='#171310', stroke=None,      stroke_width=0,  radius=18, pad_x=30, pad_y=16, shadow=True,  font='NotoSansSC-Black.otf'),
    'subtitle_white':     dict(bg=None,      fg='#ffffff', stroke='#000000', stroke_width=8,  radius=0,  pad_x=12, pad_y=8,  shadow=True,  font='NotoSansSC-Black.otf'),
    'warn_orange':        dict(bg='#ff7a1a', fg='#ffffff', stroke=None,      stroke_width=0,  radius=16, pad_x=28, pad_y=14, shadow=True,  font='NotoSansSC-Black.otf'),
    'shop_sign':          dict(bg='#7a1214', fg='#ffd678', stroke='#ffd678', stroke_width=3,  radius=10, pad_x=34, pad_y=18, shadow=True,  font='Full-SourceHanSerifSC-Bold.otf'),
    'title_gold':         dict(bg=None,      fg='#ffcd50', stroke='#3a1c00', stroke_width=8,  radius=0,  pad_x=12, pad_y=8,  shadow=True,  font='Full-SourceHanSerifSC-Bold.otf'),
    'plain':              dict(bg=None,      fg='#ffffff', stroke=None,      stroke_width=0,  radius=0,  pad_x=8,  pad_y=6,  shadow=False, font='Full-LantingheiSC-Demibold.otf'),
    'name_gold':          dict(bg=None,      fg='#E6C285', stroke='#4A3210', stroke_width=3,  radius=0,  pad_x=10, pad_y=8,  shadow=True,  spacing=0.30, font='Full-SourceHanSerifSC-Bold.otf'),
    'role_white':         dict(bg=None,      fg='#F5F1E8', stroke='#000000', stroke_width=2,  radius=0,  pad_x=8,  pad_y=6,  shadow=True,  spacing=0.42, font='Full-LantingheiSC-Demibold.otf'),
}

POSITION_PRESETS = {
    'lower_third': -0.58,
    'center': 0.0,
    'top': 0.55,
}


def _hex(color: Optional[str], alpha: int = 255):
    if not color:
        return None
    c = str(color).strip().lstrip('#')
    if len(c) == 3:
        c = ''.join(ch * 2 for ch in c)
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), alpha)


_FONT_FAMILY_CACHE: Optional[dict] = None


def _font_by_family(fam: str) -> Optional[str]:
    """按字体族名（含字重后缀，如 'Yuanti SC Bold'）解析到 fonts 目录或系统字体路径。"""
    global _FONT_FAMILY_CACHE
    if _FONT_FAMILY_CACHE is None:
        _FONT_FAMILY_CACHE = {}
        for fd in _FONT_DIRS:
            for p in sorted(fd.iterdir()) if fd.is_dir() else []:
                try:
                    fn, _sub = ImageFont.truetype(str(p), 40).getname()
                    _FONT_FAMILY_CACHE.setdefault(fn, str(p))
                except Exception:
                    pass
        for p in FONT_CANDIDATES:
            if p and os.path.exists(p):
                try:
                    fn, _sub = ImageFont.truetype(p, 40).getname()
                    _FONT_FAMILY_CACHE.setdefault(fn, p)
                except Exception:
                    pass
    return _FONT_FAMILY_CACHE.get(fam)


_FONT_ALIASES = {
    '思源粗宋': 'Full-SourceHanSerifSC-Bold.otf',
    'Source Han Serif SC Bold': 'Full-SourceHanSerifSC-Bold.otf',
    '优设标题黑': 'NotoSansSC-Black.otf',
    '思源黑体': 'NotoSansSC-Black.otf',
    'Noto Sans SC': 'NotoSansSC-Black.otf',
    'Noto Sans SC Black': 'NotoSansSC-Black.otf',
    '兰亭黑': 'Full-LantingheiSC-Demibold.otf',
    'Lantinghei SC Demibold': 'Full-LantingheiSC-Demibold.otf',
    'Poppins_Bold': 'Full-HelveticaNeue-Light.ttf',
    'Helvetica Neue Light': 'Full-HelveticaNeue-Light.ttf',
}


def _pick_font_path(requested: Optional[str] = None) -> Optional[str]:
    if requested:
        req = str(requested).strip()
        if os.path.exists(req):
            return req
        for fd in _FONT_DIRS:
            direct_bundled = fd / req
            if direct_bundled.exists():
                return str(direct_bundled)
        alias = _FONT_ALIASES.get(req)
        if alias:
            for fd in _FONT_DIRS:
                if (fd / alias).exists():
                    return str(fd / alias)
        hit = _font_by_family(req)
        if hit:
            return hit
    for p in FONT_CANDIDATES:
        if p and os.path.exists(p):
            return p
    return None


def _load_font(size: int, path: Optional[str] = None) -> ImageFont.FreeTypeFont:
    p = _pick_font_path(path)
    if p:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()


def _render_png(text: str, cfg: dict, font_size: int, max_width: int) -> Image.Image:
    bg = _hex(cfg.get('bg'))
    fg = _hex(cfg.get('fg')) or (255, 255, 255, 255)
    stroke = _hex(cfg.get('stroke'))
    sw = int(cfg.get('stroke_width') or 0)
    pad_x = int(cfg.get('pad_x') or 12)
    pad_y = int(cfg.get('pad_y') or 10)
    radius = int(cfg.get('radius') or 0)
    shadow = bool(cfg.get('shadow'))

    font = _load_font(font_size, cfg.get('font') or None)
    probe = Image.new('RGBA', (10, 10))
    d = ImageDraw.Draw(probe)
    sp = int(font_size * float(cfg.get('spacing') or 0.18))
    bbox = d.multiline_textbbox((0, 0), text, font=font, stroke_width=sw, align='center', spacing=sp)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

    w = tw + pad_x * 2 + sw * 2
    h = th + pad_y * 2 + sw * 2
    img = Image.new('RGBA', (int(w), int(h)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if bg:
        draw.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=bg)

    ox = pad_x + sw - bbox[0]
    oy = pad_y + sw - bbox[1]
    if shadow:
        draw.multiline_text((ox, oy + max(3, font_size // 24)), text, font=font,
                            fill=(0, 0, 0, 110), align='center', spacing=sp)
    draw.multiline_text((ox, oy), text, font=font, fill=fg, align='center',
                        stroke_width=sw, stroke_fill=stroke, spacing=sp)
    return img


def _fit(text: str, cfg: dict, font_size: int, max_width: int):
    size = max(28, int(font_size))
    for _ in range(14):
        img = _render_png(text, cfg, size, max_width)
        if img.width <= max_width or size <= 28:
            return img, size
        size = int(size * max(0.72, min(0.95, max_width / img.width)))
    return img, size


@xcy_bp.post('/xcy/add_styled_text')
def add_styled_text():
    data = request.get_json(force=True, silent=True) or {}
    text = str(data.get('text') or '').strip()
    if not text:
        return jsonify({'success': False, 'error': 'text 不能为空'}), 400

    draft_id = data.get('draft_id')
    if not draft_id:
        return jsonify({'success': False, 'error': 'draft_id 必填（先 create_draft）'}), 400

    style_name = str(data.get('style') or 'hook_yellow')
    if style_name == 'custom':
        cfg = dict(bg=data.get('bg'), fg=data.get('fg') or '#ffffff',
                   stroke=data.get('stroke'), stroke_width=int(data.get('stroke_width') or 0),
                   radius=int(data.get('radius') or 0), pad_x=28, pad_y=14, shadow=True)
    else:
        cfg = dict(PRESETS.get(style_name) or PRESETS['hook_yellow'])

    font_size = int(data.get('font_size') or 96)
    max_width = int(data.get('max_width') or 940)
    img, used_size = _fit(text, cfg, font_size, max_width)

    STYLE_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(
        f'{text}|{style_name}|{used_size}|{max_width}|{cfg}|{img.size}'.encode('utf8')
    ).hexdigest()[:16]
    png = STYLE_DIR / f'{key}.png'
    cached = png.exists()
    if not cached:
        img.save(png, optimize=True)

    pos = data.get('pos')
    if pos in POSITION_PRESETS:
        transform_y = POSITION_PRESETS[pos]
    else:
        transform_y = float(data.get('transform_y', POSITION_PRESETS['lower_third']))

    intro = data.get('intro')
    intro = None if intro in (None, '', 'None', 'none', 'NoneType') else str(intro)

    try:
        result = add_image_impl(
            image_url=str(png),
            draft_folder=data.get('draft_folder'),
            width=int(data.get('width') or 1080),
            height=int(data.get('height') or 1920),
            start=float(data.get('start') or 0),
            end=float(data.get('end') or (float(data.get('start') or 0) + 3.0)),
            draft_id=draft_id,
            transform_x=float(data.get('transform_x') or 0),
            transform_y=transform_y,
            scale_x=float(data.get('scale_x') or 1),
            scale_y=float(data.get('scale_y') or 1),
            track_name=str(data.get('track_name') or 'styled_text'),
            relative_index=int(data.get('relative_index') or 0),
            intro_animation=intro,
            intro_animation_duration=float(data.get('intro_duration') or 0.45),
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({'success': False, 'error': f'写入草稿失败：{exc}', 'png': str(png)}), 500

    return jsonify({
        'success': True,
        'draft_id': result.get('draft_id', draft_id),
        'draft_url': result.get('draft_url', ''),
        'png': str(png),
        'style': style_name,
        'font_size': used_size,
        'size': list(img.size),
        'intro': intro,
        'cached': cached,
    })


@xcy_bp.get('/xcy/styles')
def list_styles():
    return jsonify({'success': True, 'styles': list(PRESETS.keys()), 'positions': list(POSITION_PRESETS.keys()),
                    'font': _pick_font_path()})


# 内置字体清单：fonts 目录（引擎/导出用，family 含字重后缀）+ 系统 CJK（预览可用）
_FONT_LABELS = [
    ('Xingkai SC', '行楷', '书法手写'), ('Kaiti SC', '楷体', '书法手写'),
    ('Baoli SC', '报隶', '书法手写'), ('Libian SC', '隶变', '书法手写'),
    ('Weibei SC', '魏碑', '书法手写'), ('Hannotate SC', '手札体', '书法手写'),
    ('HanziPen SC', '翩翩体', '书法手写'), ('LingWai SC', '凌慧体', '书法手写'),
    ('Yuanti SC', '圆体', '圆润'), ('Wawati SC', '娃娃体', '圆润'), ('Yuppy SC', '雅痞体', '圆润'),
    ('PingFang SC', '苹方', '现代黑体'), ('Lantinghei SC', '兰亭黑', '现代黑体'),
    ('Noto Sans SC', '思源黑', '现代黑体'), ('STHeiti', '华文黑体', '现代黑体'),
    ('STFangsong', '仿宋', '传统'),
]

@xcy_bp.get('/xcy/fonts')
def list_fonts():
    """返回可用字体：family（含字重后缀的唯一族名）/ label（中文名）/ kind（分组）/ path。"""
    fonts_dir = Path(__file__).resolve().parent / 'fonts'
    rows = []
    for p in sorted(fonts_dir.iterdir()):
        if p.suffix.lower() not in ('.otf', '.ttf', '.ttc'):
            continue
        try:
            fam, sub = ImageFont.truetype(str(p), 40).getname()
        except Exception:
            continue
        base = fam.rsplit(' ', 1)[0] if sub and sub not in ('Regular',) and fam.endswith(f' {sub}') else fam
        label = next((l for f, l, k in _FONT_LABELS if base == f), base)
        kind = next((k for f, l, k in _FONT_LABELS if base == f), '其他')
        rows.append({'family': fam, 'label': label, 'kind': kind,
                     'weight': sub or '', 'path': str(p)})
    return jsonify({'success': True, 'fonts': rows})


# ─────────────────────────── 音效 ───────────────────────────
# /add_audio 只认 http 素材、且没有淡入淡出。这里补一个本地文件直加：
# 传本机 wav/mp3，引擎自己转码、加淡入淡出、落进草稿 audio 轨。

AUDIO_DIR = CACHE_ROOT / 'audio'
FFMPEG = os.environ.get('XCY_FFMPEG') or shutil.which('ffmpeg') or 'ffmpeg'


def _probe_duration(path: str) -> float:
    ffprobe = shutil.which('ffprobe') or 'ffprobe'
    try:
        out = subprocess.run(
            [ffprobe, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
            capture_output=True, text=True, timeout=20,
        )
        return float((out.stdout or '0').strip() or 0)
    except Exception:
        return 0.0


@xcy_bp.post('/xcy/add_local_audio')
def add_local_audio():
    from util import build_draft_asset_path, url_to_hash
    from add_audio_track import add_audio_track

    data = request.get_json(force=True, silent=True) or {}
    src = str(data.get('path') or '')
    if not src or not os.path.exists(src):
        return jsonify({'success': False, 'error': f'音频不存在：{src}'}), 400

    draft_id = data.get('draft_id')
    draft_folder = data.get('draft_folder')
    if not draft_id or not draft_folder:
        return jsonify({'success': False, 'error': 'draft_id 与 draft_folder 都必填'}), 400

    volume = float(data.get('volume') if data.get('volume') is not None else 1.0)
    fade_in = float(data.get('fade_in') or 0)
    fade_out = float(data.get('fade_out') or 0)
    total = _probe_duration(src)

    # 统一转成 mp3（草稿里音频素材固定按 mp3 命名），顺带做淡入淡出
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(f'{src}|{os.path.getmtime(src)}|{fade_in}|{fade_out}'.encode('utf8')).hexdigest()[:16]
    cooked = AUDIO_DIR / f'{key}.mp3'
    if not cooked.exists():
        filters = []
        if fade_in > 0:
            filters.append(f'afade=t=in:st=0:d={fade_in}')
        if fade_out > 0:
            start = max(0.0, total - fade_out)
            filters.append(f'afade=t=out:st={start}:d={fade_out}')
        cmd = [FFMPEG, '-y', '-v', 'error', '-i', src]
        if filters:
            cmd += ['-af', ','.join(filters)]
        cmd += ['-c:a', 'libmp3lame', '-b:a', '192k', str(cooked)]
        run = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if run.returncode != 0:
            return jsonify({'success': False, 'error': f'转码失败：{(run.stderr or "").strip()[:200]}'}), 500

    duration = _probe_duration(str(cooked)) or total
    # 直接给绝对路径：保存草稿时引擎会把它拷进草稿的 assets/audio，
    # 比给 http 地址少一次网络往返（也避免自己请求自己）。
    url = str(cooked)
    material_name = f'audio_{url_to_hash(url)}.mp3'
    dest = build_draft_asset_path(draft_folder, draft_id, 'audio', material_name)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if not os.path.exists(dest):
        shutil.copyfile(cooked, dest)

    end = data.get('end')
    try:
        result = add_audio_track(
            audio_url=url,
            draft_folder=draft_folder,
            start=float(data.get('start') or 0),
            end=float(end) if end is not None else None,
            target_start=float(data.get('target_start') or 0),
            draft_id=draft_id,
            volume=volume,
            track_name=str(data.get('track_name') or 'sfx'),
            speed=float(data.get('speed') or 1.0),
            duration=duration,
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({'success': False, 'error': f'写入音频轨失败：{exc}'}), 500

    return jsonify({
        'success': True,
        'draft_id': result.get('draft_id', draft_id),
        'draft_url': result.get('draft_url', ''),
        'file': str(cooked),
        'duration': round(duration, 3),
        'volume': volume,
        'fade_in': fade_in,
        'fade_out': fade_out,
    })


# ─────────────────────── 配方渲染成片（不经过剪映） ───────────────────────
# 这是"出成片"的主路径：配方进，mp4 出。剪映草稿只是可选的副产物。
RENDER_JOBS: dict[str, dict] = {}
RENDER_CANCEL: dict[str, threading.Event] = {}
RENDER_LOCK = threading.Lock()


def _default_out(name: str) -> str:
    out_dir = Path(os.path.expanduser('~/Movies/xcy-out'))
    out_dir.mkdir(parents=True, exist_ok=True)
    safe = ''.join(ch for ch in (name or 'output') if ch.isalnum() or ch in '-_') or 'output'
    return str(out_dir / f"{safe}-{time.strftime('%m%d-%H%M%S')}.mp4")


def _render_worker(task_id: str, recipe: dict, out: str, base_dir: str,
                   preset: str, hardware: bool) -> None:
    import xcy_render

    cancel = RENDER_CANCEL[task_id]
    job = RENDER_JOBS[task_id]

    def progress(p: float) -> None:
        job['progress'] = round(p * 100, 1)
        job['message'] = f'渲染中 {job["progress"]}%'

    try:
        job['status'] = 'running'
        job['message'] = '渲染中'
        job['started_at'] = time.strftime('%Y-%m-%dT%H:%M:%S')
        def stage(name: str) -> None:
            job['stage'] = name
            job['message'] = name

        result = xcy_render.render_recipe(
            recipe, out, base_dir, preset=preset, hardware=hardware,
            on_progress=progress, cancel_flag=cancel, on_stage=stage,
        )
        job.update(result)
        # 出片就顺手质检：黑帧/静音/响度/时长。跑不动不影响出片，只记一条 warn。
        if job.get('qc', True):
            try:
                import xcy_qc
                job['qc'] = xcy_qc.qc(
                    result['out'], expected_duration=result.get('duration'),
                    expected_size=(result.get('width'), result.get('height')),
                )
                if job['qc']['status'] == 'fail':
                    job['message'] = '完成，但质检没通过（见 qc.checks）'
            except Exception as exc:  # noqa: BLE001
                job['qc'] = {'status': 'warn', 'error': str(exc)}
        job['status'] = 'done'
        job['progress'] = 100
        job['message'] = f'完成，{result["size_mb"]}MB，用时 {result["elapsed"]} 秒'
    except Exception as exc:  # noqa: BLE001
        job['status'] = 'cancelled' if cancel.is_set() else 'error'
        job['message'] = f'渲染失败：{exc}' if not cancel.is_set() else '已取消'
        job['error'] = str(exc)
    finally:
        job['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%S')


@xcy_bp.post('/xcy/render')
def render_start():
    """配方 → mp4。异步：先拿 task_id，再轮询进度。

    请求体三种写法都行：
      {"recipe": {...}, "out": "...", "base_dir": "...", "preset": "final"}
      {"path": "/abs/recipe.json"}
      {...配方字段直接平铺...}
    """
    data = request.get_json(force=True, silent=True) or {}
    base_dir = str(data.get('base_dir') or '')

    recipe = data.get('recipe') if isinstance(data.get('recipe'), dict) else None
    if recipe is None and data.get('path'):
        p = Path(os.path.expanduser(str(data['path'])))
        if not p.exists():
            return jsonify({'success': False, 'error': f'配方文件不存在：{p}'}), 400
        recipe = json.loads(p.read_text(encoding='utf8'))
        base_dir = base_dir or str(p.parent)
    if recipe is None:
        reserved = {'base_dir', 'out', 'preset', 'hardware', 'path'}
        recipe = {k: v for k, v in data.items() if k not in reserved}
    if not recipe:
        return jsonify({'success': False, 'error': '没有配方内容'}), 400

    if isinstance(recipe.get('videos'), list):
        return jsonify({'success': False, 'error': '批量请用 POST /xcy/build_file，或逐条调用 /xcy/render'}), 400

    # 覆盖项：让界面能"换个字幕样式再渲一遍"，不用改配方文件
    ov = data.get('overrides') if isinstance(data.get('overrides'), dict) else {}
    if ov and recipe.get('subtitles'):
        subs = dict(recipe['subtitles'])
        if ov.get('subtitle_style'):
            subs['style'] = str(ov['subtitle_style'])
        if 'avoid_face' in ov:
            subs['avoid_face'] = bool(ov['avoid_face'])
        if isinstance(ov.get('highlight'), dict):
            subs['highlight'] = ov['highlight']
        if isinstance(ov.get('safe'), dict):
            subs['safe'] = ov['safe']
        recipe = {**recipe, 'subtitles': subs}

    base_dir = base_dir or str(Path.home())
    out = str(data.get('out') or _default_out(recipe.get('name') or 'output'))
    preset = str(data.get('preset') or 'final')
    hardware = bool(data.get('hardware', True))

    task_id = 'rnd_' + uuid.uuid4().hex[:12]
    with RENDER_LOCK:
        RENDER_JOBS[task_id] = {
            'task_id': task_id, 'status': 'queued', 'progress': 0,
            'message': '排队中', 'out': out, 'preset': preset,
            'qc': bool(data.get('qc', True)),
            'queued_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
        }
        RENDER_CANCEL[task_id] = threading.Event()

    threading.Thread(
        target=_render_worker,
        args=(task_id, recipe, out, base_dir, preset, hardware),
        daemon=True,
    ).start()
    return jsonify({'success': True, 'task_id': task_id, 'out': out, 'status': 'queued'})


@xcy_bp.get('/xcy/render/<task_id>')
def render_status(task_id: str):
    job = RENDER_JOBS.get(task_id)
    if not job:
        return jsonify({'success': False, 'error': '没有这个任务'}), 404
    return jsonify({'success': True, **job})


@xcy_bp.post('/xcy/render/<task_id>/cancel')
def render_cancel(task_id: str):
    job = RENDER_JOBS.get(task_id)
    if not job:
        return jsonify({'success': False, 'error': '没有这个任务'}), 404
    flag = RENDER_CANCEL.get(task_id)
    if flag:
        flag.set()
    return jsonify({'success': True, 'task_id': task_id, 'cancelling': True})


_ASR_EST_MB = {'tiny': 75, 'base': 145, 'small': 480, 'medium': 1500, 'large-v3': 3100}
_ASR_JOBS: dict = {}


@xcy_bp.get('/xcy/asr/status')
def asr_status():
    """转写模型是否已下载。前端点“语音转字幕”前先问这个，别让用户干等。"""
    import xcy_subtitle
    model = str(request.args.get('model') or 'small')
    ready = xcy_subtitle.model_ready(model)
    size = 0
    try:
        for p in xcy_subtitle.MODEL_DIR.rglob('*'):
            if p.is_file():
                size += p.stat().st_size
    except Exception:  # noqa: BLE001
        pass
    job = _ASR_JOBS.get(model) or {}
    return jsonify({
        'success': True, 'model': model, 'ready': ready,
        'dir': str(xcy_subtitle.MODEL_DIR), 'size_mb': int(size / 1e6),
        'estimate_mb': _ASR_EST_MB.get(model, 480),
        'preparing': bool(job.get('running')), 'error': job.get('error') or '',
    })


@xcy_bp.post('/xcy/asr/prepare')
def asr_prepare():
    """开始下载转写模型（后台线程，幂等）。"""
    import xcy_subtitle
    data = request.get_json(force=True, silent=True) or {}
    model = str(data.get('model') or 'small')
    if xcy_subtitle.model_ready(model):
        return jsonify({'success': True, 'ready': True, 'model': model})
    job = _ASR_JOBS.get(model) or {}
    if job.get('running'):
        return jsonify({'success': True, 'ready': False, 'running': True,
                        'estimate_mb': _ASR_EST_MB.get(model, 480)})

    def _work():
        _ASR_JOBS[model] = {'running': True, 'error': ''}
        try:
            xcy_subtitle.ensure_model(model)
            _ASR_JOBS[model] = {'running': False, 'error': ''}
        except Exception as exc:  # noqa: BLE001
            _ASR_JOBS[model] = {'running': False, 'error': f'{exc}'}

    threading.Thread(target=_work, daemon=True).start()
    return jsonify({'success': True, 'ready': False, 'running': True,
                    'estimate_mb': _ASR_EST_MB.get(model, 480)})


@xcy_bp.post('/xcy/transcribe')
def transcribe_audio():
    """本地转写口播 → 带时间的字幕句。可选直接落一份 srt。"""
    import xcy_subtitle

    data = request.get_json(force=True, silent=True) or {}
    src = str(data.get('path') or '')
    if not src or not os.path.exists(os.path.expanduser(src)):
        return jsonify({'success': False, 'error': f'文件不存在：{src}'}), 400
    src = os.path.expanduser(src)
    try:
        segs = xcy_subtitle.transcribe(
            src,
            model=str(data.get('model') or 'small'),
            language=str(data.get('language') or 'zh'),
            force=bool(data.get('force')),
            words=bool(data.get('words')),
        )
        lines = xcy_subtitle.merge_segments(segs, int(data.get('max_chars') or 14))
    except Exception as exc:  # noqa: BLE001
        return jsonify({'success': False, 'error': f'转写失败：{exc}'}), 500

    srt_path = ''
    if data.get('srt_out'):
        out = Path(os.path.expanduser(str(data['srt_out'])))
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(xcy_subtitle.to_srt(lines), encoding='utf8')
        srt_path = str(out)

    return jsonify({
        'success': True, 'segments': lines, 'raw_count': len(segs),
        'srt': srt_path, 'model': data.get('model') or 'small',
        'words': bool(data.get('words')),
    })


# ─────────────────────── 批量渲染（多店/多城市一次出） ───────────────────────
BATCH_JOBS: dict[str, dict] = {}
BATCH_LOCK = threading.Lock()


def _batch_one(item: dict, base_dir: str, preset: str, hardware: bool, run_qc: bool) -> dict:
    import xcy_render

    try:
        result = xcy_render.render_recipe(
            item['recipe'], item['out'], base_dir, preset=preset, hardware=hardware,
        )
        out = {'index': item['index'], 'name': item['name'], 'status': 'done', **result}
        if run_qc:
            try:
                import xcy_qc
                out['qc'] = xcy_qc.qc(
                    result['out'], expected_duration=result.get('duration'),
                    expected_size=(result.get('width'), result.get('height')),
                )
            except Exception as exc:  # noqa: BLE001
                out['qc'] = {'status': 'warn', 'error': str(exc)}
        return out
    except Exception as exc:  # noqa: BLE001
        return {'index': item['index'], 'name': item['name'], 'status': 'error', 'error': str(exc)}


@xcy_bp.post('/xcy/render_batch')
def render_batch_start():
    """多条配方一起渲。顶层 {"videos":[...]} 的配方文件可以直接传 path。

    concurrency 默认 2（每路渲染本身就吃多核，开太多反而慢）。
    """
    import concurrent.futures as cf
    import xcy_render

    data = request.get_json(force=True, silent=True) or {}
    base_dir = str(data.get('base_dir') or '')
    jobs_src: list[dict] = []

    if isinstance(data.get('recipes'), list):
        jobs_src = [{'name': str(r.get('name') or f'item-{i + 1}'), 'recipe': r}
                    for i, r in enumerate(data['recipes'])]
    elif data.get('path'):
        p = Path(os.path.expanduser(str(data['path'])))
        if not p.exists():
            return jsonify({'success': False, 'error': f'配方文件不存在：{p}'}), 400
        raw = json.loads(p.read_text(encoding='utf8'))
        base_dir = base_dir or str(p.parent)
        if isinstance(raw.get('videos'), list):
            jobs_src = [{'name': str(r.get('name') or f'item-{i + 1}'), 'recipe': r}
                        for i, r in enumerate(raw['videos'])]
        else:
            jobs_src = [{'name': str(raw.get('name') or 'output'), 'recipe': raw}]
    else:
        return jsonify({'success': False, 'error': '传 recipes[] 或 path'}), 400

    if not jobs_src:
        return jsonify({'success': False, 'error': '配方列表是空的'}), 400

    base_dir = base_dir or str(Path.home())
    out_dir = Path(os.path.expanduser(str(data.get('out_dir') or '~/Movies/xcy-out')))
    out_dir.mkdir(parents=True, exist_ok=True)
    preset = str(data.get('preset') or 'final')
    hardware = bool(data.get('hardware', True))
    run_qc = bool(data.get('qc', True))
    concurrency = max(1, min(4, int(data.get('concurrency') or 2)))

    batch_id = 'bat_' + uuid.uuid4().hex[:12]
    stamp = time.strftime('%m%d-%H%M%S')
    items = []
    for i, job in enumerate(jobs_src):
        safe = ''.join(ch for ch in job['name'] if ch.isalnum() or ch in '-_') or f'item{i + 1}'
        items.append({
            'index': i, 'name': job['name'], 'recipe': job['recipe'],
            'out': str(out_dir / f'{safe}-{stamp}.mp4'),
        })

    with BATCH_LOCK:
        BATCH_JOBS[batch_id] = {
            'batch_id': batch_id, 'status': 'running', 'total': len(items),
            'done': 0, 'failed': 0, 'concurrency': concurrency,
            'started_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
            'items': [{'index': it['index'], 'name': it['name'], 'out': it['out'], 'status': 'queued'}
                      for it in items],
        }

    def worker() -> None:
        state = BATCH_JOBS[batch_id]
        with cf.ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = {
                pool.submit(_batch_one, it, base_dir, preset, hardware, run_qc): it
                for it in items
            }
            for fut in cf.as_completed(futures):
                result = fut.result()
                with BATCH_LOCK:
                    state['items'][result['index']] = result
                    if result['status'] == 'done':
                        state['done'] += 1
                    else:
                        state['failed'] += 1
                    state['message'] = f"完成 {state['done']}/{state['total']}"
        state['status'] = 'done' if not state['failed'] else 'partial'
        state['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%S')

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({'success': True, 'batch_id': batch_id, 'total': len(items),
                    'concurrency': concurrency, 'out_dir': str(out_dir)})


@xcy_bp.get('/xcy/render_batch/<batch_id>')
def render_batch_status(batch_id: str):
    state = BATCH_JOBS.get(batch_id)
    if not state:
        return jsonify({'success': False, 'error': '没有这个批次'}), 404
    return jsonify({'success': True, **state})


@xcy_bp.post('/xcy/qc')
def qc_video():
    """对已有成片单独质检。"""
    import xcy_qc

    data = request.get_json(force=True, silent=True) or {}
    path = os.path.expanduser(str(data.get('path') or ''))
    if not path or not os.path.exists(path):
        return jsonify({'success': False, 'error': f'文件不存在：{path}'}), 400
    result = xcy_qc.qc(
        path,
        expected_duration=(float(data['expected_duration']) if data.get('expected_duration') else None),
        expected_size=(tuple(data['expected_size']) if data.get('expected_size') else None),
    )
    return jsonify({'success': True, **result})


@xcy_bp.get('/xcy/graphics')
def list_graphics():
    """包装图形清单（箭头/圈注/高亮框/下划线）+ 片头片尾卡的默认参数。"""
    import xcy_pack

    return jsonify({
        'success': True,
        'kinds': xcy_pack.graphic_kinds(),
        'card_default': {'dur': 3.0, 'bg': '#12141a', 'fg': '#ffffff', 'accent': '#ffd600'},
        'note': '配方里写 graphics[] 与 intro/outro；片头片尾是"加时长"，不是盖住画面',
    })


@xcy_bp.get('/xcy/luts')
def list_luts():
    """调色预设清单。`builtin` 是代码里生成的，给 path 也能用外部 .cube。"""
    import xcy_look

    return jsonify({
        'success': True,
        'luts': xcy_look.preset_list(),
        'dir': str(xcy_look.LUT_DIR),
    })


@xcy_bp.get('/xcy/bgm')
def list_bgm():
    """BGM 曲库：文件名 + sidecar 元数据（genre/bpm/mood/duration）。"""
    import xcy_audiofx

    items = xcy_audiofx.library()
    return jsonify({
        'success': True,
        'count': len(items),
        'items': items,
        'dirs': [str(d) for d in xcy_audiofx.BGM_DIRS],
    })


@xcy_bp.get('/xcy/voice_fx')
def list_voice_fx():
    """人声增强档位。"""
    import xcy_audiofx

    return jsonify({'success': True, 'levels': [
        {'id': 'off', 'label': '不处理'},
        {'id': 'clean', 'label': '标准降噪（默认）', 'note': '底噪约 -12dB，人声不变闷'},
        {'id': 'strong', 'label': '强力降噪', 'note': '底噪约 -16dB，嘈杂环境用，气声会少一点'},
    ]})


@xcy_bp.get('/xcy/subtitle_styles')
def subtitle_styles():
    """字幕样式清单：界面拿它渲染下拉框 / 缩略图。"""
    import xcy_style

    return jsonify({
        'success': True,
        'styles': xcy_style.style_list(),
        'default': 'douyin_bottom',
        'safe': dict(xcy_style.DEFAULT_SAFE),
        'lexicon': list(xcy_style.DEFAULT_LEXICON),
        'highlight_default': {'color': '#ffd600', 'max_per_line': 2},
    })


@xcy_bp.post('/xcy/subtitle_preview')
def subtitle_preview():
    """出一张字幕样式预览图（base64 PNG），不整片渲染。"""
    import base64

    import xcy_style

    data = request.get_json(force=True, silent=True) or {}
    text = str(data.get('text') or '这句字幕长这样，念到哪儿亮到哪儿')
    size = data.get('size') or [768, 1024]
    bg = data.get('bg') or None
    if bg:
        bg = os.path.expanduser(str(bg))
        if not os.path.exists(bg):
            bg = None
    try:
        png = xcy_style.preview_png(
            text,
            str(data.get('style') or 'douyin_bottom'),
            canvas=(int(size[0]), int(size[1])),
            bg=bg,
            at=float(data.get('at') or 1.0),
            highlight=data.get('highlight') if isinstance(data.get('highlight'), dict) else None,
            safe=data.get('safe') if isinstance(data.get('safe'), dict) else None,
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({'success': False, 'error': f'预览失败：{exc}'}), 500
    return jsonify({
        'success': True,
        'style': str(data.get('style') or 'douyin_bottom'),
        'image': 'data:image/png;base64,' + base64.b64encode(png).decode('ascii'),
    })


@xcy_bp.post('/xcy/subtitle_words')
def subtitle_words():
    """只挑关键词：给界面做"这句我会标哪几个词"的演示，不渲染。"""
    import xcy_style

    data = request.get_json(force=True, silent=True) or {}
    segs = data.get('segments')
    if not isinstance(segs, list) or not segs:
        text = str(data.get('text') or '')
        segs = [{'start': 0, 'end': 1, 'text': text}] if text else []
    hl = data.get('highlight') if isinstance(data.get('highlight'), dict) else {}
    picked = xcy_style.pick_keywords(
        segs,
        lexicon=hl.get('lexicon') or data.get('lexicon') or None,
        max_per_line=int(hl.get('max_per_line') or 2),
        blacklist=hl.get('blacklist') or None,
    )
    return jsonify({'success': True, 'highlights': {
        str(k): v for k, v in picked.items()
    }, 'count': sum(len(v) for v in picked.values())})


@xcy_bp.get('/xcy/renders')
def render_list():
    jobs = sorted(RENDER_JOBS.values(), key=lambda j: j.get('queued_at', ''), reverse=True)[:30]
    return jsonify({'success': True, 'jobs': jobs})


@xcy_bp.get('/xcy')
def capability_index():
    """能力索引：以后加新接口，记得在这里登记一行。"""
    return jsonify({
        'success': True,
        'name': 'Xiaocongcut 通用扩展',
        'version': 1,
        'capabilities': [
            {'method': 'GET', 'path': '/xcy', 'summary': '能力索引：本页（列出所有扩展接口）'},
            {'method': 'POST', 'path': '/xcy/add_styled_text', 'summary': '参数化花字：文字+样式 → 画图并写进草稿，可带动画', 'params': ['text', 'style', 'draft_id', 'start', 'end', 'pos', 'intro', 'font_size', 'max_width']},
            {'method': 'POST', 'path': '/xcy/add_local_audio', 'summary': '本地音频直加：转 mp3、可淡入淡出 → 写进音频轨', 'params': ['path', 'draft_id', 'draft_folder', 'target_start', 'volume', 'fade_in', 'fade_out']},
            {'method': 'GET', 'path': '/xcy/styles', 'summary': '花字预设、位置、当前字体'},
            {'method': 'POST', 'path': '/xcy/build', 'summary': '配方出片：传一份配方 JSON → 直接产出剪映草稿', 'params': ['recipe', 'base_dir', 'dry_run']},
            {'method': 'POST', 'path': '/xcy/person_alpha', 'summary': '抠出人像，输出带透明通道的 mov（给文字下层用）', 'params': ['path', 'model', 'start', 'end']},
            {'method': 'POST', 'path': '/xcy/render', 'summary': '配方直接渲染成 mp4（异步，返回 task_id）；overrides 可临时换字幕样式', 'params': ['recipe', 'path', 'out', 'base_dir', 'preset', 'hardware', 'overrides']},
            {'method': 'GET', 'path': '/xcy/render/<task_id>', 'summary': '查渲染进度与结果'},
            {'method': 'POST', 'path': '/xcy/render/<task_id>/cancel', 'summary': '取消渲染'},
            {'method': 'GET', 'path': '/xcy/renders', 'summary': '最近 30 个渲染任务'},
            {'method': 'POST', 'path': '/xcy/render_batch', 'summary': '批量渲染：多条配方并发出片，默认每条出完自动质检', 'params': ['recipes', 'path', 'out_dir', 'concurrency', 'preset', 'qc']},
            {'method': 'GET', 'path': '/xcy/render_batch/<batch_id>', 'summary': '查批量进度与每条结果'},
            {'method': 'POST', 'path': '/xcy/qc', 'summary': '成片质检：黑帧/静音/响度/时长/分辨率', 'params': ['path', 'expected_duration', 'expected_size']},
            {'method': 'POST', 'path': '/xcy/transcribe', 'summary': '本地转写口播 → 带时间的字幕句（可导出 srt；words=true 出词级时间）', 'params': ['path', 'model', 'language', 'max_chars', 'srt_out', 'words']},
            {'method': 'GET', 'path': '/xcy/subtitle_styles', 'summary': '字幕样式清单：白字/底条/关键词/逐字 + 安全区 + 词表'},
            {'method': 'GET', 'path': '/xcy/luts', 'summary': '调色预设清单（暖调/冷调/胶片，强度可调）'},
            {'method': 'GET', 'path': '/xcy/graphics', 'summary': '包装图形清单（箭头/圈注/框/下划线）'},
            {'method': 'GET', 'path': '/xcy/bgm', 'summary': 'BGM 曲库（含 genre/bpm/mood 元数据）'},
            {'method': 'GET', 'path': '/xcy/voice_fx', 'summary': '人声增强档位（off/clean/strong）'},
            {'method': 'POST', 'path': '/xcy/subtitle_preview', 'summary': '字幕样式预览图（base64 PNG，可指定素材当底）', 'params': ['style', 'text', 'size', 'bg', 'at', 'highlight']},
            {'method': 'POST', 'path': '/xcy/subtitle_words', 'summary': '只挑关键词（预览标色结果，不渲染）', 'params': ['segments', 'text', 'highlight']},
            {'method': 'POST', 'path': '/xcy/build_file', 'summary': '按配方文件路径出片，支持 videos 批量', 'params': ['path', 'dry_run']},
        ],
    })


# ─────────────────────── 配方出片（引擎方法） ───────────────────────
# 把 xcy_build.py 的装配线挂到引擎上：任何客户端传一份配方就能出草稿，
# 不用装 Python、不用记住命令行。

@xcy_bp.post('/xcy/build')
def build_from_recipe():
    import xcy_build  # 同一目录，复用同一份装配逻辑，避免两份实现

    data = request.get_json(force=True, silent=True) or {}
    recipe = data.get('recipe') if isinstance(data.get('recipe'), dict) else None
    if recipe is None:
        recipe = {k: v for k, v in data.items() if k not in ('base_dir', 'dry_run')}
    if not recipe:
        return jsonify({'success': False, 'error': '配方为空：传 {"recipe": {...}}'}), 400

    base_dir = Path(os.path.expanduser(str(data.get('base_dir') or Path.home())))
    try:
        result = xcy_build.build(recipe, base_dir, dry_run=bool(data.get('dry_run')))
    except Exception as exc:  # noqa: BLE001
        return jsonify({'success': False, 'error': str(exc)}), 500

    return jsonify({'success': True, **result})


@xcy_bp.post('/xcy/build_file')
def build_from_file():
    """按路径读一份配方文件（给本机脚本/CI 用）。"""
    import xcy_build

    data = request.get_json(force=True, silent=True) or {}
    path = Path(os.path.expanduser(str(data.get('path') or '')))
    if not path.exists():
        return jsonify({'success': False, 'error': f'配方文件不存在：{path}'}), 400
    try:
        raw = json.loads(path.read_text(encoding='utf8'))
        jobs = raw['videos'] if isinstance(raw.get('videos'), list) else [raw]
        results = [xcy_build.build(job, path.parent, dry_run=bool(data.get('dry_run'))) for job in jobs]
    except Exception as exc:  # noqa: BLE001
        return jsonify({'success': False, 'error': str(exc)}), 500
    return jsonify({'success': True, 'count': len(results), 'results': results})


# ─────────────── 人像透明层（无需剪映抠像） ───────────────
@xcy_bp.post('/xcy/person_alpha')
def person_alpha():
    """把视频里的人抠出来，返回带 alpha 的 ProRes 4444 mov（可当上层叠加）。

    结果按源文件指纹缓存，同一条素材重复出片不重抠。
    """
    import xcy_matte

    data = request.get_json(force=True, silent=True) or {}
    src = str(data.get('path') or '')
    if not src or not os.path.exists(src):
        return jsonify({'success': False, 'error': f'视频不存在：{src}'}), 400
    start = data.get('start')
    end = data.get('end')
    try:
        out = xcy_matte.alpha_cache(
            src, str(data.get('model') or 'u2net'),
            None if start is None else float(start),
            None if end is None else float(end),
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({'success': False, 'error': f'抠像失败：{exc}'}), 500
    return jsonify({'success': True, 'path': out,
                    'start': start, 'end': end,
                    'duration': None if end is None else round(float(end) - float(start or 0), 3)})


# ═══════════════ 轻剪辑（时间线）支撑接口 ═══════════════
# 三级能力：素材探测 / 配方规整 / 预览代理片
# 都是旁挂，不改官方 31 路由，也不改渲染主链路。

PROXY_DIR = CACHE_ROOT / 'proxy'
_PROBE_CACHE: dict[str, dict] = {}
_PROBE_LOCK = threading.Lock()


def _source_signature(path: str) -> str:
    try:
        st = os.stat(path)
        return f'{path}|{int(st.st_mtime)}|{st.st_size}'
    except OSError:
        return path


def _probe_cached(path: str) -> dict:
    """按 路径+mtime+size 缓存 ffprobe 结果，时间线一次打开不用重复探。"""
    if not path or not os.path.exists(path):
        raise FileNotFoundError(f'素材不存在：{path}')
    key = _source_signature(path)
    with _PROBE_LOCK:
        hit = _PROBE_CACHE.get(key)
    if hit:
        return dict(hit)
    import xcy_render
    info = xcy_render.probe(path)
    with _PROBE_LOCK:
        _PROBE_CACHE[key] = dict(info)
        if len(_PROBE_CACHE) > 500:
            for k in list(_PROBE_CACHE.keys())[:100]:
                _PROBE_CACHE.pop(k, None)
    return dict(info)


@xcy_bp.post('/xcy/probe')
def xcy_probe():
    """批量读素材信息：时长/宽高/帧率。时间线布局要用。"""
    data = request.get_json(force=True, silent=True) or {}
    base = Path(str(data.get('base_dir') or os.getcwd()))
    paths = data.get('paths')
    if not paths and data.get('path'):
        paths = [data.get('path')]
    paths = list(paths or [])[:100]
    items = []
    for raw in paths:
        import xcy_render
        src = xcy_render.resolve(str(raw), base)
        exists = os.path.exists(src)
        item = {'path': src, 'exists': exists}
        if exists:
            try:
                item.update(_probe_cached(src))
                item['kind'] = xcy_render.kind_of(src)
            except Exception as exc:  # noqa: BLE001
                item['exists'] = False
                item['error'] = f'读不了：{exc}'
        else:
            item['error'] = '文件不存在'
        items.append(item)
    return jsonify({'success': True, 'items': items})


def _norm_recipe(recipe: dict, base: Path) -> tuple[dict, list[str], float]:
    """补齐 id/target、夹取越界、跳过空片段；只规整不动语义。"""
    import xcy_render

    warnings: list[str] = []
    clips_out: list[dict] = []
    cursor = 0.0
    for i, c in enumerate(list(recipe.get('clips') or [])):
        src_raw = str(c.get('source') or '').strip()
        if not src_raw:
            warnings.append(f'第 {i + 1} 段没有 source，已跳过')
            continue
        src = xcy_render.resolve(src_raw, base)
        info = None
        if os.path.exists(src):
            try:
                info = _probe_cached(src)
            except Exception as exc:  # noqa: BLE001
                warnings.append(f'第 {i + 1} 段读不了：{exc}')
        else:
            warnings.append(f'第 {i + 1} 段素材不存在：{src}')

        try:
            start = max(0.0, float(c.get('start') or 0))
        except (TypeError, ValueError):
            start = 0.0
        end_raw = c.get('end')
        try:
            end = float(end_raw) if end_raw is not None else None
        except (TypeError, ValueError):
            end = None
        # 图片没有“素材时长”语义，ffprobe 常把单帧探成 0.04s；
        # 图片片段的显示时长完全由 recipe 的 end-start 决定，不能按探测帧长夹取。
        is_photo = str(xcy_render.kind_of(src)).lower() == 'photo'
        dur = 0 if is_photo else float((info or {}).get('duration') or 0)
        if end is None or end <= start:
            end = dur if dur > start else start + 0.5
        if dur and end > dur + 0.05:
            warnings.append(f'第 {i + 1} 段出点 {end:.2f}s 超过素材 {dur:.2f}s，已夹到 {dur:.2f}s')
            end = dur
        try:
            target = float(c.get('target')) if c.get('target') is not None else cursor
        except (TypeError, ValueError):
            target = cursor
        target = max(0.0, target)
        if target < cursor - 0.001:
            warnings.append(f'第 {i + 1} 段与前一段重叠，已后移到 {cursor:.2f}s')
            target = cursor

        clip = dict(c)
        clip.update({
            'id': str(c.get('id') or f'c{i + 1}'),
            'source': src,
            'start': round(start, 3),
            'end': round(end, 3),
            'target': round(target, 3),
        })
        clips_out.append(clip)
        cursor = target + (end - start)

    norm = dict(recipe)
    norm['version'] = max(3, int(recipe.get('version') or 3))
    norm['clips'] = clips_out

    subs = norm.get('subtitles')
    if isinstance(subs, dict) and isinstance(subs.get('segments'), list):
        segs = []
        for i, s in enumerate(subs['segments']):
            s = dict(s)
            s['id'] = str(s.get('id') or f's{i + 1}')
            segs.append(s)
        norm['subtitles'] = {**subs, 'segments': segs}
    for key in ('texts', 'graphics'):
        if isinstance(norm.get(key), list):
            norm[key] = [{**dict(x), 'id': str(x.get('id') or f'{key[0]}{i + 1}')}
                         for i, x in enumerate(norm[key])]

    # 片头/片尾是"加时间"：片头把整条片子后移，片尾再往后延。
    # 配方里存的是"相对正片"的时间，界面要的是绝对时间，两者不能混。
    intro_dur = float((norm.get('intro') or {}).get('dur') or 0) if isinstance(norm.get('intro'), dict) else 0.0
    outro_dur = float((norm.get('outro') or {}).get('dur') or 0) if isinstance(norm.get('outro'), dict) else 0.0
    shift = intro_dur

    body_end = max([
        c['target'] + (c['end'] - c['start']) / max(0.25, min(4.0, float(c.get('speed') or 1.0)))
        for c in clips_out
    ] + [0.0])
    sub_end = 0.0
    for s in (norm.get('subtitles') or {}).get('segments') or []:
        try:
            sub_end = max(sub_end, float(s.get('end') or 0))
        except (TypeError, ValueError):
            pass
    text_end = 0.0
    for t in norm.get('texts') or []:
        try:
            text_end = max(text_end, float(t.get('end') or 0))
        except (TypeError, ValueError):
            pass

    timeline = {
        'intro': {'dur': round(intro_dur, 3)},
        'outro': {'dur': round(outro_dur, 3)},
        'clips': [
            {**{k: c.get(k) for k in ('id', 'source', 'pip', 'speed', 'keyframes')},
             'start': c['start'], 'end': c['end'],
             'target': round(c['target'] + shift, 3),
             'duration': round((c['end'] - c['start']) / max(0.25, min(4.0, float(c.get('speed') or 1.0))), 3),
             'source_duration': round(c['end'] - c['start'], 3)}
            for c in clips_out
        ],
        'subtitles': [
            # raw/label 是模板的图形层标记（ASS 矢量绘制），前端要按 label 显示而不是绘图指令
            {**{k: s.get(k) for k in ('id', 'text', 'style', 'raw', 'label', 'bar')},
             'start': round(float(s.get('start') or 0) + shift, 3),
             'end': round(float(s.get('end') or 0) + shift, 3)}
            for s in (norm.get('subtitles') or {}).get('segments') or []
        ],
        'texts': [
            {**{k: t.get(k) for k in ('id', 'text', 'style', 'font', 'x_ratio', 'y_ratio', 'font_size', 'max_width', 'intro')},
             'start': round(float(t.get('start') or 0) + shift, 3),
             'end': round(float(t.get('end') or 0) + shift, 3)}
            for t in norm.get('texts') or []
        ],
        'graphics': [
            {**{k: g.get(k) for k in ('id', 'type')},
             'at': round(float(g.get('at') or 0) + shift, 3)}
            for g in norm.get('graphics') or []
        ],
        'duration': round(max(body_end + shift, sub_end + shift, text_end + shift) + outro_dur, 3),
    }
    return norm, warnings, timeline['duration'], timeline


@xcy_bp.post('/xcy/recipe_normalize')
def xcy_recipe_normalize():
    """配方规整：补 id/target、夹越界、跳过空段，返回 warnings 与总时长。

    前端只负责显示，所有时间计算以这里为准，避免"界面 6 秒、成片 5.9 秒"。
    """
    data = request.get_json(force=True, silent=True) or {}
    recipe = data.get('recipe')
    if not isinstance(recipe, dict):
        return jsonify({'success': False, 'error': '缺 recipe 对象'}), 400
    base = Path(str(data.get('base_dir') or os.getcwd()))
    try:
        norm, warnings, duration, timeline = _norm_recipe(recipe, base)
    except Exception as exc:  # noqa: BLE001
        return jsonify({'success': False, 'error': f'规整失败：{exc}'}), 500
    return jsonify({'success': True, 'recipe': norm, 'warnings': warnings,
                    'duration': duration, 'timeline': timeline})


@xcy_bp.post('/xcy/proxy')
def xcy_proxy():
    """生成/复用 540p 预览代理片。按 路径+mtime+size+高度 缓存，源没变就不重转。"""
    import xcy_render

    data = request.get_json(force=True, silent=True) or {}
    base = Path(str(data.get('base_dir') or os.getcwd()))
    src = xcy_render.resolve(str(data.get('path') or ''), base)
    if not os.path.exists(src):
        return jsonify({'success': False, 'error': f'素材不存在：{src}'}), 400
    height = int(data.get('height') or 540)
    height = max(240, min(1080, height))

    key = hashlib.sha1(_source_signature(src).encode('utf8') + f'|h{height}'.encode('utf8')).hexdigest()[:16]
    out = PROXY_DIR / f'px_{key}.mp4'
    cached = out.exists() and out.stat().st_mtime >= os.path.getmtime(src) and out.stat().st_size > 0

    if not cached:
        PROXY_DIR.mkdir(parents=True, exist_ok=True)
        tmp = PROXY_DIR / f'.tmp_{key}.mp4'
        cmd = [
            xcy_render.FFMPEG, '-y', '-i', src,
            '-vf', f'scale=-2:{height}:flags=lanczos',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
            '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart', str(tmp),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
        except subprocess.TimeoutExpired:
            return jsonify({'success': False, 'error': '代理片生成超时（>15 分钟）'}), 504
        if proc.returncode != 0 or not tmp.exists() or tmp.stat().st_size == 0:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            return jsonify({'success': False, 'error': f'转码失败：{proc.stderr.strip()[-300:]}'}), 500
        os.replace(tmp, out)

    info = {}
    try:
        info = _probe_cached(str(out))
    except Exception:  # noqa: BLE001
        pass
    return jsonify({
        'success': True, 'path': str(out), 'cached': cached,
        'source': src, 'height': height,
        'duration': info.get('duration'), 'width': info.get('width'),
    })

@xcy_bp.post('/xcy/cache_clean')
def cache_clean():
    """清代理片/预览缓存：超期或超总量时按最旧删。"""
    import shutil
    from pathlib import Path

    data = request.get_json(force=True, silent=True) or {}
    max_gb = float(data.get('max_gb') or 2)
    max_age_days = float(data.get('max_age_days') or 7)
    dry_run = bool(data.get('dry_run'))
    root = Path(os.path.expanduser('~/.xiaocongcut/cache'))
    if not root.exists():
        return jsonify({'success': True, 'removed': 0, 'freed': 0, 'files': []})

    now = __import__('time').time()
    files = []
    total = 0
    for f in root.rglob('*'):
        if not f.is_file() or f.name.startswith('.'):
            continue
        st = f.stat()
        files.append((st.st_mtime, st.st_size, f))
        total += st.st_size

    victims = []
    for mt, sz, f in files:
        if max_age_days > 0 and (now - mt) > max_age_days * 86400:
            victims.append(f)
    remain = total - sum(f.stat().st_size for f in victims)
    limit = int(max_gb * 1024 ** 3)
    if max_gb > 0 and remain > limit:
        for mt, sz, f in sorted(files):
            if f in victims:
                continue
            victims.append(f)
            remain -= sz
            if remain <= limit:
                break

    freed = 0
    paths = []
    for f in victims:
        try:
            sz = f.stat().st_size
            if not dry_run:
                f.unlink()
            freed += sz
            paths.append(str(f))
        except OSError:
            continue
    return jsonify({'success': True, 'dry_run': dry_run, 'removed': len(paths), 'freed': freed, 'files': paths[:50]})

def _trim_recipe_range(norm: dict, timeline: dict, t0: float, t1: float) -> dict:
    """把整条配方裁成 [t0,t1] 的预览配方（绝对时间 → 新区间从 0 开始）。"""
    shift = float(((timeline.get('intro') or {}).get('dur')) or 0)
    span = max(0.1, t1 - t0)
    out = dict(norm)
    out['intro'] = {}
    out['outro'] = {}

    clips = []
    cursor = 0.0
    for c in norm.get('clips') or []:
        speed = max(0.25, min(4.0, float(c.get('speed') or 1.0)))
        abs0 = float(c.get('target') or 0) + shift
        dur = (float(c.get('end') or 0) - float(c.get('start') or 0)) / speed
        abs1 = abs0 + dur
        os_, oe = max(t0, abs0), min(t1, abs1)
        if oe - os_ < 0.05:
            continue
        new_start = float(c.get('start') or 0) + (os_ - abs0) * speed
        new_end = float(c.get('start') or 0) + (oe - abs0) * speed
        clips.append({**c, 'start': round(new_start, 3), 'end': round(new_end, 3),
                      'target': round(cursor, 3)})
        cursor += (new_end - new_start) / speed
    out['clips'] = clips

    subs = []
    for sg in ((norm.get('subtitles') or {}).get('segments') or []):
        a0 = float(sg.get('start') or 0) + shift
        a1 = float(sg.get('end') or 0) + shift
        os_, oe = max(t0, a0), min(t1, a1)
        if oe - os_ < 0.05:
            continue
        subs.append({**sg, 'start': round(os_ - t0, 3), 'end': round(oe - t0, 3)})
    if isinstance(norm.get('subtitles'), dict):
        # 预览不跑字幕避脸（每句都要抠 0.6 秒人像，单次可多花十几秒）
        out['subtitles'] = {**norm['subtitles'], 'segments': subs, 'avoid_face': False}

    texts = []
    for tx in norm.get('texts') or []:
        a0 = float(tx.get('start') or 0) + shift
        a1 = float(tx.get('end') or 0) + shift
        os_, oe = max(t0, a0), min(t1, a1)
        if oe - os_ < 0.05:
            continue
        texts.append({**tx, 'start': round(os_ - t0, 3), 'end': round(oe - t0, 3)})
    out['texts'] = [{**t, 'avoid': ''} for t in texts]

    gra = []
    for g in norm.get('graphics') or []:
        at = float(g.get('at') or 0) + shift
        if t0 <= at < t1:
            gra.append({**g, 'at': round(at - t0, 3)})
    out['graphics'] = gra

    sfx = []
    for x in norm.get('sfx') or []:
        at = float(x.get('at') or 0) + shift
        if t0 <= at < t1:
            sfx.append({**x, 'at': round(at - t0, 3)})
    out['sfx'] = sfx
    return out


def _preview_spec(data: dict):
    """区间预览的公共准备：校验 → 裁区间 → 算缓存键。返回 (spec, err_response)。"""
    recipe = data.get('recipe')
    src_path = str(data.get('path') or '')
    base = Path(os.path.expanduser(str(data.get('base_dir') or (os.path.dirname(src_path) if src_path else str(Path(__file__).resolve().parent / 'recipes')))))
    if not isinstance(recipe, dict) and src_path:
        try:
            recipe = json.loads(Path(os.path.expanduser(src_path)).read_text(encoding='utf8'))
        except Exception as exc:  # noqa: BLE001
            return None, (jsonify({'success': False, 'error': f'配方读不了：{exc}'}), 400)
    if not isinstance(recipe, dict):
        return None, (jsonify({'success': False, 'error': '缺 recipe 或 path'}), 400)

    norm, warns, dur, timeline = _norm_recipe(recipe, base)
    try:
        t0 = max(0.0, float(data.get('start') or 0))
        t1 = min(float(dur), float(data.get('end') or dur))
    except (TypeError, ValueError):
        return None, (jsonify({'success': False, 'error': 'start/end 必须是秒数'}), 400)
    if t1 - t0 < 0.2:
        return None, (jsonify({'success': False, 'error': '区间太短（至少 0.2 秒）'}), 400)

    trimmed = _trim_recipe_range(norm, timeline, t0, t1)
    if not trimmed.get('clips'):
        return None, (jsonify({'success': False, 'error': '这个区间没有画面'}), 400)

    key = hashlib.sha1(
        (json.dumps(trimmed, ensure_ascii=False, sort_keys=True) + f'|{t0:.2f}-{t1:.2f}').encode('utf8')
    ).hexdigest()[:16]
    root = Path(os.path.expanduser('~/.xiaocongcut/cache/preview'))
    root.mkdir(parents=True, exist_ok=True)
    out = root / f'range_{key}.mp4'
    cached = out.exists() and out.stat().st_size > 0
    return {'trimmed': trimmed, 't0': t0, 't1': t1, 'out': out, 'cached': cached,
            'base': base, 'warns': warns}, None


@xcy_bp.post('/xcy/render_preview')
def render_preview_range():
    """区间预览（同步）：把 [start,end] 裁出来，用 540p 快速渲染，几秒看到改动。"""
    import xcy_render

    data = request.get_json(force=True, silent=True) or {}
    spec, err = _preview_spec(data)
    if err:
        return err
    trimmed, t0, t1, out, cached = spec['trimmed'], spec['t0'], spec['t1'], spec['out'], spec['cached']
    base, warns = spec['base'], spec['warns']
    if not cached:
        try:
            xcy_render.render_recipe(trimmed, str(out), base, preset='preview', hardware=False)
        except Exception as exc:  # noqa: BLE001
            return jsonify({'success': False, 'error': f'区间预览失败：{exc}'}), 500

    info = {}
    try:
        info = _probe_cached(str(out))
    except Exception:  # noqa: BLE001
        pass
    return jsonify({
        'success': True, 'out': str(out), 'cached': cached,
        'start': round(t0, 3), 'end': round(t1, 3),
        'duration': info.get('duration') or round(t1 - t0, 3),
        'width': info.get('width'), 'height': info.get('height'),
        'warnings': warns,
    })


# 异步区间预览：同一时刻只跑一个预览 ffmpeg；新请求会把排队/运行中的旧预览取消，
# 避免连点几个区间时串行排队卡住。状态/取消复用 /xcy/render/<task_id>。
PREVIEW_SEM = threading.Semaphore(1)


def _preview_worker(task_id: str, trimmed: dict, out: str, base: str) -> None:
    import xcy_render

    cancel = RENDER_CANCEL[task_id]
    job = RENDER_JOBS[task_id]
    try:
        job['status'] = 'running'
        job['message'] = '等待渲染槽位'
        with PREVIEW_SEM:
            if cancel.is_set():
                raise RuntimeError('已取消')
            job['message'] = '渲染中'
            job['started_at'] = time.strftime('%Y-%m-%dT%H:%M:%S')

            def progress(p: float) -> None:
                job['progress'] = round(p * 100, 1)
                job['message'] = f'渲染中 {job["progress"]}%'

            result = xcy_render.render_recipe(
                trimmed, str(out), base, preset='preview', hardware=False,
                on_progress=progress, cancel_flag=cancel,
            )
        job.update(result)
        job['status'] = 'done'
        job['progress'] = 100
        job['message'] = '完成'
    except Exception as exc:  # noqa: BLE001
        job['status'] = 'cancelled' if cancel.is_set() else 'error'
        job['error'] = str(exc)
        job['message'] = '已取消' if cancel.is_set() else f'渲染失败：{exc}'
    finally:
        job['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%S')


@xcy_bp.post('/xcy/render_preview_async')
def render_preview_async():
    """区间预览（异步）：命中缓存直接返回 out；否则返回 task_id，轮询 /xcy/render/<id>。"""
    data = request.get_json(force=True, silent=True) or {}
    spec, err = _preview_spec(data)
    if err:
        return err
    t0, t1, out, cached = spec['t0'], spec['t1'], spec['out'], spec['cached']
    if cached:
        info = {}
        try:
            info = _probe_cached(str(out))
        except Exception:  # noqa: BLE001
            pass
        return jsonify({
            'success': True, 'cached': True, 'task_id': None, 'out': str(out),
            'start': round(t0, 3), 'end': round(t1, 3),
            'duration': info.get('duration') or round(t1 - t0, 3),
            'width': info.get('width'), 'height': info.get('height'),
            'warnings': spec['warns'],
        })

    task_id = 'prv_' + uuid.uuid4().hex[:12]
    with RENDER_LOCK:
        # 只保留最近 30 个预览任务记录，防止长跑内存涨
        finished = [tid for tid, j in RENDER_JOBS.items()
                    if j.get('kind') == 'preview' and j.get('status') in ('done', 'error', 'cancelled')]
        for tid in finished[:-30]:
            RENDER_JOBS.pop(tid, None)
            RENDER_CANCEL.pop(tid, None)
        # 最新请求优先：取消其它排队/运行中的预览
        for tid, j in RENDER_JOBS.items():
            if j.get('kind') == 'preview' and j.get('status') in ('queued', 'running'):
                flag = RENDER_CANCEL.get(tid)
                if flag:
                    flag.set()
        RENDER_JOBS[task_id] = {
            'task_id': task_id, 'kind': 'preview', 'status': 'queued', 'progress': 0,
            'message': '排队中', 'out': str(out), 'preset': 'preview', 'qc': False,
            'start': round(t0, 3), 'end': round(t1, 3),
            'queued_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
        }
        RENDER_CANCEL[task_id] = threading.Event()

    threading.Thread(
        target=_preview_worker,
        args=(task_id, spec['trimmed'], str(out), str(spec['base'])),
        daemon=True,
    ).start()
    return jsonify({'success': True, 'cached': False, 'task_id': task_id, 'out': str(out),
                    'start': round(t0, 3), 'end': round(t1, 3), 'status': 'queued'})


# ─────────────────── 预览实时抠像分层：人像 alpha → webm（浏览器可播） ───────────────────
_MATTE_WEBM_DIR = Path(os.environ.get('XCY_CACHE', str(Path.home() / '.xiaocongcut' / 'cache'))) / 'matte-webm'


def _matte_webm_path(key: str) -> Path:
    _MATTE_WEBM_DIR.mkdir(parents=True, exist_ok=True)
    return _MATTE_WEBM_DIR / f'{key}.webm'


@xcy_bp.post('/xcy/matte_webm')
def matte_webm():
    """src → alpha mov（抠像缓存）→ vp9 alpha webm（浏览器 video 可直接叠加）。
    返回 {ok, url, name}；url 是 9001 的静态路径，经 3080 插件代理后给前端。"""
    d = request.get_json(force=True, silent=True) or {}
    src = str(d.get('src') or '').strip()
    if not src or not os.path.exists(src):
        return jsonify({'ok': False, 'error': f'素材不存在：{src}'}), 400
    try:
        import xcy_matte
        start = float(d['start']) if d.get('start') not in (None, '') else None
        end = float(d['end']) if d.get('end') not in (None, '') else None
        mov = xcy_matte.alpha_cache(src, start=start, end=end)
        key = hashlib.sha1(f'{mov}|{start}|{end}'.encode()).hexdigest()[:16]
        webm = _matte_webm_path(key)
        if not webm.exists():
            # -reserve_index_space: 在文件头预留 cues 空间，Chrome 无需 range 即可 seek
            # （否则 cues 在尾部、非 range 响应时 video.seekable 为空，预览无法跟主视频同步）
            subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', mov,
                            '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
                            '-b:v', '0', '-crf', '30', '-an',
                            '-reserve_index_space', '1024', str(webm)], check=True)
        return jsonify({'ok': True, 'name': f'{key}.webm',
                        'url': f'/xcy/matte_file/{key}.webm', 'bytes': webm.stat().st_size})
    except Exception as e:  # noqa: BLE001
        return jsonify({'ok': False, 'error': f'抠像生成失败：{e}'}), 500


@xcy_bp.get('/xcy/matte_file/<name>')
def matte_file(name: str):
    import re as _re
    if not _re.fullmatch(r'[0-9a-f]{16}\.webm', name):
        return jsonify({'error': 'bad name'}), 404
    p = _matte_webm_path(name[:16])
    if not p.exists():
        return jsonify({'error': 'not found'}), 404
    return send_file(str(p), mimetype='video/webm', conditional=True)


@xcy_bp.post('/xcy/trendy_koubo')
def xcy_trendy_koubo():
    """网感口播一键编译并提交渲染（高级红 / 黑金杂志 / 极简白青）。"""
    import re as _re
    d = request.get_json(force=True, silent=True) or {}
    try:
        import xcy_trendy as T
        recipe = T.build_trendy_recipe(d)
        project_path = T.save_trendy_project(recipe) if d.get('save_project', True) is not False else ''
        jianying_draft = None
        if d.get('export_jianying_draft', True) is not False:
            jianying_draft = T.export_trendy_jianying_draft(
                recipe,
                draft_folder=d.get('draft_folder'),
                project_name=d.get('name') or recipe.get('name'),
            )
        if d.get('dry_run') is True:
            return jsonify({
                'success': True,
                'dry_run': True,
                'recipe': recipe,
                'project_path': project_path,
                'jianying_draft': jianying_draft,
            })
        if d.get('render_mp4', True) is False:
            ok_draft = bool(jianying_draft and jianying_draft.get('ok'))
            return jsonify({
                'success': ok_draft,
                'status': 'done' if ok_draft else 'error',
                'render_mp4': False,
                'theme': recipe.get('theme'),
                'project_path': project_path,
                'jianying_draft': jianying_draft,
                'error': '' if ok_draft else ((jianying_draft or {}).get('error') or '仅导出剪映草稿失败'),
            }), (200 if ok_draft else 500)
        out = str(d.get('out') or '').strip()
        preset = str(d.get('preset') or 'final')
        if not out:
            out_dir = Path.home() / 'Movies' / 'xcy-out'
            out_dir.mkdir(parents=True, exist_ok=True)
            safe_name = _re.sub(r'[^0-9A-Za-z\u4e00-\u9fff_-]+', '_', str(recipe.get('name') or 'trendy')).strip('_')[:32] or 'trendy'
            out = str(out_dir / f'{safe_name}_{int(time.time())}.mp4')
        task_id = uuid.uuid4().hex[:12]
        with RENDER_LOCK:
            RENDER_JOBS[task_id] = {
                'task_id': task_id,
                'status': 'queued',
                'progress': 0,
                'stage': '排队中',
                'message': f'网感口播（{recipe.get("theme")}）',
                'out': out,
                'preset': preset,
                'qc': True,
                'project_path': project_path,
                'jianying_draft': jianying_draft,
                'queued_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
            }
            RENDER_CANCEL[task_id] = threading.Event()
        threading.Thread(
            target=_render_worker,
            args=(task_id, recipe, out, str(Path(project_path).parent if project_path else Path.cwd()), preset, True),
            daemon=True,
        ).start()
        return jsonify({
            'success': True,
            'task_id': task_id,
            'status': 'queued',
            'out': out,
            'theme': recipe.get('theme'),
            'project_path': project_path,
            'jianying_draft': jianying_draft,
        })
    except FileNotFoundError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:  # noqa: BLE001
        return jsonify({'success': False, 'error': f'网感口播构建失败：{e}'}), 500
