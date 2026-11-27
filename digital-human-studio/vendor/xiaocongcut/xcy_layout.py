"""xcy_layout.py —— 花字落位（主体避让）

问题：花字固定放画面中心，人脸正好在中心，字被挡掉大半。
做法：拿人像 alpha（person_alpha 的产物），按行统计"这一行有多少像素是人"，
     找一条最空的水平带放字。

两个约束：
1. **片段内稳定**：取多帧平均，不是逐帧算，否则字会上下跳。
2. **不压字幕**：底部留给字幕，安全区可调。
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

CACHE_ROOT = Path(os.environ.get('XCY_CACHE', str(Path.home() / '.xiaocongcut' / 'cache')))
LAYOUT_DIR = CACHE_ROOT / 'layout'
FFMPEG = os.environ.get('XCY_FFMPEG') or shutil.which('ffmpeg') or 'ffmpeg'

# 安全区内边距（画布比例）：上留 8%，下留 22%（给字幕）
SAFE_TOP = 0.08
SAFE_BOTTOM = 0.78
MARGIN = 0.02           # 花字上下额外留白
FREE_ENOUGH = 0.15      # 人像占比低于这个就算"压不着字"
CROWDED = 0.45          # 最空的带子人像仍超过这个比例，就认为"没地方放"
HEAD_FALLBACK_H = 0.22  # 估不出脖子时，按画面高度 22% 估头高
HEAD_MAX_H = 0.30       # 头高上限（再大就是估错了）


def _cache_key(alpha_path: str, samples: int) -> str:
    st = os.stat(alpha_path)
    raw = f'{alpha_path}|{st.st_mtime_ns}|{st.st_size}|{samples}'
    return hashlib.sha1(raw.encode('utf8')).hexdigest()[:16]


def row_coverage(alpha_path: str, samples: int = 6) -> np.ndarray:
    """返回每一行"人像像素占比"（0–1），长度 = 画面高度。

    samples 是抽帧数。取平均而不是逐帧，避免字跟着人抖。
    """
    LAYOUT_DIR.mkdir(parents=True, exist_ok=True)
    cache = LAYOUT_DIR / f'{_cache_key(alpha_path, samples)}.json'
    if cache.exists():
        return np.array(json.loads(cache.read_text(encoding='utf8'))['rows'], dtype=np.float32)

    tmp = Path(tempfile.mkdtemp(prefix='xcy-layout-'))
    try:
        subprocess.run(
            [FFMPEG, '-y', '-v', 'error', '-ss', '0.2', '-i', alpha_path,
             '-vf', 'fps=2,format=rgba', '-frames:v', str(max(2, samples)),
             str(tmp / '%03d.png')],
            check=True, timeout=180,
        )
        files = sorted(tmp.glob('*.png'))
        if not files:
            raise RuntimeError(f'抽帧失败：{alpha_path}')
        acc = None
        for f in files:
            arr = np.asarray(Image.open(f).convert('RGBA'))
            mask = arr[:, :, 3] > 128
            rows = mask.mean(axis=1).astype(np.float32)
            acc = rows if acc is None else acc + rows
        rows = (acc / len(files)).round(5)
        cache.write_text(json.dumps({'rows': rows.tolist(), 'samples': len(files)}), encoding='utf8')
        return rows
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def choose_band(rows: np.ndarray, text_height: int, canvas_h: int,
                prefer: str = 'auto') -> dict:
    """在同一条最空的水平带里放字。

    返回 {y_center, coverage, crowded}；y_center 是画布像素坐标。
    没有可放的位置时返回 crowded=True，调用方走兜底（人像上方）。
    """
    text_height = max(8, int(text_height))
    margin = int(canvas_h * MARGIN)
    win = text_height + margin * 2
    top = int(canvas_h * SAFE_TOP)
    bottom = int(canvas_h * SAFE_BOTTOM)

    # 方案 A（首选）：直接贴在人像头顶上方。口播花字放这里是行业惯例，
    # 比"全画面最空"更贴人，也不会有压头发的风险。
    heads = np.where(rows > 0.02)[0]
    head = int(heads[0]) if len(heads) else 0
    gap = max(8, int(canvas_h * 0.012))
    if head and (head - gap - text_height) >= top:
        return {
            'y_center': int(head - gap - text_height / 2),
            'coverage': 0.0,
            'band': [int(head - gap - text_height), int(head - gap)],
            'crowded': False,
            'mode': 'above_head',
        }

    # 方案 B：人像几乎占满画面时，退回"找最空的带子"
    cands = []
    y = top
    while y + win <= bottom:
        cands.append((float(rows[y:y + win].mean()), y))
        y += max(4, int(canvas_h * 0.01))

    if not cands:
        return {'y_center': canvas_h // 2, 'coverage': 1.0, 'crowded': True}

    # 先挑"基本不压人"的位置（覆盖率 ≤ FREE_ENOUGH），在这些位置里取最低的一条 ——
    # 贴着人像上沿，比取"全画面最空"更自然（最空的通常在画面最顶上，离人太远）。
    free = [c for c in cands if c[0] <= FREE_ENOUGH]
    pref = {'top': 0.0, 'center': 0.5, 'lower_third': 0.66}.get(prefer)
    if free:
        if pref is not None:
            score, y0 = min(free, key=lambda c: abs((c[1] + win / 2) / canvas_h - pref))
        else:
            score, y0 = max(free, key=lambda c: c[1])
    else:
        score, y0 = min(cands, key=lambda c: c[0])
    crowded = score > CROWDED
    return {
        'y_center': y0 + win // 2,
        'coverage': round(score, 3),
        'band': [y0, y0 + win],
        'crowded': crowded,
    }


def head_top(rows: np.ndarray, canvas_h: int) -> int | None:
    """人像最上面一行（用来做兜底：字放到头顶上方）。"""
    idx = np.where(rows > 0.02)[0]
    if len(idx) == 0:
        return None
    return int(idx[0])


def head_band(alpha_path: str, samples: int = 3) -> dict | None:
    """人像"头部"占画面哪一段（返回比例，0–1）。

    字幕避脸要用：字幕带压到头上就把字幕抬到头顶上方。
    怎么找头：从人像最上一行往下走，宽度（= 行占比）先变宽（脸）再收窄（脖子），
    第一次明显收窄的位置就是脖子。头发盖住脖子时收窄不明显，退回"头高 22%"。
    """
    rows = row_coverage(alpha_path, samples=samples)
    h = int(len(rows))
    if h <= 0:
        return None
    idx = np.where(rows > 0.02)[0]
    if len(idx) == 0:
        return None
    top = int(idx[0])

    peak = 0.0
    neck = None
    for y in range(top, min(h, top + int(h * 0.45))):
        v = float(rows[y])
        if v > peak:
            peak = v
        elif peak > 0.04 and v < peak * 0.62 and (y - top) > h * 0.06:
            neck = y
            break

    bottom = neck if (neck and neck - top > h * 0.12) else top + int(h * HEAD_FALLBACK_H)
    # 头不可能占到画面的 30% 以上；超了说明脖子没找对（抬手、低头、头发盖肩），
    # 直接夹住，否则字幕会被莫名其妙地推到天花板上去。
    bottom = int(min(bottom, top + h * HEAD_MAX_H))
    bottom = int(min(h, max(bottom, top + h * 0.10)))
    return {
        'top': round(top / h, 4),
        'bottom': round(bottom / h, 4),
        'height': round((bottom - top) / h, 4),
        'pixels': {'top': top, 'bottom': bottom},
        'alpha_h': h,
    }


def placement(alpha_path: str, text_height: int, canvas_h: int,
              prefer: str = 'auto', samples: int = 6) -> dict:
    """一步到位：算行覆盖率 → 选带 → 兜底。

    兜底逻辑：如果整条画面都被人占（比如大特写），把字放到人像头顶上方；
    上方也不够就退回画面中心偏上。
    """
    rows = row_coverage(alpha_path, samples=samples)
    picked = choose_band(rows, text_height, canvas_h, prefer=prefer)
    if not picked['crowded']:
        picked.setdefault('mode', 'band')
        return picked

    head = head_top(rows, canvas_h)
    margin = int(canvas_h * MARGIN * 2)
    if head is not None:
        y_center = head - margin - text_height // 2
        if y_center - text_height // 2 >= int(canvas_h * 0.03):
            return {'y_center': int(y_center), 'coverage': picked['coverage'],
                    'mode': 'above_head', 'crowded': True, 'band': picked.get('band')}

    return {'y_center': int(canvas_h * 0.22), 'coverage': picked['coverage'],
            'mode': 'fallback_top', 'crowded': True, 'band': picked.get('band')}
