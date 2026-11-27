"""xcy_qc.py —— 成片质检

渲染完不等于能发。这里把"人眼要扫一遍"的几件事自动查了：
黑帧、长时间静音、响度偏离、时长对不上、分辨率不对。

判定只有三档：
    pass  可以发
    warn  能发，但建议看一眼（有短黑场 / 某段偏轻）
    fail  别发（大段黑屏、没有声音、时长短一大截）

用法：
    from xcy_qc import qc
    r = qc('/path/out.mp4', expected_duration=8.6)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess

FFMPEG = os.environ.get('XCY_FFMPEG') or shutil.which('ffmpeg') or 'ffmpeg'
FFPROBE = os.environ.get('XCY_FFPROBE') or shutil.which('ffprobe') or 'ffprobe'

# 阈值集中放这里，别散在代码里
BLACK_MIN = 0.4        # 单段黑屏超过这个秒数才报
BLACK_FAIL = 2.0       # 超过这个秒数判 fail
SILENCE_MIN = 2.0      # 单段静音超过这个秒数才报
SILENCE_FAIL = 8.0
LUFS_MIN, LUFS_MAX = -24.0, -8.0
LUFS_TARGET = -14.0
DURATION_TOLERANCE = 0.6
DURATION_FAIL = 2.0


def _probe(path: str) -> dict:
    out = subprocess.run(
        [FFPROBE, '-v', 'error', '-show_entries',
         'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,channels',
         '-of', 'json', path],
        capture_output=True, text=True, timeout=60,
    )
    data = json.loads(out.stdout or '{}')
    streams = data.get('streams') or []
    video = next((s for s in streams if s.get('codec_type') == 'video'), {})
    audio = next((s for s in streams if s.get('codec_type') == 'audio'), {})
    return {
        'duration': float((data.get('format') or {}).get('duration') or 0),
        'size_mb': round(float((data.get('format') or {}).get('size') or 0) / 1024 / 1024, 1),
        'width': int(video.get('width') or 0),
        'height': int(video.get('height') or 0),
        'fps': video.get('r_frame_rate') or '',
        'video_codec': video.get('codec_name') or '',
        'audio_codec': audio.get('codec_name') or '',
        'channels': int(audio.get('channels') or 0),
    }


def _analyse(path: str) -> dict:
    """一次解码，同时拿到黑帧、静音、响度。"""
    cmd = [
        FFMPEG, '-hide_banner', '-nostats', '-i', path,
        '-vf', f'blackdetect=d={BLACK_MIN}:pix_th=0.10',
        '-af', f'silencedetect=n=-45dB:d={SILENCE_MIN},loudnorm=print_format=json',
        '-f', 'null', '-',
    ]
    run = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    err = run.stderr or ''

    black = []
    for m in re.finditer(r'black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)\s+black_duration:\s*([\d.]+)', err):
        black.append({'start': round(float(m.group(1)), 2),
                      'end': round(float(m.group(2)), 2),
                      'duration': round(float(m.group(3)), 2)})

    silence = []
    starts = [float(x) for x in re.findall(r'silence_start:\s*([\d.]+)', err)]
    ends = [float(x) for x in re.findall(r'silence_end:\s*([\d.]+)', err)]
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else None
        silence.append({'start': round(s, 2), 'end': round(e, 2) if e is not None else None,
                        'duration': round((e - s), 2) if e is not None else None})

    loud = {}
    m = re.search(r'\{[^{}]*"input_i"[\s\S]*?\}', err)
    if m:
        try:
            raw = json.loads(m.group(0))
            loud = {
                'lufs': float(raw.get('input_i') or 0),
                'true_peak': float(raw.get('input_tp') or 0),
                'lra': float(raw.get('input_lra') or 0),
            }
        except Exception:
            loud = {}

    return {'black': black, 'silence': silence, 'loudness': loud}


def qc(path: str, expected_duration: float | None = None,
       expected_size: tuple[int, int] | None = None) -> dict:
    if not os.path.exists(path):
        return {'ok': False, 'status': 'fail', 'error': f'文件不存在：{path}', 'checks': []}

    info = _probe(path)
    detail = _analyse(path)
    checks: list[dict] = []

    def add(name: str, status: str, text: str) -> None:
        checks.append({'name': name, 'status': status, 'detail': text})

    # 时长
    if expected_duration:
        delta = abs(info['duration'] - float(expected_duration))
        if delta > DURATION_FAIL:
            add('时长', 'fail', f'{info["duration"]:.2f}s，配方 {float(expected_duration):.2f}s，差 {delta:.2f}s')
        elif delta > DURATION_TOLERANCE:
            add('时长', 'warn', f'{info["duration"]:.2f}s，与配方差 {delta:.2f}s')
        else:
            add('时长', 'pass', f'{info["duration"]:.2f}s')

    # 分辨率
    if expected_size:
        w, h = expected_size
        if (info['width'], info['height']) != (int(w), int(h)):
            add('分辨率', 'warn', f'{info["width"]}×{info["height"]}，配方是 {w}×{h}')
        else:
            add('分辨率', 'pass', f'{info["width"]}×{info["height"]}')

    # 黑帧
    bad_black = [b for b in detail['black'] if b['duration'] >= BLACK_MIN]
    if bad_black:
        worst = max(bad_black, key=lambda b: b['duration'])
        status = 'fail' if worst['duration'] >= BLACK_FAIL else 'warn'
        spans = '、'.join(f"{b['start']}-{b['end']}s" for b in bad_black[:3])
        add('黑帧', status, f'{len(bad_black)} 段，最长 {worst["duration"]}s（{spans}）')
    else:
        add('黑帧', 'pass', '没有黑屏段')

    # 静音
    total = info['duration'] or 1
    silence_total = sum(s['duration'] or 0 for s in detail['silence'])
    bad_silence = [s for s in detail['silence'] if (s['duration'] or 0) >= SILENCE_MIN]
    if silence_total >= total - 0.5:
        add('声音', 'fail', '整条没有声音')
    elif bad_silence:
        worst = max(bad_silence, key=lambda s: s['duration'] or 0)
        status = 'fail' if (worst['duration'] or 0) >= SILENCE_FAIL else 'warn'
        add('声音', status, f'静音 {silence_total:.1f}s，最长一段 {worst["duration"]}s')
    else:
        add('声音', 'pass', f'静音合计 {silence_total:.1f}s')

    # 响度
    loud = detail['loudness']
    if loud:
        lufs = loud.get('lufs', 0)
        if lufs < LUFS_MIN or lufs > LUFS_MAX:
            add('响度', 'warn', f'{lufs:.1f} LUFS（目标 {LUFS_TARGET}）')
        else:
            add('响度', 'pass', f'{lufs:.1f} LUFS，峰值 {loud.get("true_peak", 0):.1f} dB')
    else:
        add('响度', 'warn', '没测到响度（可能没有音轨）')

    # 编码
    add('编码', 'pass' if info['video_codec'].startswith('h264') else 'warn',
        f'{info["video_codec"]}/{info["audio_codec"] or "无音轨"}，{info["size_mb"]}MB')

    order = {'fail': 2, 'warn': 1, 'pass': 0}
    status = 'pass'
    for c in checks:
        if order[c['status']] > order[status]:
            status = c['status']

    return {
        'ok': status != 'fail',
        'status': status,
        'path': path,
        'duration': round(info['duration'], 2),
        'size_mb': info['size_mb'],
        'width': info['width'],
        'height': info['height'],
        'loudness': loud,
        'black_segments': detail['black'],
        'silence_segments': detail['silence'],
        'checks': checks,
    }
