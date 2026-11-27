#!/usr/bin/env python3
"""画中画抠像 / 蒙版单帧预览。

用法：
  python3 overlay_preview.py --source in.mp4 --at 1.2 --out /tmp/x.png \
      --chroma '{"on":true,"color":"#00b140","similarity":0.3,"smooth":0.12}' \
      --mask '{"shape":"circle","x":0,"y":0,"w":1,"h":1,"feather":0.12}'

输出带 alpha 的 PNG（抠掉的区域全透明），前端直接叠在主画面位置上。
"""
import argparse
import json
import os
import subprocess
import sys

from PIL import Image
import numpy as np

FFMPEG = os.environ.get("FFMPEG_BIN") or os.path.expanduser("~/.local/bin/ffmpeg")


def hex_rgb(v, default=(0, 177, 64)):
    t = str(v or "").strip().lstrip("#")
    if len(t) == 3:
        t = "".join(c * 2 for c in t)
    if len(t) != 6:
        return np.array(default, dtype=np.float32)
    try:
        return np.array([int(t[0:2], 16), int(t[2:4], 16), int(t[4:6], 16)], dtype=np.float32)
    except ValueError:
        return np.array(default, dtype=np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--at", type=float, default=0.0)
    ap.add_argument("--out", required=True)
    ap.add_argument("--chroma", default="{}")
    ap.add_argument("--mask", default="{}")
    ap.add_argument("--max", type=int, default=720)
    a = ap.parse_args()

    if not os.path.exists(a.source):
        print(json.dumps({"success": False, "error": "素材不存在"}, ensure_ascii=False))
        return 1

    tmp = a.out + ".src.png"
    r = subprocess.run([
        FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
        "-ss", "%g" % max(0.0, a.at), "-i", a.source, "-frames:v", "1", tmp,
    ])
    if r.returncode != 0 or not os.path.exists(tmp):
        print(json.dumps({"success": False, "error": "抽帧失败"}, ensure_ascii=False))
        return 1

    img = Image.open(tmp).convert("RGB")
    W0, H0 = img.size
    scale = min(1.0, float(a.max) / max(1, W0))
    if scale < 1.0:
        img = img.resize((int(round(W0 * scale)), int(round(H0 * scale)),), Image.LANCZOS)
    w, h = img.size
    arr = np.asarray(img, dtype=np.float32)
    alpha = np.ones((h, w), dtype=np.float32)

    chroma = json.loads(a.chroma or "{}") or {}
    mask = json.loads(a.mask or "{}") or {}
    if chroma.get("on"):
        key = hex_rgb(chroma.get("color"), (0, 177, 64))
        sim = max(0.0, min(1.0, float(chroma.get("similarity") if chroma.get("similarity") is not None else 0.30)))
        smooth = max(0.005, min(0.5, float(chroma.get("smooth") if chroma.get("smooth") is not None else 0.12)))
        dist = np.sqrt(((arr - key) ** 2).sum(axis=2)) / 441.673
        alpha *= np.clip((dist - sim) / smooth, 0.0, 1.0)

    shape = str(mask.get("shape") or "none").lower()
    kept = 1.0
    if shape not in ("none", "", "off"):
        feather = max(0.0, min(0.5, float(mask.get("feather") if mask.get("feather") is not None else 0.12)))
        x0 = max(0.0, min(0.98, float(mask.get("x") if mask.get("x") is not None else 0.0)))
        y0 = max(0.0, min(0.98, float(mask.get("y") if mask.get("y") is not None else 0.0)))
        bw = max(0.02, min(1.0 - x0, float(mask.get("w") if mask.get("w") is not None else 1.0)))
        bh = max(0.02, min(1.0 - y0, float(mask.get("h") if mask.get("h") is not None else 1.0)))
        xs = (np.arange(w, dtype=np.float32) + 0.5) / max(1, w)
        ys = (np.arange(h, dtype=np.float32) + 0.5) / max(1, h)
        gx, gy = np.meshgrid(xs, ys)
        f = max(1e-3, feather)
        if shape == "circle":
            cx, cy = x0 + bw / 2.0, y0 + bh / 2.0
            rr = np.sqrt(((gx - cx) / max(1e-4, bw / 2.0)) ** 2 + ((gy - cy) / max(1e-4, bh / 2.0)) ** 2)
            m = np.clip((1.0 - rr) / f, 0.0, 1.0)
        elif shape == "linear":
            u = (gx - x0) / max(1e-4, bw)
            m = np.clip(u / f, 0.0, 1.0) * np.clip((1.0 - u) / f, 0.0, 1.0)
        else:
            m = np.minimum(
                np.minimum(np.clip((gx - x0) / f, 0.0, 1.0), np.clip((x0 + bw - gx) / f, 0.0, 1.0)),
                np.minimum(np.clip((gy - y0) / f, 0.0, 1.0), np.clip((y0 + bh - gy) / f, 0.0, 1.0)),
            )
        kept = float(np.mean(m))
        alpha *= m

    out = Image.fromarray(np.dstack([arr, np.clip(alpha, 0, 1) * 255.0]).astype(np.uint8), "RGBA")
    out.save(a.out)
    try:
        os.remove(tmp)
    except OSError:
        pass
    print(json.dumps({"success": True, "width": w, "height": h, "kept": round(kept, 3),
                      "chroma": bool(chroma.get("on")), "mask": shape, "out": a.out}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
