#!/usr/bin/env python3
"""Independent platform login runner for publish-studio.

Opens the platform's official login page in a headed Chromium (Playwright).
Success is based on reaching a logged-in creator/home URL and persisting storage_state —
closing the window alone is NOT success.

Modes:
  --mock-scenario=success|fail|expire|waiting  write status transitions without browser
  (default) real browser login when Playwright + Chromium are available

Never reads original GEO conf/DB/cookies. Writes only into the provided status/storage paths.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path


def apply_runtime_env():
    """Prefer isolated plugin runtime browsers/python packages when present."""
    try:
        from runtime_env import browsers_path, load_status, venv_python
        st = load_status()
        bp = browsers_path()
        if bp.exists():
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(bp)
        # If launched under wrong interpreter, still point browsers consistently.
        return st
    except Exception:
        return None


def write_status(path: Path, **payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    data = {"updatedAt": int(time.time() * 1000), **payload}
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def mock_run(args):
    status = Path(args.status_file)
    write_status(status, phase="starting", message="模拟登录会话已创建", bindingId=args.binding_id, platform=args.platform)
    time.sleep(0.05)
    scenario = args.mock_scenario
    if scenario == "waiting":
        write_status(status, phase="waiting_browser", message="请在浏览器完成官方登录/扫码", hasQr=False, bindingId=args.binding_id, platform=args.platform)
        return 0
    if scenario == "fail":
        write_status(status, phase="failed", message="模拟：登录失败或用户取消", bindingId=args.binding_id, platform=args.platform)
        return 2
    if scenario == "expire":
        write_status(status, phase="expired", message="模拟：登录超时过期", bindingId=args.binding_id, platform=args.platform)
        return 3
    # success path: waiting then authorized
    write_status(status, phase="waiting_browser", message="请在浏览器完成官方登录/扫码", hasQr=False, bindingId=args.binding_id, platform=args.platform)
    time.sleep(0.05)
    storage = Path(args.storage_file)
    storage.parent.mkdir(parents=True, exist_ok=True)
    storage.write_text(json.dumps({"cookies": [{"name": "mock", "value": "1", "domain": "example.invalid"}], "origins": []}), encoding="utf-8")
    os.chmod(storage, 0o600)
    write_status(
        status,
        phase="authorized",
        message="模拟：已确认登录态并保存本地授权文件",
        nickname=args.mock_nickname or "模拟账号",
        bindingId=args.binding_id,
        platform=args.platform,
        storageReady=True,
    )
    return 0


def probe_qr(page):
    """Return PNG bytes if a real QR-looking image/canvas is found; else None. Never invent."""
    try:
        loc = page.locator('img[src*="qr"], img[src*="QR"], canvas, img[alt*="二维码"], img[alt*="qr"]')
        count = loc.count()
        if count <= 0:
            return None
        handle = loc.first
        # Only accept reasonably square-ish visible boxes
        box = handle.bounding_box()
        if not box or box["width"] < 80 or box["height"] < 80:
            return None
        return handle.screenshot(type="png")
    except Exception:
        return None


def real_run(args):
    from urllib.parse import urlparse
    status = Path(args.status_file)
    write_status(status, phase="starting", message="正在检查浏览器依赖…", bindingId=args.binding_id, platform=args.platform)
    try:
        import importlib.util

        if importlib.util.find_spec("playwright") is None:
            write_status(status, phase="failed", message="缺少隔离运行时中的 playwright；请执行 node scripts/ensure-runtime.mjs。不会回退原GEO。", missing=["playwright"], bindingId=args.binding_id, platform=args.platform)
            return 4
        from playwright.sync_api import sync_playwright
    except Exception as e:
        write_status(status, phase="failed", message=f"无法加载 Playwright：{e}", bindingId=args.binding_id, platform=args.platform)
        return 4

    login_url = args.login_url
    personal_url = args.personal_url or ""
    timeout_ms = int(args.timeout_sec) * 1000
    st = apply_runtime_env()
    if st is not None and st.get("ready") is False:
        missing = list(st.get("missing") or ["runtime"])
        write_status(
            status,
            phase="failed",
            message=st.get("message") or "发布插件运行时未就绪（Playwright/Chromium）。请先完成插件安装依赖，不会假装已打开浏览器。",
            missing=missing,
            bindingId=args.binding_id,
            platform=args.platform,
            browserOpened=False,
        )
        return 4
    write_status(status, phase="starting", message="正在启动受控 Chromium（尚未打开登录页）…", hasQr=False, browserOpened=False, bindingId=args.binding_id, platform=args.platform)

    try:
        sanitize_node_env()
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(headless=False)
            except Exception as e:
                msg = str(e)
                hint = "请在插件目录执行 node scripts/ensure-runtime.mjs 安装隔离 Chromium；不会回退原GEO。"
                if "Executable doesn't exist" in msg or "chromium" in msg.lower():
                    hint = "Chromium 可执行文件不存在。" + hint
                write_status(
                    status,
                    phase="failed",
                    message=f"无法启动 Chromium：{msg[:300]}。{hint}",
                    missing=["chromium"],
                    browserOpened=False,
                    bindingId=args.binding_id,
                    platform=args.platform,
                )
                return 4
            write_status(status, phase="waiting_browser", message="已启动受控浏览器，正在打开官方登录页…", hasQr=False, browserOpened=True, bindingId=args.binding_id, platform=args.platform)
            context = browser.new_context(locale="zh-CN")
            page = context.new_page()
            page.goto(login_url, wait_until="domcontentloaded", timeout=min(60000, timeout_ms))
            write_status(status, phase="waiting_browser", message="已打开官方登录页，请在弹出的受控浏览器完成登录/扫码", hasQr=False, browserOpened=True, bindingId=args.binding_id, platform=args.platform)
            qr = probe_qr(page)
            if qr:
                qr_path = Path(args.qr_file) if args.qr_file else Path(args.status_file).with_suffix(".qr.png")
                qr_path.write_bytes(qr)
                os.chmod(qr_path, 0o600)
                write_status(status, phase="waiting_scan", message="检测到页面二维码，请扫码；仍以登录成功页为准", hasQr=True, qrFile=str(qr_path), bindingId=args.binding_id, platform=args.platform)
            deadline = time.time() + int(args.timeout_sec)
            authorized = False
            nickname = ""
            while time.time() < deadline:
                if Path(args.cancel_file).exists():
                    write_status(status, phase="cancelled", message="用户取消登录", bindingId=args.binding_id, platform=args.platform)
                    browser.close()
                    return 5
                url = page.url or ""
                # Success heuristics: left login URL host path, or matched personal host
                left_login = "login" not in url.lower() and "signin" not in url.lower() and "passport" not in url.lower()
                personal_hit = False
                if personal_url:
                    try:
                        pu = urlparse(personal_url)
                        cu = urlparse(url)
                        personal_hit = bool(pu.netloc) and pu.netloc == cu.netloc and "login" not in cu.path.lower()
                    except Exception:
                        personal_hit = personal_url.split("/")[2] in url if "://" in personal_url else False
                if personal_hit or (left_login and personal_url and urlparse_safe_host(url) == urlparse_safe_host(personal_url)):
                    # Confirm by revisiting personal page when provided
                    if personal_url:
                        try:
                            page.goto(personal_url, wait_until="domcontentloaded", timeout=30000)
                            url2 = page.url or ""
                            if "login" in url2.lower() or "signin" in url2.lower() or "passport" in url2.lower():
                                time.sleep(1.0)
                                continue
                            nickname = (page.title() or "").strip()[:80]
                        except Exception:
                            time.sleep(1.0)
                            continue
                    storage = Path(args.storage_file)
                    storage.parent.mkdir(parents=True, exist_ok=True)
                    context.storage_state(path=str(storage))
                    os.chmod(storage, 0o600)
                    write_status(
                        status,
                        phase="authorized",
                        message="已确认平台登录态并保存本地授权文件（非关闭窗口即成功）",
                        nickname=nickname or None,
                        bindingId=args.binding_id,
                        platform=args.platform,
                        storageReady=True,
                    )
                    authorized = True
                    break
                # refresh qr probe occasionally
                if int(time.time()) % 8 == 0:
                    qr = probe_qr(page)
                    if qr and args.qr_file:
                        Path(args.qr_file).write_bytes(qr)
                        write_status(status, phase="waiting_scan", message="请扫码或在浏览器完成官方登录", hasQr=True, qrFile=args.qr_file, bindingId=args.binding_id, platform=args.platform)
                time.sleep(1.0)
            browser.close()
            if not authorized:
                write_status(status, phase="expired", message="登录等待超时，未确认平台登录态", bindingId=args.binding_id, platform=args.platform)
                return 3
            return 0
    except Exception as e:
        msg = str(e)
        if "_playwright" in msg:
            # The driver exited before the handshake; python only shows this attribute error.
            msg = "浏览器驱动未能启动（Playwright driver 已退出）。常见原因是继承的 NODE_OPTIONS 含该驱动不接受的选项，或隔离运行时需重建：node scripts/ensure-runtime.mjs"
        write_status(status, phase="failed", message=f"登录执行异常：{msg}", bindingId=args.binding_id, platform=args.platform, detail=traceback.format_exc()[-500:])
        return 1


def sanitize_node_env() -> None:
    """Playwright's bundled node rejects some NODE_OPTIONS entries and dies silently.

    The host may export flags such as --use-system-ca for its own node process; those are
    inherited here and make the driver exit before the protocol handshake, which python
    reports only as "'PlaywrightContextManager' object has no attribute '_playwright'".
    Python children never need Node flags, so drop them.
    """
    for key in ("NODE_OPTIONS", "NODE_EXTRA_CA_CERTS"):
        os.environ.pop(key, None)


def urlparse_safe_host(url: str) -> str:
    try:
        from urllib.parse import urlparse

        return urlparse(url).netloc
    except Exception:
        return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--platform", required=True)
    ap.add_argument("--binding-id", required=True)
    ap.add_argument("--login-url", required=True)
    ap.add_argument("--personal-url", default="")
    ap.add_argument("--status-file", required=True)
    ap.add_argument("--storage-file", required=True)
    ap.add_argument("--qr-file", default="")
    ap.add_argument("--cancel-file", required=True)
    ap.add_argument("--timeout-sec", type=int, default=300)
    ap.add_argument("--mock-scenario", default="")
    ap.add_argument("--mock-nickname", default="")
    args = ap.parse_args()
    # Safety: refuse accidental GEO cookie dirs
    for p in (args.storage_file, args.status_file):
        if "MediaPublishPlatform" in p or "cookiesFile" in p.replace("\\", "/"):
            print("refusing GEO paths", file=sys.stderr)
            return 9
    if args.mock_scenario:
        return mock_run(args)
    return real_run(args)


if __name__ == "__main__":
    raise SystemExit(main())
