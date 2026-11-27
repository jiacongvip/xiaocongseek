#!/usr/bin/env python3
"""Chrome CDP page-media downloader (Douyin).

Capture separate video/audio streams observed during normal page playback,
Range-download, ffmpeg -c copy, cover @3s.

Fixes vs prior revision:
- Do NOT mute <video> (muted playback often skips audio segment requests).
- Listen at browser-context level; attach before navigation/seek.
- Playwright connect_over_cdp fallback to raw page-target CDP when
  Browser.setDownloadBehavior is unsupported.
- Require ffprobe-visible audio (+ duration) for exit 0.
- Never log signed media URLs.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore


def redact_url(url: str) -> str:
    try:
        u = urlparse(url)
        return f"{u.scheme}://{u.netloc}{u.path}?<redacted>"
    except Exception:
        return "<url>"


def log(msg: str) -> None:
    sys.stderr.write(msg.rstrip() + "\n")
    sys.stderr.flush()


def parse_aweme_id(url: str) -> Optional[str]:
    m = re.search(r"/video/(\d{6,})", url)
    return m.group(1) if m else None


def classify_media_response(url: str, content_type: str, status: int) -> Optional[str]:
    ct = (content_type or "").lower()
    u = urlparse(url)
    path = (u.path or "").lower()
    query = (u.query or "").lower()
    if status not in (200, 206):
        return None
    if any(x in ct for x in ("text/html", "javascript", "application/json", "image/", "text/css", "text/plain")):
        return None

    # Path/query hints FIRST: Douyin audio DASH often has Content-Type video/mp4
    # (ISO BMFF) and path also contains "/video/tos/...", so CT alone mislabels audio.
    audio_hint = any(
        h in path or h in query
        for h in (
            "media-audio",
            "media_audio",
            "audiobyte",
            "audio_bitrate",
            "mime_type=audio",
            "mimetype=audio",
            "audio=",
            "/audio/",
            "und-mp4a",
            "mp4a",
        )
    )
    video_hint = any(
        h in path or h in query
        for h in (
            "media-video",
            "media_video",
            "videobyte",
            "video_bitrate",
            "mime_type=video",
            "mimetype=video",
            "video=",
            "hvc1",
            "avc1",
        )
    )
    # Explicit media-* path wins even when both "/video/tos" and media-audio appear
    if "media-audio" in path or "media_audio" in path or "und-mp4a" in path:
        return "audio"
    if "media-video" in path or "media_video" in path:
        return "video"
    if audio_hint and not video_hint:
        return "audio"
    if video_hint and not audio_hint:
        return "video"

    # Explicit content-types (after path — fMP4 audio may be video/mp4)
    if ct.startswith("audio/") or "audio/mp4" in ct or "audio/aac" in ct:
        return "audio"
    if ct.startswith("video/") and not audio_hint:
        return "video"

    segs = [s for s in path.split("/") if s]
    if any(s == "audio" or s.startswith("audio") for s in segs):
        return "audio"
    if "video" in segs and (path.endswith(".mp4") or ct.startswith("video/")) and not audio_hint:
        return "video"
    return None


def length_from_headers(headers: Dict[str, str]) -> int:
    length = 0
    cl = headers.get("content-length") or headers.get("Content-Length")
    cr = headers.get("content-range") or headers.get("Content-Range") or ""
    if cl and str(cl).isdigit():
        length = int(cl)
    m = re.search(r"/(\d+)$", cr)
    if m:
        length = max(length, int(m.group(1)))
    return length


def make_media_http_client():
    """Direct CDN fetch. trust_env=False: httpx parses NO_PROXY IPv6 `[::1]` as port `:1]`."""
    if httpx is None:
        raise RuntimeError("httpx_missing")
    return httpx.AsyncClient(follow_redirects=True, timeout=120.0, trust_env=False)


async def fetch_full_body(url: str, headers: Dict[str, str], dest: Path) -> int:
    if httpx is None:
        raise RuntimeError("httpx_missing")
    allow = {"user-agent", "referer", "origin", "accept", "accept-encoding", "cookie"}
    fwd = {k: v for k, v in headers.items() if k.lower() in allow and v}
    if not any(k.lower() == "user-agent" for k in fwd):
        fwd["User-Agent"] = "Mozilla/5.0"
    if not any(k.lower() == "referer" for k in fwd):
        fwd["Referer"] = "https://www.douyin.com/"

    total = None
    async with make_media_http_client() as client:
        h = dict(fwd)
        h["Range"] = "bytes=0-0"
        r = await client.get(url, headers=h)
        if r.status_code in (200, 206):
            cr = r.headers.get("Content-Range") or ""
            m = re.search(r"/(\d+)$", cr)
            if m:
                total = int(m.group(1))
            elif r.status_code == 200 and r.headers.get("Content-Length"):
                total = int(r.headers["Content-Length"])
        if total is None:
            r2 = await client.get(url, headers=fwd)
            r2.raise_for_status()
            dest.write_bytes(r2.content)
            return len(r2.content)

        chunk = 2 * 1024 * 1024
        written = 0
        with dest.open("wb") as f:
            while written < total:
                end = min(written + chunk - 1, total - 1)
                hh = dict(fwd)
                hh["Range"] = f"bytes={written}-{end}"
                rr = await client.get(url, headers=hh)
                if rr.status_code not in (200, 206):
                    raise RuntimeError(f"media_fetch_http_{rr.status_code}")
                if not rr.content:
                    break
                f.write(rr.content)
                written += len(rr.content)
        return written


class CaptureBag:
    def __init__(self) -> None:
        self.captured: Dict[str, Dict[str, Any]] = {}
        self.seen = 0

    def consider(self, url: str, headers: Dict[str, str], status: int, req_headers: Optional[Dict[str, str]] = None) -> None:
        ct = headers.get("content-type") or headers.get("Content-Type") or ""
        kind = classify_media_response(url, ct, status)
        if not kind:
            return
        length = length_from_headers(headers)
        self.seen += 1
        prev = self.captured.get(kind)
        if kind == "video" and prev and "audio" not in self.captured and (url or "") != (prev.get("url") or ""):
            # Second DASH URL often is audio with Content-Type video/mp4; keep the other stream.
            if length > (prev.get("length") or 0):
                self.captured["audio"] = prev
                log(f"stage=keep_prev_as_audio bytes~{prev.get('length') or 0}")
                prev = None
            elif length > 0:
                kind = "audio"
                prev = self.captured.get("audio")
                log(f"stage=promote_new_as_audio bytes~{length}")
        if prev and prev.get("length", 0) >= length and length > 0:
            return
        if length == 0 and prev:
            return
        self.captured[kind] = {
            "url": url,
            "headers": dict(req_headers or {}),
            "length": length,
            "content_type": ct,
            "status": status,
        }
        log(f"stage=capture kind={kind} status={status} bytes~{length} url={redact_url(url)}")


async def run_with_playwright(url: str, out_dir: Path, cdp: str, wait_s: float) -> int:
    from playwright.async_api import async_playwright

    bag = CaptureBag()
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(cdp)
        context = browser.contexts[0] if browser.contexts else await browser.new_context()

        def on_response(resp) -> None:
            try:
                req_headers = {}
                try:
                    req_headers = dict(resp.request.headers)
                except Exception:
                    pass
                bag.consider(resp.url, dict(resp.headers or {}), resp.status, req_headers)
            except Exception as e:
                log(f"stage=capture_err {type(e).__name__}")

        context.on("response", on_response)
        page = None
        for pg in context.pages:
            if "douyin.com" in (pg.url or "") and "/video/" in (pg.url or ""):
                page = pg
                break
        if page is None:
            page = await context.new_page()
        page.on("response", on_response)

        log("stage=goto")
        await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        await asyncio.sleep(1.0)

        if await _blocked(page):
            return 41 if await _captcha_visible(page) else 42

        # NEVER mute — muted play often omits audio segments
        await page.evaluate(
            """async () => {
              const v = document.querySelector('video');
              if (!v) return 'no-video';
              v.muted = false;
              v.volume = 1;
              try { await v.play(); } catch (e) {}
              return {muted: v.muted, ready: v.readyState};
            }"""
        )
        log("stage=play_unmuted")

        deadline = time.time() + wait_s
        seeks = [2, 8, 20, 35, 50, 65]
        si = 0
        while time.time() < deadline:
            if "video" in bag.captured and "audio" in bag.captured:
                break
            if si < len(seeks) and time.time() > (deadline - wait_s) + seeks[si]:
                pos = seeks[si]
                si += 1
                try:
                    await page.evaluate(
                        f"""() => {{
                          const v = document.querySelector('video');
                          if (!v) return;
                          v.muted = false; v.volume = 1;
                          if (v.duration && v.duration > {pos}) v.currentTime = {pos};
                          v.play?.();
                        }}"""
                    )
                    log(f"stage=seek pos={pos}")
                except Exception:
                    pass
            await asyncio.sleep(0.4)

        return await _finish(bag, out_dir, parse_aweme_id(url) or "unknown")


async def run_with_raw_cdp(url: str, out_dir: Path, cdp_http: str, wait_s: float) -> int:
    """Browser-level CDP via /json/version websocket.

    Chrome may return empty /json/list; use Target.createTarget + attachToTarget.
    Uses the already-running debug Chrome (profile session) without reading cookie files.
    """
    import urllib.request

    bag = CaptureBag()
    version = json.loads(urllib.request.urlopen(cdp_http.rstrip("/") + "/json/version", timeout=3).read().decode())
    browser_ws = version.get("webSocketDebuggerUrl")
    if not browser_ws:
        log("stage=raw_cdp_no_browser_ws")
        return 32
    try:
        import websockets
    except ImportError:
        log("stage=websockets_missing")
        return 32

    req_hdr_cache: Dict[str, Dict[str, str]] = {}

    async def call(ws, method: str, params: Optional[dict] = None, session_id: Optional[str] = None) -> dict:
        if not hasattr(call, "mid"):
            call.mid = 0  # type: ignore
        call.mid += 1  # type: ignore
        req_id = call.mid  # type: ignore
        msg: Dict[str, Any] = {"id": req_id, "method": method, "params": params or {}}
        if session_id:
            msg["sessionId"] = session_id
        await ws.send(json.dumps(msg))
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=10)
            ev = json.loads(raw)
            # session events for network
            if "method" in ev and ev.get("method", "").startswith("Network."):
                _handle_network_event(ev, bag, req_hdr_cache)
            if ev.get("id") == req_id:
                if "error" in ev:
                    raise RuntimeError(str(ev["error"])[:200])
                return ev.get("result") or {}

    def _handle_network_event(ev: dict, bag: CaptureBag, req_hdr_cache: Dict[str, Dict[str, str]]) -> None:
        method = ev.get("method")
        params = ev.get("params") or {}
        if method == "Network.requestWillBeSent":
            req = params.get("request") or {}
            rid = params.get("requestId")
            if rid:
                req_hdr_cache[rid] = {k: str(v) for k, v in (req.get("headers") or {}).items()}
        elif method == "Network.responseReceived":
            resp = params.get("response") or {}
            rid = params.get("requestId")
            headers = {k: str(v) for k, v in (resp.get("headers") or {}).items()}
            bag.consider(resp.get("url") or "", headers, int(resp.get("status") or 0), req_hdr_cache.get(rid or "", {}))

    log("stage=raw_cdp_connect_browser")
    async with websockets.connect(browser_ws, max_size=16 * 1024 * 1024) as ws:
        # Prefer existing page target if any; else create
        targets = (await call(ws, "Target.getTargets")).get("targetInfos") or []
        page_tid = None
        for info in targets:
            if info.get("type") == "page" and "douyin.com/video" in (info.get("url") or ""):
                page_tid = info.get("targetId")
                break
        if not page_tid:
            for info in targets:
                if info.get("type") == "page":
                    page_tid = info.get("targetId")
                    break
        if not page_tid:
            page_tid = (await call(ws, "Target.createTarget", {"url": "about:blank"})).get("targetId")
            log("stage=created_target")
        attach = await call(ws, "Target.attachToTarget", {"targetId": page_tid, "flatten": True})
        session_id = attach.get("sessionId")
        if not session_id:
            log("stage=attach_failed")
            return 32
        log("stage=attached")

        await call(ws, "Network.enable", session_id=session_id)
        await call(ws, "Page.enable", session_id=session_id)
        await call(ws, "Runtime.enable", session_id=session_id)
        await call(ws, "Page.navigate", {"url": url}, session_id=session_id)
        log("stage=goto")

        deadline = time.time() + wait_s
        unmuted = False
        seeks_done = set()
        while time.time() < deadline:
            # drain events with short timeout while also issuing commands occasionally
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.35)
                ev = json.loads(raw)
                if "method" in ev:
                    _handle_network_event(ev, bag, req_hdr_cache)
            except asyncio.TimeoutError:
                pass

            if not unmuted and time.time() > deadline - wait_s + 2.5:
                unmuted = True
                expr = "(function(){var v=document.querySelector('video'); if(!v) return 'no'; v.muted=false; v.volume=1; var p=v.play(); return 'ok';})()"
                try:
                    await call(ws, "Runtime.evaluate", {"expression": expr, "awaitPromise": False}, session_id=session_id)
                    log("stage=play_unmuted")
                except Exception as e:
                    log(f"stage=play_eval_err {type(e).__name__}")

            for pos in (2, 8, 20, 35, 50, 65):
                mark = f"s{pos}"
                if mark in seeks_done:
                    continue
                if time.time() > deadline - wait_s + pos:
                    seeks_done.add(mark)
                    expr = (
                        f"(function(){{var v=document.querySelector('video'); if(!v) return;"
                        f"v.muted=false; v.volume=1; if(v.duration>{pos}) v.currentTime={pos}; v.play();}})()"
                    )
                    try:
                        await call(ws, "Runtime.evaluate", {"expression": expr}, session_id=session_id)
                        log(f"stage=seek pos={pos}")
                    except Exception:
                        pass
            if "video" in bag.captured and "audio" in bag.captured:
                log("stage=both_streams_captured")
                break

    return await _finish(bag, out_dir, parse_aweme_id(url) or "unknown")


async def _blocked(page) -> bool:
    try:
        body = await page.locator("body").inner_text(timeout=2500)
    except Exception:
        body = ""
    return bool(re.search(r"请先登录|登录后查看|网络繁忙|账号被|无法观看", body or ""))


async def _captcha_visible(page) -> bool:
    try:
        return bool(
            await page.evaluate(
                """() => {
                  const nodes = [...document.querySelectorAll('iframe, [class*=captcha], [id*=captcha], [class*=verify]')];
                  for (const n of nodes) {
                    const r = n.getBoundingClientRect();
                    if (r.width > 120 && r.height > 120 && r.bottom > 0 && r.top < innerHeight) return true;
                  }
                  return /请完成验证|滑动验证|安全验证/.test(document.body?.innerText || '');
                }"""
            )
        )
    except Exception:
        return False


def _probe_mp4(mp4: Path) -> dict:
    pr = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "stream=codec_type,codec_name,duration",
            "-show_entries", "format=duration,size",
            "-of", "json", str(mp4),
        ],
        capture_output=True,
        text=True,
    )
    try:
        return json.loads(pr.stdout or "{}")
    except Exception:
        return {}


def _write_cover(mp4: Path, cover: Path) -> bool:
    proc = subprocess.run(
        ["ffmpeg", "-y", "-ss", "3", "-i", str(mp4), "-frames:v", "1", str(cover)],
        capture_output=True,
        text=True,
    )
    if proc.returncode == 0 and cover.exists():
        return True
    proc2 = subprocess.run(
        ["ffmpeg", "-y", "-i", str(mp4), "-frames:v", "1", str(cover)],
        capture_output=True,
        text=True,
    )
    return proc2.returncode == 0 and cover.exists()


async def _finish(bag: CaptureBag, out_dir: Path, aweme: str) -> int:
    if "video" not in bag.captured:
        log(f"stage=no_video_stream_captured seen={bag.seen}")
        return 43

    video_path = out_dir / "video.stream"
    audio_path = out_dir / "audio.stream"
    has_audio_url = "audio" in bag.captured
    (out_dir / "streams.json").write_text(
        json.dumps(
            {"video": "video.stream", "audio": "audio.stream" if has_audio_url else None, "seen": bag.seen},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    if not has_audio_url:
        log(f"stage=no_audio_stream_captured seen={bag.seen} has_video=1")

    log("stage=download_video")
    try:
        vsz = await fetch_full_body(bag.captured["video"]["url"], bag.captured["video"]["headers"], video_path)
    except Exception as e:
        log(f"stage=video_fetch_failed {type(e).__name__}")
        return 47
    log(f"stage=video_saved bytes={vsz}")

    if has_audio_url:
        log("stage=download_audio")
        try:
            asz = await fetch_full_body(bag.captured["audio"]["url"], bag.captured["audio"]["headers"], audio_path)
            log(f"stage=audio_saved bytes={asz}")
        except Exception as e:
            log(f"stage=audio_fetch_failed {type(e).__name__}")
            has_audio_url = False

    bag.captured.clear()
    mp4 = out_dir / "video.mp4"
    cover = out_dir / "cover.jpg"
    if has_audio_url and audio_path.exists():
        log("stage=ffmpeg_merge")
        proc = subprocess.run(
            ["ffmpeg", "-y", "-i", str(video_path), "-i", str(audio_path), "-c", "copy", "-movflags", "+faststart", str(mp4)],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            err = re.sub(r"https?://\S+", "<url>", (proc.stderr or "")[-500:])
            log("stage=ffmpeg_failed_try_video_only")
            log(err)
            has_audio_url = False

    if not mp4.exists():
        log("stage=ffmpeg_video_only")
        proc = subprocess.run(
            ["ffmpeg", "-y", "-i", str(video_path), "-c", "copy", "-movflags", "+faststart", str(mp4)],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0 or not mp4.exists():
            log("stage=ffmpeg_failed")
            return 44

    log("stage=cover")
    if not _write_cover(mp4, cover):
        log("stage=cover_failed")
        return 45

    meta = _probe_mp4(mp4)
    streams = meta.get("streams") or []
    has_v = any(s.get("codec_type") == "video" for s in streams)
    has_a = any(s.get("codec_type") == "audio" for s in streams)
    a_dur = 0.0
    v_dur = 0.0
    for s in streams:
        try:
            d = float(s.get("duration") or 0)
        except Exception:
            d = 0.0
        if s.get("codec_type") == "audio":
            a_dur = max(a_dur, d)
        if s.get("codec_type") == "video":
            v_dur = max(v_dur, d)
    fmt_dur = float((meta.get("format") or {}).get("duration") or 0)
    complete = has_v and has_a and a_dur >= 1.0 and (v_dur >= 1.0 or fmt_dur >= 1.0)
    playable = has_v and (v_dur >= 1.0 or fmt_dur >= 1.0)
    result = {
        "ok": complete,
        "awemeId": aweme,
        "video": str(mp4),
        "cover": str(cover),
        "videoBytes": mp4.stat().st_size,
        "coverBytes": cover.stat().st_size if cover.exists() else 0,
        "hasVideo": has_v,
        "hasAudio": has_a,
        "audioDuration": a_dur,
        "videoDuration": v_dur or fmt_dur,
        "ffprobe": {"streams": [{"codec_type": s.get("codec_type"), "codec_name": s.get("codec_name"), "duration": s.get("duration")} for s in streams]},
    }
    (out_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: result[k] for k in ("ok", "awemeId", "videoBytes", "coverBytes", "hasAudio", "hasVideo", "audioDuration", "videoDuration")}))
    log(f"stage=done ok={complete} a_dur={a_dur:.2f} v_dur={(v_dur or fmt_dur):.2f}")
    if complete:
        return 0
    if playable:
        log("stage=video_only_imported")
        return 48
    return 46


async def run(url: str, out_dir: Path, cdp: str, wait_s: float) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    aweme = parse_aweme_id(url) or "unknown"
    log(f"stage=start aweme={aweme} cdp={cdp} out={out_dir}")
    try:
        return await run_with_playwright(url, out_dir, cdp, wait_s)
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        short = msg.splitlines()[0][:180]
        log(f"stage=playwright_failed {short}")
        if "InvalidURL" in msg or "Invalid port" in msg or "httpx" in msg.lower():
            log("stage=media_fetch_failed")
            return 47
        if "setDownloadBehavior" in msg or "context management" in msg or "connect_over_cdp" in msg:
            log("stage=fallback_raw_cdp")
            return await run_with_raw_cdp(url, out_dir, cdp, wait_s)
        log("stage=worker_failed")
        return 47


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--cdp", default="http://127.0.0.1:9222")
    ap.add_argument("--wait-s", type=float, default=50.0)
    args = ap.parse_args()
    if not args.url.startswith("https://www.douyin.com/") and "v.douyin.com" not in args.url:
        log("stage=reject_url")
        return 20
    out = Path(args.out_dir).resolve()
    if "video_analysis/7702542138755534090" in str(out):
        log("stage=refuse_overwrite_success_artifact")
        return 21
    if httpx is None:
        log("stage=httpx_missing")
        return 32
    return asyncio.run(run(args.url, out, args.cdp, args.wait_s))


if __name__ == "__main__":
    raise SystemExit(main())
