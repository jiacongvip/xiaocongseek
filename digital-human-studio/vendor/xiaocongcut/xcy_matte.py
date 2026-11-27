#!/usr/bin/env python
"""人像抠图合成：把花字压在人物**后面**，输出带这个效果的成片 mp4。

原理：逐帧把人从背景里抠出来（rembg），先把花字画在原背景上，再把人物盖回去。
人物挡住的地方自然就是花字被遮住的部分——这就是"文字在人像后面"。

用法：
  .venv/bin/python xcy_matte.py \
      --video in.mp4 \
      --text "0.3,2.9,hook_yellow,一客一价,Slide_Up" \
      --text "3.1,5.5,title_gold,阶梯价,Mini_Zoom" \
      --out out.mp4

  --text 格式：起,止,样式,文字,入场（入场可省）
  样式：hook_yellow / subtitle_white / warn_orange / shop_sign / title_gold / plain
  位置：--pos lower_third|center|top（默认 lower_third）

首次运行会自动下载抠像模型（约 170MB），之后离线可用。
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import xcy_ext as X  # 复用同一套花字预设与渲染

POSITION_Y = {'lower_third': 0.62, 'center': 0.50, 'top': 0.28}


def probe(path: str):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'stream=r_frame_rate,width,height',
         '-show_entries', 'format=duration', '-of', 'json', path],
        capture_output=True, text=True,
    )
    import json as _json
    d = _json.loads(out.stdout or '{}')
    st = (d.get('streams') or [{}])[0]
    num, _, den = (st.get('r_frame_rate') or '25/1').partition('/')
    fps = float(num) / float(den or 1)
    return fps, int(st.get('width') or 0), int(st.get('height') or 0), float(d.get('format', {}).get('duration') or 0)


def has_audio(path: str) -> bool:
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a',
                          '-show_entries', 'stream=index', '-of', 'csv=p=0', path],
                         capture_output=True, text=True)
    return bool((out.stdout or '').strip())


def parse_texts(items: list[str]) -> list[dict]:
    rows = []
    for raw in items:
        parts = [p.strip() for p in raw.split(',')]
        if len(parts) < 4:
            raise ValueError(f'--text 格式不对：{raw}（要 起,止,样式,文字[,入场]）')
        start, end, style, text = float(parts[0]), float(parts[1]), parts[2], parts[3]
        intro = parts[4] if len(parts) > 4 and parts[4] else None
        rows.append({'start': start, 'end': end, 'style': style, 'text': text, 'intro': intro})
    return rows


def main():
    ap = argparse.ArgumentParser(description='花字压在人像后面（逐帧抠像合成）')
    ap.add_argument('--video', required=True)
    ap.add_argument('--text', action='append', default=[], help='起,止,样式,文字[,入场]')
    ap.add_argument('--out', required=True)
    ap.add_argument('--pos', default='lower_third', choices=list(POSITION_Y))
    ap.add_argument('--font-size', type=int, default=64)
    ap.add_argument('--model', default='u2net')
    ap.add_argument('--keep-frames', action='store_true')
    args = ap.parse_args()

    src = str(Path(os.path.expanduser(args.video)).resolve())
    if not os.path.exists(src):
        print('视频不存在:', src)
        return 1

    fps, width, height, duration = probe(src)
    print(f'源视频 {width}×{height}  {fps:.2f}fps  {duration:.2f}s')

    texts = parse_texts(args.text)
    if not texts:
        print('至少给一个 --text')
        return 1

    # 预渲染花字 PNG（同一样式+文字只渲一次）
    rendered = []
    for t in texts:
        cfg = dict(X.PRESETS.get(t['style']) or X.PRESETS['hook_yellow'])
        img, size = X._fit(t['text'], cfg, args.font_size, int(width * 0.86))
        rendered.append({**t, 'img': img, 'size': size})
        print(f"花字 「{t['text']}」 {t['style']}  {img.width}×{img.height}px  {t['start']}–{t['end']}s")

    sess, model_input = _load_model(args.model)
    print(f'抠像模型已加载（{args.model}），开始逐帧处理…')

    work = Path(tempfile.mkdtemp(prefix='xcy-matte-'))
    frames_in = work / 'in'
    frames_out = work / 'out'
    frames_in.mkdir()
    frames_out.mkdir()

    try:
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', src, '-qscale:v', '2',
                        str(frames_in / '%05d.png')], check=True)
        files = sorted(frames_in.glob('*.png'))
        total = len(files)
        print(f'共 {total} 帧')

        for idx, f in enumerate(files, 1):
            t = (idx - 1) / fps
            orig = Image.open(f).convert('RGB')
            base = orig.convert('RGBA')
            # 先抠人（必须用**没画字**的原帧，否则字会被当成人体一起抠出来）
            person = _cut_person(orig, sess, model_input)

            # 1) 花字先画在背景上
            for r in rendered:
                if r['start'] <= t <= r['end']:
                    img = r['img']
                    alpha = 1.0
                    if r.get('intro') and r['intro'].lower() != 'none':
                        span = 0.35
                        alpha = min(1.0, max(0.0, (t - r['start']) / span))
                    layer = img if alpha >= 1 else _apply_alpha(img, alpha)
                    x = (base.width - layer.width) // 2
                    y = int(base.height * POSITION_Y[args.pos]) - layer.height // 2
                    base.alpha_composite(layer, (x, y))

            # 2) 人物盖回去 —— 被人物挡住的部分就是"文字在后面"
            base.alpha_composite(person)
            base.convert('RGB').save(frames_out / f.name, optimize=False)

            if idx % 25 == 0 or idx == total:
                print(f'  {idx}/{total}')

        cmd = ['ffmpeg', '-y', '-v', 'error', '-framerate', str(fps),
               '-i', str(frames_out / '%05d.png')]
        if has_audio(src):
            cmd += ['-i', src, '-map', '0:v:0', '-map', '1:a:0', '-shortest', '-c:a', 'aac', '-b:a', '192k']
        cmd += ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', args.out]
        subprocess.run(cmd, check=True)
        print('完成:', args.out)
    finally:
        if not args.keep_frames:
            shutil.rmtree(work, ignore_errors=True)
        else:
            print('帧保留在:', work)
    return 0


MODEL_DIR = Path(os.environ.get('XCY_MODEL_DIR', str(Path.home() / '.u2net')))


def _load_model(name: str):
    """直接跑 onnx（不用 rembg，那个包在某些环境里会被安全拦截）。"""
    import onnxruntime as ort

    path = MODEL_DIR / f'{name}.onnx'
    if not path.exists():
        raise FileNotFoundError(
            f'缺模型 {path}。下载 u2net.onnx 放到 {MODEL_DIR}，或用 --model 指定已有模型。')
    sess = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
    return sess, sess.get_inputs()[0].name


def _cut_person(img: Image.Image, sess, input_name: str) -> Image.Image:
    """返回带 alpha 的人像层。"""
    import numpy as np
    from PIL import ImageFilter

    W, H = img.size
    small = img.resize((320, 320), Image.BILINEAR)
    a = np.asarray(small, dtype=np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    a = (a - mean) / std
    preds = sess.run(None, {input_name: a.transpose(2, 0, 1)[None]})
    d = preds[0][0, 0]
    d = (d - d.min()) / (d.max() - d.min() + 1e-8)
    mask = Image.fromarray((d * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))  # 柔化边缘，少一圈硬边

    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def _apply_alpha(img: Image.Image, alpha: float) -> Image.Image:
    out = img.copy()
    a = out.getchannel('A').point(lambda v: int(v * alpha))
    out.putalpha(a)
    return out


if __name__ == '__main__':
    sys.exit(main())

# ─────────────────── 透明人像（给剪映当上层叠加） ───────────────────
def render_person_alpha(src: str, out: str, model: str = 'u2net', fps: float | None = None,
                        on_progress=None, start: float | None = None,
                        end: float | None = None) -> str:
    """把视频里的人抠出来，输出带 alpha 的 ProRes 4444 mov（剪映能直接叠加）。

    start / end 是**源文件内**的秒数：只处理这一段，10 分钟片子只做前 10 秒就传 0 和 10，
    不用把整条片子都拆帧（否则 10 分钟要出几十 GB、跑两小时）。
    """
    import tempfile

    fps = fps or probe(src)[0]
    sess, name = _load_model(model)
    work = Path(tempfile.mkdtemp(prefix='xcy-alpha-'))
    fin, fout = work / 'in', work / 'out'
    fin.mkdir(); fout.mkdir()
    seek = []
    if start is not None and float(start) > 0:
        seek += ['-ss', f'{float(start):.3f}']
    if end is not None:
        dur = float(end) - float(start or 0)
        if dur <= 0:
            raise ValueError(f'抠像区间无效：start={start} end={end}')
        seek += ['-t', f'{dur:.3f}']
    try:
        subprocess.run(['ffmpeg', '-y', '-v', 'error', *seek, '-i', src, '-qscale:v', '2',
                        str(fin / '%05d.png')], check=True)
        files = sorted(fin.glob('*.png'))
        total = len(files)
        for idx, f in enumerate(files, 1):
            img = Image.open(f).convert('RGB')
            person = _cut_person(img, sess, name)
            person.save(fout / f.name)
            if on_progress and (idx % 25 == 0 or idx == total):
                on_progress(idx, total)

        cmd = ['ffmpeg', '-y', '-v', 'error', '-framerate', str(fps),
               '-i', str(fout / '%05d.png'),
               '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le',
               '-alpha_bits', '16', '-vendor', 'apl0', out]
        subprocess.run(cmd, check=True)
        return out
    finally:
        shutil.rmtree(work, ignore_errors=True)


def alpha_cache(src: str, model: str = 'u2net', start: float | None = None,
                end: float | None = None) -> str:
    """按「源文件 + 区间」指纹缓存 alpha mov，重复出片不用重抠。"""
    import hashlib
    st = os.stat(src)
    span = f'{start}-{end}' if (start is not None or end is not None) else 'full'
    key = hashlib.sha1(f'{src}|{st.st_mtime_ns}|{st.st_size}|{model}|{span}'.encode()).hexdigest()[:16]
    out_dir = Path(os.environ.get('XCY_CACHE', str(Path.home() / '.xiaocongcut' / 'cache'))) / 'person-alpha'
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f'{key}.mov'
    if not out.exists():
        length = (float(end) - float(start or 0)) if end is not None else None
        eta = f'约 {max(1, round((length or 10) * 9))} 秒' if length else '1–2 分钟/10 秒'
        print(f'抠像中（{span}，预计 {eta}）…')
        render_person_alpha(src, str(out), model, start=start, end=end)
    return str(out)
