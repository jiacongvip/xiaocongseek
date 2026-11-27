#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Run MediaCrawler AsyncWordCloudGenerator on pre-sanitized comment contents.

Reuses MC tools/words.py (jieba + WordCloud + FONT/STOP from MC docs).
Does NOT edit MC sources, does NOT read cookies/browser_data/.env.
Input JSON: {"items":[{"content":"..."}], "out_prefix":"/abs/path/prefix"}
Only `content` is used; no author/PII fields are written to outputs.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: run_mc_wordcloud.py <job.json>", file=sys.stderr)
        return 2
    job_path = os.path.abspath(sys.argv[1])
    with open(job_path, "r", encoding="utf-8") as f:
        job = json.load(f)

    mc_root = os.path.abspath(job.get("mc_root") or os.environ.get("DH_MC_ROOT") or "")
    if not mc_root or not os.path.isdir(mc_root):
        print(json.dumps({"ok": False, "error": "mc_root missing"}), flush=True)
        return 3

    out_prefix = os.path.abspath(job["out_prefix"])
    items = job.get("items") or []
    if not isinstance(items, list) or not items:
        print(json.dumps({"ok": False, "error": "empty items"}), flush=True)
        return 4

    # Sanitize: only content strings
    data = []
    for it in items:
        if not isinstance(it, dict):
            continue
        c = it.get("content")
        if isinstance(c, str) and c.strip():
            data.append({"content": c.strip()})
    if not data:
        print(json.dumps({"ok": False, "error": "no valid content"}), flush=True)
        return 4

    os.makedirs(os.path.dirname(out_prefix), exist_ok=True)
    if mc_root not in sys.path:
        sys.path.insert(0, mc_root)
    os.chdir(mc_root)

    import config

    # Point font/stopwords at MC docs with absolute paths (reuse existing files; no download).
    stop = os.path.join(mc_root, "docs", "hit_stopwords.txt")
    font = os.path.join(mc_root, "docs", "STZHONGS.TTF")
    if not os.path.isfile(stop):
        print(json.dumps({"ok": False, "error": "stopwords missing", "path": stop}), flush=True)
        return 5
    if not os.path.isfile(font):
        print(json.dumps({"ok": False, "error": "font missing", "path": font}), flush=True)
        return 5
    config.STOP_WORDS_FILE = stop
    config.FONT_PATH = font
    config.ENABLE_GET_WORDCLOUD = True
    # Keep CUSTOM_WORDS from MC config as-is (already loaded).

    from tools.words import AsyncWordCloudGenerator

    async def _run():
        gen = AsyncWordCloudGenerator()
        await gen.generate_word_frequency_and_cloud(data, out_prefix)

    asyncio.run(_run())

    freq = out_prefix + "_word_freq.json"
    png = out_prefix + "_word_cloud.png"
    ok = os.path.isfile(freq) and os.path.getsize(freq) > 2 and os.path.isfile(png) and os.path.getsize(png) > 100
    # Strip any unexpected keys from freq file (should be word->count only)
    top = []
    if os.path.isfile(freq):
        with open(freq, "r", encoding="utf-8") as f:
            freq_obj = json.load(f)
        if isinstance(freq_obj, dict):
            top = sorted(
                ({"word": str(k), "count": int(v)} for k, v in freq_obj.items() if str(k).strip()),
                key=lambda x: x["count"],
                reverse=True,
            )[:30]
    print(
        json.dumps(
            {
                "ok": ok,
                "reusedModule": "MediaCrawler.tools.words.AsyncWordCloudGenerator",
                "commentCount": len(data),
                "freqFile": freq if os.path.isfile(freq) else None,
                "pngFile": png if os.path.isfile(png) else None,
                "freqBytes": os.path.getsize(freq) if os.path.isfile(freq) else 0,
                "pngBytes": os.path.getsize(png) if os.path.isfile(png) else 0,
                "topWords": top[:15],
                "notAiSentiment": True,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0 if ok else 6


if __name__ == "__main__":
    raise SystemExit(main())
