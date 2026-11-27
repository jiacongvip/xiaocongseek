"""xcy_audiofx.py —— 声音层：人声增强 + BGM 选曲

口播原片是手机/相机直录：房间混响、空调底噪、齿音全在。这条链只做三件事：
压底噪、切掉低频轰鸣、把人声的存在感（3kHz 附近）提一点，然后轻微压限。

BGM 走本地曲库（`~/XiaocongcutAPI/assets/bgm/` 与插件的 `assets/music/`），
按 genre / mood / bpm 选，不需要联网也不需要版权接口。

用法
----
    import xcy_audiofx as A
    chain = A.voice_chain('clean')          # → 'afftdn=...,highpass=...,...'
    pick = A.pick_bgm(8.6, genre='business')  # → {'path': ..., 'meta': {...}}
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

FFPROBE = os.environ.get('XCY_FFPROBE') or shutil.which('ffprobe') or 'ffprobe'

PLUGIN_MUSIC = Path(__file__).resolve().parent.parent.parent / 'assets' / 'music'
BGM_DIRS = [
    Path(os.environ.get('XCY_BGM_DIR') or (Path(__file__).resolve().parent / 'assets' / 'bgm')),
    PLUGIN_MUSIC,
]

AUDIO_EXT = ('.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg')

# 两档强度：clean 是默认，strong 只给嘈杂素材（广场、马路边、店里人多）
# 注意：afftdn 的 nf 是噪声底（dB），nr 是降噪量，两个都别拉太狠，否则人声发闷。
VOICE_CHAINS = {
    'off': '',
    # clean：默认档。实测（粉噪 -40dB 的素材）底噪 -11.8dB，信噪比 +3.9dB
    'clean': (
        'afftdn=nr=11:nf=-35,'
        'highpass=f=80,'
        'equalizer=f=3200:t=q:w=1.1:g=3,'
        'acompressor=threshold=0.28:ratio=2.5:attack=12:release=220:makeup=1.1'
    ),
    # strong：嘈杂素材（广场/马路边/人多）。底噪 -16.0dB、信噪比 +8.7dB，
    # 代价是气声会被吃掉一点，别对配音棚素材用。
    'strong': (
        'afftdn=nr=16:nf=-34,'
        'highpass=f=90,'
        'deesser,'
        'equalizer=f=3000:t=q:w=1.2:g=3.5,'
        'acompressor=threshold=0.25:ratio=3:attack=10:release=190:makeup=1.2'
    ),
}


def voice_chain(level: str = 'clean') -> str:
    """返回人声链；未知档位按 clean，`off` 返回空串。"""
    key = str(level or 'clean').lower()
    if key in ('off', 'none', '0', 'false'):
        return ''
    return VOICE_CHAINS.get(key) or VOICE_CHAINS['clean']


def probe_duration(path: str) -> float:
    try:
        out = subprocess.run(
            [FFPROBE, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
            capture_output=True, text=True, timeout=20,
        )
        return round(float((out.stdout or '0').strip() or 0), 2)
    except Exception:  # noqa: BLE001
        return 0.0


def _guess_meta(path: Path, duration: float) -> dict:
    """没 sidecar 时按文件名猜个大概：lively=轻快，steady=稳，其余当 business。"""
    stem = path.stem.lower()
    mood = 'steady'
    bpm = 100
    genre = 'business'
    if any(k in stem for k in ('lively', 'upbeat', 'happy', '轻快')):
        mood, bpm = 'lively', 118
    elif any(k in stem for k in ('calm', 'soft', 'chill', '舒缓')):
        mood, bpm = 'calm', 88
    elif any(k in stem for k in ('warm', '暖')):
        mood = 'warm'
    if any(k in stem for k in ('vlog', 'life')):
        genre = 'vlog'
    return {'genre': genre, 'mood': mood, 'bpm': bpm, 'duration': duration}


def library(refresh: bool = False) -> list[dict]:
    """扫曲库。每个文件旁边可以有同名 .json sidecar：{genre,bpm,mood,tags}。"""
    items: list[dict] = []
    seen: set[str] = set()
    for root in BGM_DIRS:
        if not root.exists():
            continue
        for f in sorted(root.iterdir()):
            if not f.is_file() or f.suffix.lower() not in AUDIO_EXT:
                continue
            real = str(f.resolve())
            if real in seen:
                continue
            seen.add(real)
            side = f.with_suffix('.json')
            meta: dict = {}
            if side.exists():
                try:
                    meta = json.loads(side.read_text(encoding='utf8'))
                except Exception:  # noqa: BLE001
                    meta = {}
            if not meta:
                meta = _guess_meta(f, probe_duration(real))
                if refresh:
                    try:
                        side.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf8')
                    except Exception:  # noqa: BLE001
                        pass
            meta.setdefault('duration', probe_duration(real))
            items.append({'name': f.stem, 'path': real, **meta})
    return items


def pick_bgm(duration: float, genre: str | None = None, tone: str | None = None,
             min_seconds: float = 8.0, exclude: list[str] | None = None) -> dict | None:
    """挑一首：先按 genre/mood 匹配，再按 bpm 靠近 100 的程度排；都不匹配就用第一首够长的。

    返回 {'path','name','meta','reason'}；曲库为空返回 None（调用方按"没 BGM"处理）。
    """
    lib = [m for m in library() if m['path'] not in (exclude or [])]
    if not lib:
        return None

    want_genre = str(genre or '').strip().lower()
    want_mood = str(tone or '').strip().lower()

    def score(m: dict) -> tuple:
        g = str(m.get('genre') or '').lower()
        mood = str(m.get('mood') or '').lower()
        bpm = float(m.get('bpm') or 100)
        dur = float(m.get('duration') or 0)
        s = 0
        if want_genre and g == want_genre:
            s += 40
        if want_mood and mood == want_mood:
            s += 30
        if want_mood and want_mood in ('steady', 'lively') and mood == want_mood:
            s += 10
        s -= abs(bpm - 100) / 4.0
        # 曲子明显短于片子时，循环接缝会更明显
        if dur and dur < min_seconds:
            s -= 15
        return (-s, m['name'])

    best = sorted(lib, key=score)[0]
    reasons = []
    if want_genre and str(best.get('genre') or '').lower() == want_genre:
        reasons.append(f'曲风 {want_genre}')
    if want_mood and str(best.get('mood') or '').lower() == want_mood:
        reasons.append(f'情绪 {want_mood}')
    if not reasons:
        reasons.append('曲库兜底')
    return {
        'path': best['path'],
        'name': best.get('name') or Path(best['path']).stem,
        'meta': best,
        'reason': '、'.join(reasons) + f"，{int(float(best.get('bpm') or 0))} BPM",
        'count': len(lib),
    }
