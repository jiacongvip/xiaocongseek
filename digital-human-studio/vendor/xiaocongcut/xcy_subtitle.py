"""xcy_subtitle.py —— 本地口播转写 + 字幕分行

不上传、不依赖外部服务：用 faster-whisper 在本机跑，模型缓存在本地。
输出是带起止时间的 segments，直接喂给 xcy_render 烧进画面。

用法
----
    from xcy_subtitle import transcribe, merge_segments, to_srt
    segs = transcribe('/path/口播.mp4', model='small', language='zh')
    lines = merge_segments(segs, max_chars=14)
    open('out.srt','w').write(to_srt(lines))
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

CACHE_ROOT = Path(os.environ.get('XCY_CACHE', str(Path.home() / '.xiaocongcut' / 'cache')))
ASR_DIR = CACHE_ROOT / 'asr'
MODEL_DIR = CACHE_ROOT / 'asr-models'


CACHE_VERSION = 3  # 改了清洗/分行/提示词/词级时间就 +1，旧缓存自动失效


def _key(path: str, model: str, language: str, words: bool = False) -> str:
    st = os.stat(path)
    raw = f'v{CACHE_VERSION}|{path}|{st.st_mtime_ns}|{st.st_size}|{model}|{language}|w{int(words)}'
    return hashlib.sha1(raw.encode('utf8')).hexdigest()[:16]


def _to_simplified(text: str) -> str:
    """whisper 中文常输出繁体，转成简体；没装 zhconv 就原样返回。"""
    try:
        from zhconv import convert
        return convert(text, 'zh-cn')
    except Exception:
        return text


def _clean(text: str) -> str:
    text = str(text or '').strip()
    # whisper 中文会带空格；顺手去掉全角空格与多余空白
    text = text.replace('\u3000', ' ')
    text = re.sub(r'\s+', '', text) if re.search(r'[\u4e00-\u9fff]', text) else re.sub(r'\s+', ' ', text)
    if re.search(r'[\u4e00-\u9fff]', text):
        text = _to_simplified(text)
    return text.strip()


def _patch_av_open() -> None:
    """faster-whisper 会传 metadata_errors 给 av.open，但 PyAV 19 已经不认这个参数。

    不锁版本、不改三方包，这里包一层：认得的照传，不认的丢掉。
    """
    try:
        import av
    except Exception:
        return
    if getattr(av.open, '_xcy_patched', False):
        return
    original = av.open

    def open_compat(*args, **kwargs):
        kwargs.pop('metadata_errors', None)
        return original(*args, **kwargs)

    open_compat._xcy_patched = True  # type: ignore[attr-defined]
    av.open = open_compat



def model_ready(model: str = 'small') -> bool:
    """模型是否已经落在本地（只查文件，不 import faster_whisper、不联网）。"""
    d = MODEL_DIR / f'models--Systran--faster-whisper-{model}'
    if not d.exists():
        d = MODEL_DIR / model
    if not d.exists():
        return False
    return any(p.name == 'model.bin' for p in d.rglob('*'))


def ensure_model(model: str = 'small'):
    """确保模型在本地；没有就现在下载（首次要等，之后秒开）。"""
    _patch_av_open()
    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            '缺转写依赖：在引擎 venv 里执行 '
            f'`.venv/bin/pip install faster-whisper`（原始错误：{exc}）'
        ) from exc
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    return WhisperModel(
        model, device=os.environ.get('XCY_ASR_DEVICE', 'cpu'),
        compute_type=os.environ.get('XCY_ASR_COMPUTE', 'int8'),
        download_root=str(MODEL_DIR),
    )

def transcribe(path: str, model: str = 'small', language: str = 'zh',
               on_progress=None, force: bool = False, words: bool = False) -> list[dict]:
    """返回 [{start, end, text, words?}]。同一文件+同一模型第二次直接读缓存。

    words=True 才会开词级时间（逐字点亮要用）。默认关着：
    文件大一倍、转写慢两成，普通字幕用不上。
    """
    ASR_DIR.mkdir(parents=True, exist_ok=True)
    cache = ASR_DIR / f'{_key(path, model, language, words)}.json'
    if cache.exists() and not force:
        return json.loads(cache.read_text(encoding='utf8'))

    _patch_av_open()
    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            '缺转写依赖：在引擎 venv 里执行 '
            f'`.venv/bin/pip install faster-whisper`（原始错误：{exc}）'
        ) from exc

    # CPU + int8 足够 10 分钟内素材；有 CUDA 的机器会自己用上
    engine = ensure_model(model)
    # initial_prompt 让模型走简体中文 + 常见口语用词，比默认输出稳定
    prompt = os.environ.get('XCY_ASR_PROMPT', '以下是普通话口播，请用简体中文、带标点输出。')
    raw_segments, info = engine.transcribe(
        path, language=None if language in ('', 'auto') else language,
        vad_filter=True, beam_size=5,
        condition_on_previous_text=False,
        initial_prompt=prompt,
        word_timestamps=bool(words),
    )

    total = float(getattr(info, 'duration', 0) or 0)
    out: list[dict] = []
    for seg in raw_segments:
        text = _clean(seg.text)
        if not text:
            continue
        item = {'start': round(float(seg.start), 3), 'end': round(float(seg.end), 3), 'text': text}
        if words:
            ws = []
            for w in (getattr(seg, 'words', None) or []):
                wtext = _clean(getattr(w, 'word', '') or '')
                if not wtext:
                    continue
                ws.append({'start': round(float(w.start), 3),
                           'end': round(float(w.end), 3), 'text': wtext})
            if ws:
                item['words'] = ws
        out.append(item)
        if on_progress and total > 0:
            try:
                on_progress(min(0.99, float(seg.end) / total))
            except Exception:
                pass

    cache.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf8')
    return out


def _clip_words(words: list[dict], start: float, end: float) -> list[dict]:
    """把词表裁到 [start,end] 里（按词中点判断归属），时间也夹到区间内。"""
    out: list[dict] = []
    for w in words or []:
        mid = (float(w['start']) + float(w['end'])) / 2
        if start - 1e-6 <= mid <= end + 1e-6:
            out.append({
                'start': round(max(start, float(w['start'])), 3),
                'end': round(min(end, float(w['end'])), 3),
                'text': str(w.get('text') or ''),
            })
    return out


def merge_segments(segments: list[dict], max_chars: int = 14,
                   min_dur: float = 0.9, max_gap: float = 0.45) -> list[dict]:
    """把 whisper 的碎句合并成适合竖屏的字幕行。

    规则：上一行没到 max_chars 且间隔够近就并进同一行；标点结尾优先断行。
    词级时间（words）跟着一起搬：合并就拼起来，切分就按时间归属分下去。
    """
    merged: list[dict] = []
    for seg in segments:
        text = str(seg.get('text') or '').strip()
        if not text:
            continue
        words = list(seg.get('words') or [])
        if merged:
            last = merged[-1]
            joined_len = len(last['text']) + len(text)
            gap = float(seg['start']) - float(last['end'])
            ends_sentence = bool(re.search(r'[。！？!?…]$', last['text']))
            if joined_len <= max_chars and gap <= max_gap and not ends_sentence:
                last['text'] += text
                last['end'] = float(seg['end'])
                if words:
                    last.setdefault('words', []).extend(words)
                continue
        item = {'start': float(seg['start']), 'end': float(seg['end']), 'text': text}
        if words:
            item['words'] = words
        merged.append(item)

    # 太短的片段并到前一行，避免一闪而过
    fixed: list[dict] = []
    for seg in merged:
        if fixed and (seg['end'] - seg['start']) < min_dur:
            fixed[-1]['text'] += seg['text']
            fixed[-1]['end'] = seg['end']
            if seg.get('words'):
                fixed[-1].setdefault('words', []).extend(seg['words'])
            continue
        fixed.append(dict(seg))

    # 超长行按标点硬切，均分时间
    result: list[dict] = []
    for seg in fixed:
        text = seg['text']
        if len(text) <= max_chars:
            result.append(seg)
            continue
        pieces = [p for p in re.split(r'(?<=[，,。.！!？?；;])', text) if p]
        buf = ''
        chunks = []
        for p in pieces:
            if len(buf) + len(p) <= max_chars:
                buf += p
            else:
                if buf:
                    chunks.append(buf)
                buf = p
        if buf:
            chunks.append(buf)
        # 整句没有标点时按字数硬切，保证每行不超过 max_chars
        hard: list[str] = []
        for chunk in chunks:
            if len(chunk) <= max_chars:
                hard.append(chunk)
            else:
                hard.extend(chunk[i:i + max_chars] for i in range(0, len(chunk), max_chars))
        chunks = hard
        span = (seg['end'] - seg['start']) / max(1, len(chunks))
        for i, chunk in enumerate(chunks):
            c_start = round(seg['start'] + span * i, 3)
            c_end = round(seg['start'] + span * (i + 1), 3)
            piece = {'start': c_start, 'end': c_end, 'text': chunk}
            if seg.get('words'):
                words = _clip_words(seg['words'], c_start, c_end)
                if words:
                    piece['words'] = words
            result.append(piece)
    return result


def to_srt(segments: list[dict]) -> str:
    def ts(sec: float) -> str:
        sec = max(0.0, float(sec))
        h = int(sec // 3600)
        m = int((sec % 3600) // 60)
        s = sec % 60
        return f'{h:02d}:{m:02d}:{s:06.3f}'.replace('.', ',')

    lines = []
    for i, seg in enumerate(segments, 1):
        lines += [str(i), f"{ts(seg['start'])} --> {ts(seg['end'])}", str(seg['text']), '']
    return '\n'.join(lines)
