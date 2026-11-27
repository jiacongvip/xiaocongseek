# DEPRECATED prototype: not registered or invoked by current runtime. Use original GEO formal /postVideo to preserve its authorization and cumulative ledger.
"""Private-stdin production bridge. Never accepts HTTP/AI requests, raw cookies or CLI file paths.
Authority/quota reservation, WebAuthn and company ownership are checked by the parent service.
No vendor import occurs for --check. No scheduler, GEO DB access, or existing desktop attachment.
"""
import sys
import os
import json
import time
import hashlib
import types
import importlib.util
import re
import tempfile
from urllib.parse import urlsplit, urlunsplit
from pathlib import Path


def fenced(root, path):
    base, file = Path(root).resolve(strict=True), Path(path).resolve(strict=True)
    if base not in file.parents or not file.is_file():
        raise ValueError("resource fence")
    return file


def checksum(file):
    h = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(1048576), b""):
            h.update(block)
    return h.hexdigest()


def execute(payload, emit):
    if payload.get("version") != 1 or payload.get("contentMode") != "video":
        raise ValueError("Only the connected video-pack mode is enabled; original article/image adapters remain preserved")
    scope, snapshot = payload["scope"], payload["snapshot"]
    permit = payload["authorization"]
    if not permit.get("reservationId") or min(permit.get("expiresAt", 0), payload.get("credentialExpiresAt", 0)) <= time.time() * 1000:
        raise ValueError("authorization reservation missing/expired")
    if scope["spaceId"] != snapshot["spaceId"] or scope["bindingId"] != snapshot["bindingId"] or scope["packRevision"] != snapshot["packRevision"] or scope["bindingRevision"] != snapshot["bindingRevision"] or scope["platform"] != snapshot["platform"] or scope["credentialRef"] != snapshot.get("credentialRef"):
        raise ValueError("snapshot mismatch")
    # Match Node's canonical insertion-order snapshot digest, not any client-supplied text override.
    if hashlib.sha256(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest() != scope["fingerprint"]:
        raise ValueError("snapshot digest mismatch")
    video, cover = fenced(payload["mediaRoot"], payload["video"]), fenced(payload["mediaRoot"], payload["cover"])
    account = fenced(payload["credentialRoot"], payload["accountFile"])
    if checksum(video) != snapshot["videoHash"] or checksum(cover) != snapshot["coverHash"]:
        raise ValueError("media changed")
    root = Path(payload["runtimeRoot"]).resolve(strict=True)
    vendor = Path(__file__).resolve().parent / "vendor" / "geo"
    conf = types.ModuleType("conf")
    conf.BASE_DIR, conf.SOURCE_ROOT = root, vendor
    conf.LOCAL_CHROME_PATH, conf.LOCAL_CHROME_HEADLESS = payload["chrome"], False
    sys.modules["conf"] = conf
    # Preserve upstream source but replace its implicit DB lookup with this explicit single-account lease.
    runtime = types.ModuleType("utils.account_runtime")
    def selected_account(path):
        if Path(path).resolve() != account:
            raise ValueError("unselected account")
        return None  # Independent storage-state file, no DB scan or signed-in desktop attachment.
    runtime.get_account_runtime_by_file_path = selected_account
    runtime.build_playwright_proxy = lambda proxy: None
    sys.modules["utils.account_runtime"] = runtime
    class SilentLogger:
        def __getattr__(self, name):
            return lambda *args, **kwargs: None
    logs = types.ModuleType("utils.log")
    logs.create_logger = lambda *args, **kwargs: SilentLogger()
    sys.modules["utils.log"] = logs
    sys.path.insert(0, str(vendor))
    from newFileUpload.multiFileUploader import post_file
    from newFileUpload.baseFileUploader import BaseFileUploader
    async def no_sensitive_page_dump(self, *args, **kwargs):
        return None
    BaseFileUploader.dump_toutiao_video_debug_artifacts = no_sensitive_page_dump
    # Publish immutable private copies, not files a concurrent editor may replace during upload.
    created = []
    def snapshot_input(source, expected, name):
        fd, target = tempfile.mkstemp(prefix=name, suffix=source.suffix, dir=root)
        target = Path(target)
        created.append(target)
        h = hashlib.sha256()
        with os.fdopen(fd, "wb") as output:
            descriptor = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(descriptor, "rb") as original:
                for chunk in iter(lambda: original.read(1048576), b""):
                    h.update(chunk)
                    output.write(chunk)
        if h.hexdigest() != expected:
            raise ValueError("media changed during snapshot")
        target.chmod(0o400)
        return target
    try:
        video_input = snapshot_input(video, snapshot["videoHash"], "input-video-")
        cover_input = snapshot_input(cover, snapshot["coverHash"], "input-cover-")
        if min(permit["expiresAt"], payload["credentialExpiresAt"]) <= time.time() * 1000:
            raise ValueError("dispatch authority expired")
        emit({"type": "progress"})
        result = post_file(
            platform=scope["platform"], account_file=[str(account)], file_type=2,
            files=[str(video_input)], title=snapshot["title"], text=snapshot["body"],
            tags=snapshot["topics"], thumbnail_path=str(cover_input), location="",
            enableTimer=False, content_mode="video", is_draft=False,
            publish_driver=payload["driver"], desktop_runner_id=None,
            progress_callback=lambda *args, **kwargs: emit({"type": "progress"}),
            snapshot_callback=None,
        )
    finally:
        # Only files created by this invocation; never original company media or provider credentials.
        for temporary in created:
            temporary.unlink(missing_ok=True)
    # Upstream success is heuristic. Never assert publication from it or leak result URLs/error text.
    output = {"type": "result", "kind": "unknown"}
    # A recognized public work locator may be verified by a separately configured evidence provider.
    # Editor redirects, query tokens and arbitrary remote URLs are never exposed as final proof.
    try:
        url = urlsplit(str(result.get("result_url", "")))
        hosts = {"douyin": {"www.douyin.com", "douyin.com"}, "xiaohongshu": {"www.xiaohongshu.com", "xiaohongshu.com"}, "bilibili": {"www.bilibili.com", "bilibili.com"}, "kuaishou": {"www.kuaishou.com", "kuaishou.com"}, "tencent": {"channels.weixin.qq.com"}}
        match = re.search(r"/(?:video|note|explore|short-video)/([A-Za-z0-9_-]{5,80})(?:/|$)", url.path)
        if url.scheme == "https" and not url.username and not url.password and url.hostname in hosts.get(scope["platform"], set()) and match:
            output["receipt"] = {"workId": match.group(1), "publicUrl": urlunsplit((url.scheme, url.netloc, url.path, "", ""))}
    except (AttributeError, ValueError):
        pass
    return output


def main():
    if sys.argv[1:] == ["--check"]:
        ready = all(importlib.util.find_spec(name) is not None for name in ["playwright", "requests"])
        print(json.dumps({"ready": ready, "missing": [name for name in ["playwright", "requests"] if importlib.util.find_spec(name) is None]}))
        return 0 if ready else 4
    if sys.argv[1:]:
        return 2
    wire = os.fdopen(os.dup(1), "w", buffering=1)
    def emit(value):
        wire.write(json.dumps(value, separators=(",", ":")) + "\n")
    with open(os.devnull, "w") as sink:
        os.dup2(sink.fileno(), 1)
        os.dup2(sink.fileno(), 2)
        try:
            raw = sys.stdin.read(262145)
            if len(raw) > 262144:
                raise ValueError("payload too large")
            result = execute(json.loads(raw), emit)
            emit(result)
            return 0
        except Exception:
            emit({"type": "result", "kind": "unknown"})
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
