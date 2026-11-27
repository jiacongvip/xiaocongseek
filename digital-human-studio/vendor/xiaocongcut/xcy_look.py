"""xcy_look.py —— 画面层：轻调色（LUT）、白平衡、背景虚化

三个都只作用于**素材画面**，不碰字幕和花字（字幕是信息层，跟着调色会变脏）。

LUT 不引第三方 .cube 文件：三个内置风格在代码里生成，强度直接烘焙进 LUT
（identity 与风格之间线性插值），所以 `strength=0.8` 就是"八成"，不用 blend 滤镜两条流。

用法
----
    import xcy_look as L
    path = L.lut_path('warm_soft', 0.8)          # 生成/复用 .cube
    chain = L.wb_chain(L.auto_white_balance(src)) # 自动白平衡
    bg = L.bg_chain(12, 0.25)                     # 背景虚化 + 压暗
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
from pathlib import Path

LUT_DIR = Path(os.environ.get('XCY_LUT_DIR') or (Path(__file__).resolve().parent / 'assets' / 'luts'))
FFMPEG = os.environ.get('XCY_FFMPEG') or shutil.which('ffmpeg') or 'ffmpeg'
LUT_SIZE = 17


def _clamp(v: float) -> float:
    return 0.0 if v < 0 else (1.0 if v > 1 else v)


def _warm_soft(r: float, g: float, b: float) -> tuple:
    """暖调：抬一点暗部、红多蓝少，肤色偏暖不发橙。"""
    r = _clamp(r ** 0.97 * 1.05 + 0.02)
    g = _clamp(g ** 0.98 * 1.01 + 0.015)
    b = _clamp(b ** 0.99 * 0.96 + 0.01)
    return r, g, b


def _clean_cool(r: float, g: float, b: float) -> tuple:
    """干净冷调：提对比、压黑位、蓝多一点，适合白墙办公室。"""
    def c(v: float) -> float:
        v = (v - 0.012) / 0.976          # 压黑位
        v = 0.5 + (v - 0.5) * 1.07       # 加对比
        return _clamp(v)
    return _clamp(c(r) * 0.99), c(g), _clamp(c(b) * 1.03)


def _film_soft(r: float, g: float, b: float) -> tuple:
    """胶片感：暗部抬起、高光滚降、暖高光冷暗部分离。"""
    def base(v: float) -> float:
        v = v * 0.95 + 0.045
        if v > 0.8:
            v = 0.8 + (v - 0.8) * 0.82
        return _clamp(v)
    lum = 0.30 * r + 0.59 * g + 0.11 * b
    return (_clamp(base(r) + 0.018 * lum),
            _clamp(base(g)),
            _clamp(base(b) + 0.018 * (1 - lum)))


PRESETS = {
    'none': ('原片', None),
    'warm_soft': ('暖调柔光', _warm_soft),
    'clean_cool': ('干净冷调', _clean_cool),
    'film_soft': ('胶片柔调', _film_soft),
}


def preset_list() -> list[dict]:
    return [{'id': k, 'label': v[0], 'builtin': True} for k, v in PRESETS.items()]


def _cube_text(name: str, strength: float) -> str:
    fn = PRESETS.get(name, PRESETS['none'])[1]
    s = max(0.0, min(1.0, float(strength)))
    lines = [
        f'TITLE "{name} @{s:.2f}"',
        f'LUT_3D_SIZE {LUT_SIZE}',
        'DOMAIN_MIN 0.0 0.0 0.0',
        'DOMAIN_MAX 1.0 1.0 1.0',
        '',
    ]
    step = 1.0 / (LUT_SIZE - 1)
    for bi in range(LUT_SIZE):
        b = bi * step
        for gi in range(LUT_SIZE):
            g = gi * step
            for ri in range(LUT_SIZE):
                r = ri * step
                if fn is None:
                    nr, ng, nb = r, g, b
                else:
                    tr, tg, tb = fn(r, g, b)
                    nr, ng, nb = (r + (tr - r) * s, g + (tg - g) * s, b + (tb - b) * s)
                lines.append(f'{nr:.6f} {ng:.6f} {nb:.6f}')
    return '\n'.join(lines) + '\n'


def lut_path(name: str = 'warm_soft', strength: float = 0.8) -> str:
    """按「风格 + 强度」生成/复用 .cube。强度量化到 0.05，避免缓存爆炸。"""
    key = str(name or 'none')
    if key in ('', 'none', 'off'):
        return ''
    s = round(max(0.05, min(1.0, float(strength))) * 20) / 20
    LUT_DIR.mkdir(parents=True, exist_ok=True)
    tag = hashlib.sha1(f'{key}|{s}|{LUT_SIZE}'.encode()).hexdigest()[:8]
    out = LUT_DIR / f'{key}_{int(s * 100):03d}_{tag}.cube'
    if not out.exists():
        out.write_text(_cube_text(key, s), encoding='utf8')
    return str(out)


def esc_filter_path(path: str) -> str:
    return str(path).replace('\\', '\\\\').replace(':', '\\:').replace("'", "\\'")


def look_chain(lut: str | None = None, strength: float = 0.8) -> str:
    """调色链（不含白平衡）。`none`/空 返回空串。"""
    path = lut_path(lut or 'none', strength)
    if not path:
        return ''
    return f",lut3d=file='{esc_filter_path(path)}'"


# ───────────────────────────── 白平衡 ─────────────────────────────

def auto_white_balance(video: str, samples: int = 5) -> dict:
    """灰度世界假设算增益：RGB 均值不相等就说明有色偏。

    返回 {'gains': {'r','g','b'}, 'means': {...}}；失败返回中性增益（全 1.0）。
    """
    neutral = {'gains': {'r': 1.0, 'g': 1.0, 'b': 1.0}, 'means': {}}
    try:
        from PIL import Image
        import numpy as np
        import tempfile

        dur = _probe_duration(video)
        if dur <= 0.2:
            return neutral
        tmp = Path(tempfile.mkdtemp(prefix='xcy-wb-'))
        acc = None
        n = 0
        try:
            for i in range(max(1, samples)):
                t = max(0.05, dur * (i + 0.5) / samples)
                out = tmp / f'{i}.png'
                subprocess.run(
                    [FFMPEG, '-y', '-v', 'error', '-ss', f'{t:.2f}', '-i', video,
                     '-frames:v', '1', '-vf', 'scale=160:-2', str(out)],
                    check=True, timeout=60,
                )
                if not out.exists():
                    continue
                arr = np.asarray(Image.open(out).convert('RGB'), dtype=np.float32)
                mean = arr.reshape(-1, 3).mean(axis=0)
                acc = mean if acc is None else acc + mean
                n += 1
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        if acc is None or n == 0:      # 注意：numpy 数组不能用 `not acc`（会抛歧义异常）
            return neutral
        means = (acc / n)
        gray = float(means.mean())
        gains = {}
        for key, val in zip(('r', 'g', 'b'), means):
            g = gray / max(1e-3, float(val))
            gains[key] = round(max(0.9, min(1.1, g)), 4)
        return {'gains': gains, 'means': {k: round(float(v), 1) for k, v in zip(('r', 'g', 'b'), means)}}
    except Exception:  # noqa: BLE001
        return neutral


def wb_chain(gains: dict | None) -> str:
    """白平衡链：对角线增益，不改通道混合。"""
    g = (gains or {}).get('gains') if isinstance(gains, dict) and 'gains' in gains else gains
    if not isinstance(g, dict):
        return ''
    try:
        r, gg, b = float(g.get('r', 1.0)), float(g.get('g', 1.0)), float(g.get('b', 1.0))
    except (TypeError, ValueError):
        return ''
    if abs(r - 1) < 0.005 and abs(gg - 1) < 0.005 and abs(b - 1) < 0.005:
        return ''
    return f',colorchannelmixer=rr={r:.4f}:gg={gg:.4f}:bb={b:.4f}'


# ───────────────────────────── 背景虚化 ─────────────────────────────

def bg_chain(sigma: float = 0, dim: float = 0.0) -> str:
    """背景虚化 + 压暗。sigma<0.5 且 dim≈0 时返回空串。"""
    try:
        s = float(sigma or 0)
        d = float(dim or 0)
    except (TypeError, ValueError):
        return ''
    parts = []
    if s >= 0.5:
        # steps 少一点，速度快，糊得也更像"景深"而不是"雾"
        parts.append(f'gblur=sigma={s:.1f}:steps=3')
    if abs(d) > 0.005:
        parts.append(f'eq=brightness=-{abs(d):.3f}:saturation=0.96')
    return (',' + ','.join(parts)) if parts else ''


def _probe_duration(path: str) -> float:
    try:
        out = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
            capture_output=True, text=True, timeout=20,
        )
        return float((out.stdout or '0').strip() or 0)
    except Exception:  # noqa: BLE001
        return 0.0
