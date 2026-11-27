#!/usr/bin/env python3
"""画面变换（位置/缩放/旋转/透明度）逐帧合成。

用法：
  python3 motion_render.py --src a.mp4 --dst b.mp4 --fps 30 \
      --segments '[{"t0":0,"t1":2.9,"keys":[{"at":0,"x":0.08,"y":0,"scale":1.35,"rotate":8,"opacity":0.6},{"at":1,"x":0,"y":0,"scale":1,"rotate":0,"opacity":1}]}]'

只对落入 segment 区间的帧做变换，其余帧原样透传，最后用原片音频替换。
"""
import argparse, json, os, subprocess, sys

FFMPEG = os.environ.get("FFMPEG_BIN") or os.path.expanduser("~/.local/bin/ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN") or os.path.expanduser("~/.local/bin/ffprobe")


def probe_size(path):
    out = subprocess.check_output([
        FFPROBE, "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=p=0", path,
    ]).decode().strip().splitlines()[0]
    w, h = [int(x) for x in out.split(",")[:2]]
    return w, h


def sample(keys, p):
    """在关键帧序列上按段内进度 p(0..1) 线性插值。"""
    if not keys:
        return None
    ks = sorted(keys, key=lambda k: k.get("at", 0))
    if p <= ks[0].get("at", 0):
        k = ks[0]
        return {f: float(k.get(f, d)) for f, d in
                (("x", 0.0), ("y", 0.0), ("scale", 1.0), ("rotate", 0.0), ("opacity", 1.0))}
    if p >= ks[-1].get("at", 1):
        k = ks[-1]
        return {f: float(k.get(f, d)) for f, d in
                (("x", 0.0), ("y", 0.0), ("scale", 1.0), ("rotate", 0.0), ("opacity", 1.0))}
    for i in range(len(ks) - 1):
        a, b = ks[i], ks[i + 1]
        a0, b0 = float(a.get("at", 0)), float(b.get("at", 1))
        if a0 <= p <= b0:
            f = 0.0 if b0 == a0 else (p - a0) / (b0 - a0)
            return {
                "x": float(a.get("x", 0)) + (float(b.get("x", 0)) - float(a.get("x", 0))) * f,
                "y": float(a.get("y", 0)) + (float(b.get("y", 0)) - float(a.get("y", 0))) * f,
                "scale": float(a.get("scale", 1)) + (float(b.get("scale", 1)) - float(a.get("scale", 1))) * f,
                "rotate": float(a.get("rotate", 0)) + (float(b.get("rotate", 0)) - float(a.get("rotate", 0))) * f,
                "opacity": float(a.get("opacity", 1)) + (float(b.get("opacity", 1)) - float(a.get("opacity", 1))) * f,
            }
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--dst", required=True)
    ap.add_argument("--fps", type=float, default=30)
    ap.add_argument("--segments", default="[]")
    a = ap.parse_args()

    from PIL import Image
    import numpy as np

    segs = json.loads(a.segments) or []
    segs = [s for s in segs if s and s.get("keys")]
    W, H = probe_size(a.src)
    fps = a.fps
    frame = W * H * 3

    dec = subprocess.Popen(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", a.src,
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-vf", "fps=%g" % fps, "pipe:1"],
        stdout=subprocess.PIPE)
    tmp = a.dst + ".video.mp4"
    enc = subprocess.Popen(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (W, H),
         "-r", "%g" % fps, "-i", "pipe:0",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp],
        stdin=subprocess.PIPE)

    black = Image.new("RGB", (W, H), (0, 0, 0))
    idx = 0
    while True:
        buf = dec.stdout.read(frame)
        if len(buf) < frame:
            break
        t = idx / fps
        idx += 1
        st = None
        for s in segs:
            if float(s["t0"]) <= t < float(s["t1"]):
                st = s
                break
        if st is None:
            enc.stdin.write(buf)
            continue
        p = (t - float(st["t0"])) / max(1e-6, float(st["t1"]) - float(st["t0"]))
        v = sample(st["keys"], p)
        if v is None:
            enc.stdin.write(buf)
            continue
        sc = max(0.01, min(8.0, v["scale"]))
        op = max(0.0, min(1.0, v["opacity"]))
        img = Image.frombytes("RGB", (W, H), buf)
        if abs(sc - 1.0) > 1e-4:
            nw, nh = max(2, int(round(W * sc))), max(2, int(round(H * sc)))
            img = img.resize((nw, nh), Image.LANCZOS)
        else:
            nw, nh = W, H
        if abs(v["rotate"]) > 1e-4:
            img = img.rotate(-v["rotate"], resample=Image.BICUBIC, expand=False, fillcolor=(0, 0, 0))
        canvas = black.copy() if (nw != W or nh != H) else Image.new("RGB", (W, H), (0, 0, 0))
        ox = (W - nw) // 2 + int(round(v["x"] * W))
        oy = (H - nh) // 2 + int(round(v["y"] * H))
        canvas.paste(img, (ox, oy))
        arr = np.asarray(canvas)
        if op < 0.999:
            arr = (arr.astype(np.float32) * op).astype(np.uint8)
        enc.stdin.write(arr.tobytes())

    dec.stdout.close()
    dec.wait()
    enc.stdin.close()
    enc.wait()
    if enc.returncode != 0 or not os.path.exists(tmp):
        print("encode failed", file=sys.stderr)
        return 1

    # 把原片音轨接回去
    out = a.dst
    mux = subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
         "-i", tmp, "-i", a.src,
         "-map", "0:v:0", "-map", "1:a:0?", "-c", "copy",
         "-movflags", "+faststart", out])
    try:
        os.remove(tmp)
    except OSError:
        pass
    if mux.returncode != 0:
        # 无音轨时直接落成无声片
        os.replace(tmp, out) if os.path.exists(tmp) else None
        return 0
    print("frames", idx)
    return 0


if __name__ == "__main__":
    sys.exit(main())
