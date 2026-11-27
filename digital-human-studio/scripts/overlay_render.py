#!/usr/bin/env python3
"""画中画关键帧逐帧合成（位置 / 宽度 / 透明度）。

用法：
  python3 overlay_render.py --base a.mp4 --out b.mp4 --fps 30 \
      --layers '[{"source":"pp.mp4","start":0,"end":4,"target":2,
                  "keyframes":[{"at":2,"x":0.05,"y":0.3,"w":0.3,"opacity":0},
                               {"at":4,"x":0.62,"y":0.05,"w":0.42,"opacity":1}]}]'

- keyframes 的 at 是**时间线绝对秒**，x/y 是左上角归一化坐标，w 是浮层宽度占画布比例，opacity 0-1。
- 浮层只在 [target, target + end - start] 之间出现，其余帧原样透传。
- 浮层帧先抽到临时目录，再按时间线位置逐帧贴到主片帧上。

绿幕抠像 / 蒙版（可选）：
  layer.chroma = {"on":true,"color":"#00b140","similarity":0.30,"smooth":0.12}
  layer.mask   = {"shape":"none|rect|circle|linear","x":0,"y":0,"w":1,"h":1,"feather":0.12}
  chroma 按 RGB 距离生成 alpha（similarity 内全透明，smooth 区间渐变）；
  mask 的 x/y/w/h 是浮层内部归一化矩形，circle 取该矩形的内切椭圆，linear 在该矩形内左右渐隐。
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np

FFMPEG = os.environ.get("FFMPEG_BIN") or os.path.expanduser("~/.local/bin/ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN") or os.path.expanduser("~/.local/bin/ffprobe")

FIELDS = (("x", 0.0), ("y", 0.0), ("w", 0.3), ("opacity", 1.0))


def probe_size(path):
    out = subprocess.check_output([
        FFPROBE, "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=p=0", path,
    ]).decode().strip().splitlines()[0]
    w, h = [int(x) for x in out.split(",")[:2]]
    return w, h


def sample(keys, t):
    """按绝对时间在关键帧序列上线性插值。"""
    if not keys:
        return {f: d for f, d in FIELDS}
    ks = sorted(keys, key=lambda k: float(k.get("at", 0)))
    if t <= float(ks[0].get("at", 0)):
        return {f: float(ks[0].get(f, d)) for f, d in FIELDS}
    if t >= float(ks[-1].get("at", 0)):
        return {f: float(ks[-1].get(f, d)) for f, d in FIELDS}
    for i in range(len(ks) - 1):
        a, b = ks[i], ks[i + 1]
        a0, b0 = float(a.get("at", 0)), float(b.get("at", 0))
        if a0 <= t <= b0:
            f = 0.0 if b0 == a0 else (t - a0) / (b0 - a0)
            return {k: float(a.get(k, d)) + (float(b.get(k, d)) - float(a.get(k, d))) * f for k, d in FIELDS}
    return {f: d for f, d in FIELDS}


def _hex_rgb(v, default=(0, 177, 64)):
    t = str(v or "").strip().lstrip("#")
    if len(t) == 3:
        t = "".join(c * 2 for c in t)
    if len(t) != 6:
        return np.array(default, dtype=np.float32)
    try:
        return np.array([int(t[0:2], 16), int(t[2:4], 16), int(t[4:6], 16)], dtype=np.float32)
    except ValueError:
        return np.array(default, dtype=np.float32)


def chroma_alpha(rgb, conf):
    """RGB 距离 → alpha（1 保留，0 抠掉）。"""
    key = _hex_rgb(conf.get("color"), (0, 177, 64))
    sim = max(0.0, min(1.0, float(conf.get("similarity") if conf.get("similarity") is not None else 0.30)))
    smooth = max(0.005, min(0.5, float(conf.get("smooth") if conf.get("smooth") is not None else 0.12)))
    dist = np.sqrt(((rgb - key) ** 2).sum(axis=2)) / 441.673  # 归一化 0..1（三通道最大差 √(3*255²)）
    a = (dist - sim) / smooth
    return np.clip(a, 0.0, 1.0)


def mask_alpha(w, h, conf):
    """浮层内部归一化矩形/椭圆/线性渐隐。"""
    shape = str(conf.get("shape") or "none").lower()
    if shape in ("none", "", "off"):
        return None
    feather = max(0.0, min(0.5, float(conf.get("feather") if conf.get("feather") is not None else 0.12)))
    x0 = max(0.0, min(0.98, float(conf.get("x") if conf.get("x") is not None else 0.0)))
    y0 = max(0.0, min(0.98, float(conf.get("y") if conf.get("y") is not None else 0.0)))
    bw = max(0.02, min(1.0 - x0, float(conf.get("w") if conf.get("w") is not None else 1.0)))
    bh = max(0.02, min(1.0 - y0, float(conf.get("h") if conf.get("h") is not None else 1.0)))
    xs = (np.arange(w, dtype=np.float32) + 0.5) / max(1, w)
    ys = (np.arange(h, dtype=np.float32) + 0.5) / max(1, h)
    gx, gy = np.meshgrid(xs, ys)
    f = max(1e-3, feather)
    if shape == "circle":
        cx, cy = x0 + bw / 2.0, y0 + bh / 2.0
        rx, ry = bw / 2.0, bh / 2.0
        rr = np.sqrt(((gx - cx) / max(1e-4, rx)) ** 2 + ((gy - cy) / max(1e-4, ry)) ** 2)
        return np.clip((1.0 - rr) / f, 0.0, 1.0)
    if shape == "linear":
        u = (gx - x0) / max(1e-4, bw)
        return np.clip(u / f, 0.0, 1.0) * np.clip((1.0 - u) / f, 0.0, 1.0)
    # rect：四边各做 feather 渐隐
    left = np.clip((gx - x0) / f, 0.0, 1.0)
    right = np.clip((x0 + bw - gx) / f, 0.0, 1.0)
    top = np.clip((gy - y0) / f, 0.0, 1.0)
    bottom = np.clip((y0 + bh - gy) / f, 0.0, 1.0)
    return np.minimum(np.minimum(left, right), np.minimum(top, bottom))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--fps", type=float, default=30)
    ap.add_argument("--layers", default="[]")
    a = ap.parse_args()

    from PIL import Image

    layers = json.loads(a.layers) or []
    layers = [x for x in layers if x and x.get("source") and os.path.exists(x["source"])]
    if not layers:
        print(json.dumps({"success": False, "error": "没有可用的浮层素材"}, ensure_ascii=False))
        return 1

    W, H = probe_size(a.base)
    fps = float(a.fps)
    frame = W * H * 3
    work = tempfile.mkdtemp(prefix="ppframes-")

    # 1) 浮层抽帧（jpg 省空间，画中画尺寸小，质量足够）；静态图直接读进内存
    IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
    for li, lay in enumerate(layers):
        s0 = max(0.0, float(lay.get("start") or 0))
        e0 = max(s0 + 0.05, float(lay.get("end") or (s0 + 3)))
        lay["_t0"] = float(lay.get("target") or 0)
        lay["_dur"] = e0 - s0
        ext = os.path.splitext(lay["source"])[1].lower()
        if ext in IMG_EXT:
            lay["_img"] = Image.open(lay["source"]).convert("RGBA")
            lay["_count"] = 1
            continue
        d = os.path.join(work, "L%d" % li)
        os.makedirs(d, exist_ok=True)
        subprocess.run([
            FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
            "-ss", "%g" % s0, "-t", "%g" % (e0 - s0), "-i", lay["source"],
            "-vf", "fps=%g" % fps,
            os.path.join(d, "%05d.png"),
        ], check=True)
        lay["_dir"] = d
        lay["_count"] = len(os.listdir(d))

    # 2) 主导流式解码 → 逐帧合成 → 编码
    dec = subprocess.Popen(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", a.base,
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-vf", "fps=%g" % fps, "pipe:1"],
        stdout=subprocess.PIPE)
    tmp = a.out + ".video.mp4"
    enc = subprocess.Popen(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (W, H),
         "-r", "%g" % fps, "-i", "pipe:0",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp],
        stdin=subprocess.PIPE)

    idx = 0
    frames_drawn = 0
    while True:
        buf = dec.stdout.read(frame)
        if len(buf) < frame:
            break
        t = idx / fps
        idx += 1
        active = []
        for lay in layers:
            if lay["_t0"] <= t < lay["_t0"] + lay["_dur"]:
                if lay.get("_img") is not None:
                    active.append((lay, 1))
                    continue
                fi = int(round((t - lay["_t0"]) * fps)) + 1
                if 1 <= fi <= lay["_count"]:
                    active.append((lay, fi))
        if not active:
            enc.stdin.write(buf)
            continue
        base_img = Image.frombytes("RGB", (W, H), buf)
        for lay, fi in active:
            v = sample(lay.get("keyframes") or [], t)
            pw = max(16, int(round(W * max(0.02, min(1.0, v["w"])))))
            # 静态图：常驻内存，透明通道直接当蒙版贴
            if lay.get("_img") is not None:
                src = lay["_img"]
                cached = lay.get("_scaled")
                if cached is None or cached.width != pw:
                    ph = max(2, int(round(src.height * (pw / max(1, src.width)))))
                    cached = src.resize((pw, ph), Image.LANCZOS)
                    lay["_scaled"] = cached
                img = cached
                op = max(0.0, min(1.0, v["opacity"]))
                if op <= 0.01:
                    continue
                px = int(round(v["x"] * (W - img.width)))
                py = int(round(v["y"] * (H - img.height)))
                if op >= 0.99:
                    base_img.paste(img, (px, py), img)
                else:
                    alpha = img.getchannel("A").point(lambda p: int(p * op))
                    base_img.paste(img.convert("RGB"), (px, py), alpha)
                continue
            try:
                img = Image.open(os.path.join(lay["_dir"], "%05d.png" % fi)).convert("RGB")
            except Exception:
                continue
            ph = max(2, int(round(img.height * (pw / max(1, img.width)))))
            img = img.resize((pw, ph), Image.LANCZOS)
            op = max(0.0, min(1.0, v["opacity"]))
            if op <= 0.01:
                continue
            px = int(round(v["x"] * (W - pw)))
            py = int(round(v["y"] * (H - ph)))
            chroma = lay.get("chroma") or {}
            mask_c = lay.get("mask") or {}
            need = bool(chroma.get("on")) or str(mask_c.get("shape") or "none") != "none"
            if not need:
                if op >= 0.99:
                    base_img.paste(img, (px, py))
                else:
                    mask = Image.new("L", (pw, ph), int(op * 255))
                    base_img.paste(img, (px, py), mask)
                continue
            arr = np.asarray(img, dtype=np.float32)
            alpha = np.ones((ph, pw), dtype=np.float32)
            if chroma.get("on"):
                alpha *= chroma_alpha(arr, chroma)
            m = mask_alpha(pw, ph, mask_c)
            if m is not None:
                alpha *= m
            alpha *= op
            mask_img = Image.fromarray((np.clip(alpha, 0.0, 1.0) * 255.0).astype(np.uint8), "L")
            base_img.paste(img, (px, py), mask_img)
        frames_drawn += 1
        enc.stdin.write(base_img.tobytes())

    dec.stdout.close()
    dec.wait()
    enc.stdin.close()
    enc.wait()
    shutil.rmtree(work, ignore_errors=True)
    if enc.returncode != 0 or not os.path.exists(tmp):
        print(json.dumps({"success": False, "error": "编码失败"}, ensure_ascii=False))
        return 1

    # 3) 接回原音轨
    r = subprocess.run([
        FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
        "-i", tmp, "-i", a.base,
        "-map", "0:v:0", "-map", "1:a:0?", "-c", "copy",
        "-movflags", "+faststart", a.out])
    try:
        os.remove(tmp)
    except OSError:
        pass
    if r.returncode != 0:
        print(json.dumps({"success": False, "error": "封装失败"}, ensure_ascii=False))
        return 1
    keyed = sum(1 for x in layers if (x.get("chroma") or {}).get("on"))
    masked = sum(1 for x in layers if str((x.get("mask") or {}).get("shape") or "none") != "none")
    print(json.dumps({"success": True, "layers": len(layers), "frames": idx,
                      "composited": frames_drawn, "width": W, "height": H,
                      "chroma": keyed, "mask": masked, "out": a.out}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
