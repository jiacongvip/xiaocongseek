#!/usr/bin/env python3
"""Dry-mode tests for the read-only official page runner.

These tests never launch a browser, never set PUBLISH_STUDIO_INBOX_LIVE_DOM,
and never read cookie JSON.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "publishing" / "inbox_dom_runner.py"
FORBIDDEN = [
    "edith.xiaohongshu.com",
    "aweme/v1/web/im",
    "you/mentions",
    "__INITIAL_STATE__",
    "notificationMap",
    "X-Bogus",
    "a_bogus",
    "click_send",
    "page.on(",
    "route(",
]


def run(*args: str, env=None) -> dict:
    proc = subprocess.run(
        [sys.executable, str(RUNNER), *args],
        check=False,
        capture_output=True,
        text=True,
        env=env or os.environ.copy(),
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout
    return json.loads(proc.stdout)


def test_forbidden_strings_absent():
    text = RUNNER.read_text(encoding="utf-8")
    for token in FORBIDDEN:
        assert token not in text, f"runner must not contain {token}"
    # Must not parse storage JSON itself.
    assert "json.loads(Path(args.storage_file)" not in text
    assert "read_text" not in text or "storage_state=" in text


def test_dry_does_not_launch():
    env = os.environ.copy()
    env.pop("PUBLISH_STUDIO_INBOX_LIVE_DOM", None)
    body = run("--platform", "douyin", "--channel", "messages", "--mode", "dry", env=env)
    assert body["liveLaunched"] is False
    assert body["claimedRead"] is False
    assert body["evidenceSource"] == "not_run"
    assert body["verifyEntry"] is True
    assert body["runnerConfigured"] is True
    assert body["officialUrl"] == "https://www.douyin.com/message"
    assert body["status"] == "pending_verification"
    assert body["clerkStatus"] == "未登录"


def test_dry_with_existing_session_file_still_not_verified(tmp_path):
    env = os.environ.copy()
    env.pop("PUBLISH_STUDIO_INBOX_LIVE_DOM", None)
    storage = tmp_path / "binding-x.storage.json"
    # Existence only; runner must not need to parse this file in dry mode.
    storage.write_text("this-is-not-json-on-purpose", encoding="utf-8")
    body = run(
        "--platform", "douyin",
        "--channel", "comments",
        "--mode", "dry",
        "--storage-file", str(storage),
        env=env,
    )
    assert body["sessionPresent"] is True
    assert body["liveLaunched"] is False
    assert body["claimedRead"] is False
    assert body["clerkStatus"] == "待验证"
    assert body["officialUrl"] == "https://creator.douyin.com/creator-micro/interactive/comment"


def test_live_without_env_stays_dry():
    env = os.environ.copy()
    env.pop("PUBLISH_STUDIO_INBOX_LIVE_DOM", None)
    body = run(
        "--platform", "xiaohongshu",
        "--channel", "messages",
        "--mode", "live",
        "--allow-live-dom",
        env=env,
    )
    assert body["liveLaunched"] is False
    assert body["evidenceSource"] == "not_run"
    assert "未开启实页采样" in body["reason"] or "未做实页采样" in body["reason"]


def test_xhs_comments_dry_not_configured():
    env = os.environ.copy()
    env.pop("PUBLISH_STUDIO_INBOX_LIVE_DOM", None)
    body = run("--platform", "xiaohongshu", "--channel", "comments", "--mode", "dry", env=env)
    assert body["status"] == "not_configured"
    assert body["clerkStatus"] == "还不能巡查"
    assert body["claimedRead"] is False
    assert body["liveLaunched"] is False
    assert body["officialUrl"] == "https://www.xiaohongshu.com/notification?type=comment"


def main() -> int:
    from tempfile import TemporaryDirectory
    from pathlib import Path as P

    tests = [
        test_forbidden_strings_absent,
        test_dry_does_not_launch,
        test_live_without_env_stays_dry,
        test_xhs_comments_dry_not_configured,
    ]
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception as exc:
            failed += 1
            print(f"FAIL {fn.__name__}: {exc}")
    try:
        with TemporaryDirectory() as d:
            test_dry_with_existing_session_file_still_not_verified(P(d))
        print("PASS test_dry_with_existing_session_file_still_not_verified")
    except Exception as exc:
        failed += 1
        print(f"FAIL test_dry_with_existing_session_file_still_not_verified: {exc}")
    total = len(tests) + 1
    if failed:
        print(f"{failed} failed")
        return 1
    print(f"PASS: inbox dom runner dry/no-live/no-private-strings ({total} tests)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
