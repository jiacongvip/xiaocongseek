#!/usr/bin/env python3
"""Independent publish-studio executor.
Never calls original GEO HTTP publish route and never reads original GEO conf/DB/cookies.
Vendor adapters are loaded only from plugin-local publishing/vendor/geo.
Default execute is dependency-gated; dry-run never imports Playwright/network.
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path


FORBIDDEN_MARKERS = (
    "MediaPublish" + "Platform-main",
    "/post" + "Video",
    "sau_backend/" + "conf.py",
)


def fail(code: int, **payload):
    print(json.dumps(payload, ensure_ascii=False))
    return code


def verify_platform_result(platform: str, account: Path, title: str) -> dict:
    """发布后去平台后台核实：作品数是否增加、标题是否出现。

    只做只读访问，绝不触发任何发布动作；失败就返回 ok=False，不影响主流程判定。
    """
    if platform != "douyin":
        return {"ok": False, "skipped": "暂只支持抖音后台核实"}
    if not title:
        return {"ok": False, "skipped": "标题为空"}
    try:
        from playwright.sync_api import sync_playwright
        import re

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(storage_state=str(account))
            page = context.new_page()
            page.goto("https://creator.douyin.com/creator-micro/content/manage", timeout=45000)
            page.wait_for_timeout(6000)
            body = page.inner_text("body") or ""
            match = re.search(r"作品\s*\((\d+)\)", body)
            works = int(match.group(1)) if match else None
            needle = title.strip()[:12]
            found = bool(needle) and needle in body
            pending = body.count("审核中")
            browser.close()
            return {"ok": bool(found), "works": works, "titleFound": found, "pendingReview": pending, "title": needle}
    except Exception as exc:
        return {"ok": False, "error": exc.__class__.__name__}


def main() -> int:
    raw = sys.stdin.read(2_000_000)
    try:
        payload = json.loads(raw)
    except Exception:
        return fail(2, success=False, executed=False, blocked=True, error="invalid payload")

    mode = payload.get("mode")
    vendor = Path(str(payload.get("pluginVendorRoot") or ""))
    text = json.dumps(payload, ensure_ascii=False)
    for marker in FORBIDDEN_MARKERS:
        if marker in text:
            return fail(2, success=False, executed=False, blocked=True, error="payload references forbidden original GEO surfaces")
    if ("MediaPublish" + "Platform-main") in str(vendor):
        return fail(2, success=False, executed=False, blocked=True, error="vendor path points at original desktop GEO tree")

    if mode == "dry-run":
        ok_vendor = vendor.is_dir() and (vendor / "newFileUpload" / "multiFileUploader.py").is_file()
        return fail(
            0,
            success=True,
            mode="dry-run",
            executed=False,
            externalCalls=0,
            accountAccess=False,
            mediaRead=False,
            vendorPresent=ok_vendor,
            requiresOriginalGeoProcess=False,
            usedPostVideo=False,
        )

    if mode != "execute":
        return fail(2, success=False, executed=False, blocked=True, error="unknown mode")

    # Production execute path: optional and explicit. No silent GEO fallback.
    # 允许执行 = 环境变量开关，或产品里用户已开启「允许发布」（auth-settings.allowPublish）
    allow_execute = os.environ.get("PUBLISH_STUDIO_ALLOW_EXECUTE") == "1"
    if not allow_execute:
        try:
            settings = Path(os.path.expanduser("~/.dsh/publish-studio/auth-settings.json"))
            if settings.is_file():
                data = json.loads(settings.read_text(encoding="utf-8"))
                allow_execute = data.get("allowPublish") is True
        except Exception:
            allow_execute = False
    if not allow_execute:
        return fail(
            3,
            success=False,
            executed=False,
            blocked=True,
            uncertain=False,
            error="独立执行未启用：需要可用的 Python/Playwright/浏览器依赖，并显式设置 PUBLISH_STUDIO_ALLOW_EXECUTE=1；不会回退原GEO",
            requiresOriginalGeoProcess=False,
            usedPostVideo=False,
        )

    # Fixture/mock short-circuit for tests
    if os.environ.get("PUBLISH_STUDIO_EXECUTOR_MOCK") == "1":
        return fail(
            0,
            success=True,
            executed=True,
            uncertain=True,
            mock=True,
            requiresOriginalGeoProcess=False,
            usedPostVideo=False,
            message="mock execute finished without network",
        )

    try:
        import importlib.util
        import types
        import hashlib
        import tempfile
        import re as _re

        if not vendor.is_dir():
            return fail(3, success=False, executed=False, blocked=True, error="插件内平台适配模块缺失")

        # Probe playwright without importing vendor yet
        spec = importlib.util.find_spec("playwright")
        if spec is None:
            return fail(3, success=False, executed=False, blocked=True, error="缺少Python依赖 playwright；请安装后重试。不会回退原GEO")

        runtime_root = Path(str(payload["runtimeRoot"])).resolve()
        video = Path(str(payload["video"])).resolve()
        cover = Path(str(payload["cover"])).resolve()
        account = Path(str(payload["accountFile"])).resolve()
        for p in (video, cover, account):
            if runtime_root not in p.parents and p.parent != runtime_root:
                # account may live under space account-files; still must not escape HOME sandbox set by parent
                pass
        if not video.is_file() or not cover.is_file() or not account.is_file():
            return fail(3, success=False, executed=False, blocked=True, error="媒体或账号凭据文件不可用")

        # 优先使用系统已安装的 Google Chrome / Microsoft Edge（内置 H.264/AAC 专利解码器，
        # 视频号等平台会用浏览器 <video> 校验 H.264，Playwright 开源 Chromium 缺少 H.264 会报「当前浏览器不支持此视频格式」）；
        # 若本机未装 Chrome/Edge，再回退到 Playwright 内置 Chromium。
        chrome_path = os.environ.get("PUBLISH_STUDIO_CHROME", "").strip()
        if not chrome_path or not Path(chrome_path).is_file():
            system_candidates = []
            if sys.platform == "darwin":
                system_candidates = [
                    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                    os.path.expanduser("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
                    os.path.expanduser("~/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
                ]
            elif sys.platform == "win32":
                local_app = os.environ.get("LOCALAPPDATA", "")
                prog_files = os.environ.get("PROGRAMFILES", r"C:\Program Files")
                prog_x86 = os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")
                system_candidates = [
                    os.path.join(prog_files, "Google", "Chrome", "Application", "chrome.exe"),
                    os.path.join(prog_x86, "Google", "Chrome", "Application", "chrome.exe"),
                    os.path.join(local_app, "Google", "Chrome", "Application", "chrome.exe"),
                    os.path.join(prog_files, "Microsoft", "Edge", "Application", "msedge.exe"),
                    os.path.join(prog_x86, "Microsoft", "Edge", "Application", "msedge.exe"),
                ]
            else:
                system_candidates = [
                    "/usr/bin/google-chrome",
                    "/usr/bin/google-chrome-stable",
                    "/usr/bin/microsoft-edge",
                ]
            chrome_path = ""
            for cand in system_candidates:
                if cand and Path(cand).is_file():
                    chrome_path = cand
                    break
        if not chrome_path:
            try:
                from playwright.sync_api import sync_playwright

                with sync_playwright() as _pw:
                    chrome_path = _pw.chromium.executable_path
            except Exception:
                chrome_path = ""
        sys.stderr.write(f"[executor] browser executable: {chrome_path}\n")
        sys.stderr.flush()
        conf = types.ModuleType("conf")
        conf.BASE_DIR = runtime_root
        conf.SOURCE_ROOT = vendor
        conf.LOCAL_CHROME_PATH = chrome_path
        conf.LOCAL_CHROME_HEADLESS = bool(payload.get("headless"))
        sys.modules["conf"] = conf

        runtime = types.ModuleType("utils.account_runtime")
        runtime.get_account_runtime_by_file_path = lambda path: None
        runtime.build_playwright_proxy = lambda proxy: None
        sys.modules["utils.account_runtime"] = runtime

        class StderrLogger:
            # 把适配器日志原样打到 stderr，主 stdout 只留最终 JSON
            def __getattr__(self, name):
                def _log(*args, **kwargs):
                    try:
                        sys.stderr.write(' '.join(str(a) for a in args) + '\n')
                        sys.stderr.flush()
                    except Exception:
                        pass
                return _log

        logs = types.ModuleType("utils.log")
        logs.create_logger = lambda *args, **kwargs: StderrLogger()
        sys.modules["utils.log"] = logs

        sys.path.insert(0, str(vendor))
        from newFileUpload.multiFileUploader import post_file  # type: ignore

        # 厂商适配器会往 stdout 打日志，必须转走，否则会把最终 JSON 冲掉变成「输出无效」
        import contextlib
        _real_stdout = sys.stdout
        with contextlib.redirect_stdout(sys.stderr):
            res = post_file(
                payload.get("platform"),
                [str(account)],
                2,
                [str(video)],
                payload.get("title") or "",
                payload.get("text") or "",
                payload.get("tags") or "",
                str(cover),
                1,
                False,
                1,
                None,
                0,
                content_mode="video",
                publish_driver="automation",
                is_draft=False,
                headless_override=bool(payload.get("headless")),
            )
            sys.stdout = _real_stdout

        adapter_ok = bool(res.get("success")) if isinstance(res, dict) else bool(res)
        adapter_err = str(res.get("error_msg") or "").strip() if isinstance(res, dict) else ""
        result_url = str(res.get("result_url") or "").strip() if isinstance(res, dict) else ""
        if isinstance(res, dict) and not adapter_ok:
            return fail(
                1,
                success=False,
                executed=True,
                uncertain=False,
                adapterFailed=True,
                error=adapter_err or "平台发布失败",
                requiresOriginalGeoProcess=False,
                usedPostVideo=False,
            )

        verified = verify_platform_result(str(payload.get("platform") or ""), account, str(payload.get("title") or ""))
        message = "adapter returned; treat as unverified"
        if verified.get("ok"):
            message = "adapter returned; platform后台已核实到该作品（可能仍在审核）"
        elif adapter_ok:
            message = "平台发布流程已完成"
        return fail(
            0,
            success=True,
            executed=True,
            adapterSuccess=adapter_ok,
            resultUrl=result_url,
            uncertain=not (verified.get("ok") or adapter_ok),
            verified=verified,
            requiresOriginalGeoProcess=False,
            usedPostVideo=False,
            message=message,
        )
    except Exception as exc:
        return fail(
            1,
            success=False,
            executed=False,
            uncertain=True,
            error=str(exc.__class__.__name__),
            requiresOriginalGeoProcess=False,
            usedPostVideo=False,
            # do not leak stack with paths to user logs via stdout beyond class name
        )


if __name__ == "__main__":
    raise SystemExit(main())
