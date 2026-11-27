#!/usr/bin/env python3
"""按音量关键帧包络给 WAV 乘增益。

用法：
  audio_envelope.py --src in.wav --dst out.wav --keys '[{"at":0,"v":0.2},{"at":3,"v":1}]' [--total 10]

keys 里的 at 是时间线秒数（相对成片），v 是 0–1 的增益倍数；
两点之间线性插值，首点之前取首点值、末点之后取末点值。
"""
import argparse
import json
import wave

import numpy as np


def envelope(keys, times):
    if not keys:
        return np.ones_like(times, dtype=np.float64)
    pts = [(float(k["at"]), float(k["v"])) for k in keys if "at" in k and "v" in k]
    if not pts:
        return np.ones_like(times, dtype=np.float64)
    pts.sort(key=lambda p: p[0])
    xs = np.array([p[0] for p in pts], dtype=np.float64)
    ys = np.clip(np.array([p[1] for p in pts], dtype=np.float64), 0.0, 1.0)
    return np.interp(times, xs, ys)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--dst", required=True)
    ap.add_argument("--keys", default="[]")
    ap.add_argument("--total", type=float, default=0.0)
    a = ap.parse_args()

    keys = json.loads(a.keys or "[]")
    with wave.open(a.src, "rb") as w:
        ch = w.getnchannels()
        sr = w.getframerate()
        width = w.getsampwidth()
        frames = w.readframes(w.getnframes())
    if width != 2:
        raise SystemExit(f"只支持 16bit PCM，当前 {width * 8}bit")

    data = np.frombuffer(frames, dtype=np.int16).astype(np.float64)
    n = len(data) // ch
    times = np.arange(n, dtype=np.float64) / float(sr)
    env = envelope(keys, times)
    env = np.repeat(env, ch)
    out = np.clip(data * env, -32768, 32767).astype(np.int16)

    with wave.open(a.dst, "wb") as w:
        w.setnchannels(ch)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(out.tobytes())

    dur = n / float(sr)
    # 分段均值，方便核对包络是否真的生效
    seg = max(1, n // 6)
    peaks = []
    for i in range(0, n, seg):
        chunk = np.abs(data[i:i + seg] * env[i:i + seg])
        peaks.append(round(float(chunk.mean()) / 32768.0, 4))
    print(json.dumps({
        "success": True,
        "sample_rate": sr,
        "channels": ch,
        "duration": round(dur, 3),
        "gain_segments": peaks,
        "keys": len(keys),
        "total_hint": a.total,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
