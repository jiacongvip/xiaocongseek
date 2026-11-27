#!/usr/bin/env python3
"""Read-only official-page DOM runner for personal inbox / comment patrol.

Reuses the isolated Playwright runtime and an existing official login session
file path. This process:

- never parses cookie/token JSON itself (Playwright may load storage_state from
  the provided path when live sampling is explicitly enabled)
- never sends, fills, or clicks a send control
- never attaches network/response listeners or calls private APIs
- never reads hidden application state
- never launches a live browser unless --allow-live-dom is set AND
  PUBLISH_STUDIO_INBOX_LIVE_DOM=1

Default --mode dry only checks the official URL allowlist and whether a session
file exists (existence only). It does not open a page.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse


FORBIDDEN_HOST_FRAGMENTS = ("MediaPublishPlatform", "cookiesFile")
LIVE_ENV = "PUBLISH_STUDIO_INBOX_LIVE_DOM"
COMMENT_TAB = "评论和@"


def apply_runtime_env():
    try:
        from runtime_env import browsers_path, load_status

        st = load_status()
        bp = browsers_path()
        if bp.exists():
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(bp)
        return st
    except Exception:
        return None


def emit(payload: dict, code: int = 0) -> int:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    return code


def load_contract() -> dict:
    path = Path(__file__).with_name("inbox-page-contract.json")
    return json.loads(path.read_text(encoding="utf-8"))


def platform_entry(platform: str) -> dict:
    return (load_contract().get("platforms") or {}).get(platform) or {}


def official_url(entry: dict, channel: str, override: str = "") -> str:
    if override:
        return override
    if channel == "comments":
        return str(entry.get("commentsPage") or "")
    return str(entry.get("inboxPage") or "")


def host_allowed(url: str, hosts: list[str]) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return bool(host) and any(host == h or host.endswith("." + h) for h in hosts)


def session_exists(path: str) -> bool:
    if not path:
        return False
    candidate = Path(path)
    return candidate.is_file()


def refuse_geo(path: str) -> bool:
    normalized = (path or "").replace("\\", "/")
    return any(frag in normalized for frag in FORBIDDEN_HOST_FRAGMENTS)


def live_permitted(args) -> bool:
    return bool(args.allow_live_dom) and os.environ.get(LIVE_ENV, "") == "1"


def dry_result(args, entry: dict, url: str, reason: str, status: str) -> int:
    storage_present = session_exists(args.storage_file)
    return emit({
        "ok": False,
        "status": status,
        "claimedRead": False,
        "liveLaunched": False,
        "evidenceSource": "not_run",
        "verifyEntry": True,
        "runnerConfigured": True,
        "sessionPresent": storage_present,
        "liveEnabled": False,
        "officialUrl": url,
        "platform": args.platform,
        "channel": args.channel,
        "reason": reason,
        "htmlFile": "",
        "finalUrl": "",
        "obstacleHint": "none",
    })


def maybe_click_comment_tab(page) -> None:
    """Read-path only: switch to the official 评论和@ tab when present."""
    try:
        loc = page.locator(".reds-tab-item")
        count = loc.count()
        for i in range(count):
            text = (loc.nth(i).inner_text() or "").strip()
            if text == COMMENT_TAB:
                loc.nth(i).click(timeout=3000)
                page.wait_for_timeout(300)
                return
    except Exception:
        return


def live_run(args, entry: dict, url: str) -> int:
    if refuse_geo(args.storage_file or "") or refuse_geo(args.html_file or ""):
        return emit({
            "ok": False,
            "status": "stopped",
            "claimedRead": False,
            "liveLaunched": False,
            "evidenceSource": "not_run",
            "reason": "拒绝使用原始 GEO 或 Cookie 目录。",
            "verifyEntry": True,
            "runnerConfigured": True,
        }, 9)

    hosts = entry.get("allowHosts") or []
    if not url or not hosts or not host_allowed(url, hosts):
        return emit({
            "ok": False,
            "status": "stopped",
            "claimedRead": False,
            "liveLaunched": False,
            "evidenceSource": "not_run",
            "reason": "页面地址不在已允许的官方域名内，已停止。",
            "verifyEntry": True,
            "runnerConfigured": True,
            "obstacleHint": "blocked",
        })

    if not session_exists(args.storage_file):
        return emit({
            "ok": False,
            "status": "pending_verification",
            "claimedRead": False,
            "liveLaunched": False,
            "evidenceSource": "not_run",
            "clerkStatus": "未登录",
            "sessionPresent": False,
            "verifyEntry": True,
            "runnerConfigured": True,
            "reason": "还没有可用的官方登录会话，不能打开该页。不会假装已核对。",
            "officialUrl": url,
        })

    apply_runtime_env()
    try:
        import importlib.util

        if importlib.util.find_spec("playwright") is None:
            return emit({
                "ok": False,
                "status": "pending_verification",
                "claimedRead": False,
                "liveLaunched": False,
                "evidenceSource": "not_run",
                "verifyEntry": True,
                "runnerConfigured": True,
                "reason": "缺少隔离运行时中的 playwright，不能做实页采样。不会回退原GEO。",
                "officialUrl": url,
            }, 4)
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        return emit({
            "ok": False,
            "status": "pending_verification",
            "claimedRead": False,
            "liveLaunched": False,
            "evidenceSource": "not_run",
            "verifyEntry": True,
            "runnerConfigured": True,
            "reason": f"无法加载 Playwright：{exc}",
            "officialUrl": url,
        }, 4)

    timeout_ms = int(args.timeout_sec) * 1000
    html_out = Path(args.html_file) if args.html_file else None
    if html_out:
        html_out.parent.mkdir(parents=True, exist_ok=True)

    # Playwright's bundled node rejects inherited NODE_OPTIONS like --use-system-ca and
    # exits silently; strip them before the driver starts.
    for _key in ("NODE_OPTIONS", "NODE_EXTRA_CA_CERTS"):
        os.environ.pop(_key, None)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        context = browser.new_context(storage_state=args.storage_file)
        page = context.new_page()
        # Intentionally no request/response/route listeners.
        page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        if args.channel == "comments" and args.platform == "xiaohongshu":
            maybe_click_comment_tab(page)
        page.wait_for_timeout(800)
        final_url = page.url or url
        html = page.content()
        context.close()
        browser.close()

    if html_out:
        html_out.write_text(html, encoding="utf-8")

    obstacle = "none"
    lowered = html
    if "验证码" in lowered or "安全验证" in lowered or "滑动验证" in lowered:
        obstacle = "captcha"
    elif "请先登录" in lowered or "扫码登录" in lowered or "登录已过期" in lowered:
        obstacle = "login_wall"
    if "/login" in (urlparse(final_url).path or "") or "passport" in final_url:
        obstacle = "login_wall"

    return emit({
        "ok": True,
        "status": "sampled",
        "claimedRead": False,
        "liveLaunched": True,
        "evidenceSource": "live_page",
        "verifyEntry": True,
        "runnerConfigured": True,
        "sessionPresent": True,
        "officialUrl": url,
        "finalUrl": final_url,
        "htmlFile": str(html_out) if html_out else "",
        "obstacleHint": obstacle,
        "platform": args.platform,
        "channel": args.channel,
        "reason": "已完成只读官方页采样，尚未解析为已验证。",
    })


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Read-only official inbox/comment page runner")
    ap.add_argument("--platform", required=True)
    ap.add_argument("--channel", choices=["messages", "comments"], default="messages")
    ap.add_argument("--space-id", default="")
    ap.add_argument("--binding-id", default="")
    ap.add_argument("--page-url", default="")
    ap.add_argument("--storage-file", default="")
    ap.add_argument("--html-file", default="")
    ap.add_argument("--mode", choices=["dry", "live"], default="dry")
    ap.add_argument("--allow-live-dom", action="store_true")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--timeout-sec", type=int, default=45)
    args = ap.parse_args(argv)

    for path in (args.storage_file, args.html_file):
        if path and refuse_geo(path):
            return emit({"ok": False, "status": "stopped", "reason": "拒绝使用原始 GEO 或 Cookie 目录。", "liveLaunched": False, "evidenceSource": "not_run"}, 9)

    entry = platform_entry(args.platform)
    if not entry:
        return emit({
            "ok": False,
            "status": "unsupported",
            "claimedRead": False,
            "liveLaunched": False,
            "evidenceSource": "not_run",
            "reason": "这个平台没有可映射的官方页。",
            "verifyEntry": False,
        })

    url = official_url(entry, args.channel, args.page_url)
    hosts = entry.get("allowHosts") or []
    if not url:
        return emit({
            "ok": False,
            "status": "not_configured",
            "claimedRead": False,
            "liveLaunched": False,
            "evidenceSource": "not_run",
            "reason": "该通道还没有官方页地址。",
            "verifyEntry": False,
            "runnerConfigured": True,
        })
    if hosts and not host_allowed(url, hosts):
        return emit({
            "ok": False,
            "status": "stopped",
            "claimedRead": False,
            "liveLaunched": False,
            "evidenceSource": "not_run",
            "reason": "页面地址不在已允许的官方域名内，已停止。",
            "obstacleHint": "blocked",
            "verifyEntry": True,
            "runnerConfigured": True,
        })

    if args.mode == "dry" or not live_permitted(args):
        storage_present = session_exists(args.storage_file)
        if not storage_present:
            reason = "只读核对入口已接上。还没有可用的官方登录会话，不能打开该页。本环境未做实页采样，不会记为已验证。"
            clerk = "未登录"
        else:
            reason = "只读核对入口已接上，官方登录会话文件存在。本环境未开启实页采样，不会打开网页，也不会记为已验证。"
            clerk = "待验证"
        if args.mode == "live" and not live_permitted(args):
            reason = "只读核对入口已接上，但本环境未开启实页采样开关，不会打开网页，也不会记为已验证。"
        status = "pending_verification"
        if args.platform == "xiaohongshu" and args.channel == "comments":
            status = "not_configured"
            clerk = "还不能巡查"
            reason = (
                "只读核对入口已接上。小红书通知页地址和分区标签已知，但列表条目选择器还缺许可证据，"
                "即使打开该页也不能把结果记为可巡查。本环境未做实页采样。"
            )
        return dry_result(args, entry, url, reason, status) if False else emit({
            "ok": False,
            "status": status,
            "claimedRead": False,
            "liveLaunched": False,
            "evidenceSource": "not_run",
            "verifyEntry": True,
            "runnerConfigured": True,
            "sessionPresent": storage_present,
            "liveEnabled": False,
            "clerkStatus": clerk,
            "officialUrl": url,
            "platform": args.platform,
            "channel": args.channel,
            "reason": reason,
            "htmlFile": "",
            "finalUrl": "",
            "obstacleHint": "none",
        })

    return live_run(args, entry, url)


if __name__ == "__main__":
    raise SystemExit(main())
