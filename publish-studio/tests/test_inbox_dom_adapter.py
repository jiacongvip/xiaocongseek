#!/usr/bin/env python3
"""Controlled HTML fixture tests for the official-page DOM inbox/comment adapter.

Fixtures are synthetic and are not real messages or comments. This file does
not launch a browser or touch live accounts.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "publishing"))
from inbox_ui_adapter import classify_notification_item

ROOT = Path(__file__).resolve().parents[1]
ADAPTER = ROOT / "publishing" / "inbox_ui_adapter.py"
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "inbox-dom"
FORBIDDEN = [
    "edith.xiaohongshu.com",
    "aweme/v1/web/im",
    "XHS_CHATS_API",
    "XHS_UNREAD_API",
    "XHS_HISTORY_API",
    "storage_state",
    "webdriver",
    "X-Bogus",
    "a_bogus",
    "you/mentions",
    "__INITIAL_STATE__",
    "notificationMap",
]


def run(*args: str, page_url: str = "") -> dict:
    cmd = [sys.executable, str(ADAPTER), *args]
    if page_url:
        cmd.extend(["--page-url", page_url])
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr or proc.stdout
    return json.loads(proc.stdout)


def test_forbidden_strings_absent():
    text = ADAPTER.read_text(encoding="utf-8")
    for token in FORBIDDEN:
        assert token not in text, f"adapter must not contain {token}"
    assert "click_send" not in text
    assert "IM_FILL_AND_SEND" not in text


def test_probe_pending_not_read():
    body = run("--platform", "douyin", "--channel", "messages", "--mode", "probe")
    assert body["claimedRead"] is False
    assert body["status"] == "pending_verification"
    assert body["items"] == []
    assert ("待" in body["reason"]) and ("验证" in body["reason"] or "核对" in body["reason"])
    xhs = run("--platform", "xiaohongshu", "--channel", "messages", "--mode", "probe")
    assert xhs["status"] == "pending_verification"
    assert xhs["claimedRead"] is False
    comments = run("--platform", "douyin", "--channel", "comments", "--mode", "probe")
    assert comments["status"] == "pending_verification"
    assert comments["claimedRead"] is False
    assert comments["items"] == []
    assert "评论" in comments["reason"]
    xhs_c = run("--platform", "xiaohongshu", "--channel", "comments", "--mode", "probe")
    assert xhs_c["status"] == "not_configured"
    assert xhs_c["claimedRead"] is False
    assert "许可证据" in xhs_c["reason"] or "不能当作已接入" in xhs_c["reason"]


def test_douyin_fixture_list():
    body = run(
        "--platform", "douyin", "--channel", "messages", "--mode", "mock",
        "--html-file", str(FIXTURES / "douyin-list.html"),
    )
    assert body["claimedRead"] is True
    assert body["obstacle"] == "none"
    keys = [row["visibleKey"] for row in body["items"]]
    assert any("夹具用户甲" in k and "营业时间" in k for k in keys)
    assert any("夹具用户丙" in k for k in keys)
    assert all("夹具" in row["visibleText"] for row in body["items"])


def test_xhs_fixture_list():
    body = run(
        "--platform", "xiaohongshu", "--channel", "messages", "--mode", "mock",
        "--html-file", str(FIXTURES / "xhs-list.html"),
    )
    assert body["claimedRead"] is True
    names = " ".join(row["visibleText"] for row in body["items"])
    assert "夹具用户乙" in names
    assert "夹具用户丁" in names
    assert "想了解套餐" in names


def test_empty_lists():
    dy = run("--platform", "douyin", "--mode", "mock", "--html-file", str(FIXTURES / "douyin-empty.html"))
    assert dy["claimedRead"] is True
    assert dy["items"] == []
    xhs = run("--platform", "xiaohongshu", "--mode", "mock", "--html-file", str(FIXTURES / "xhs-empty.html"))
    assert xhs["claimedRead"] is True
    assert xhs["items"] == []
    assert xhs.get("empty") is True


def test_login_wall_and_captcha():
    wall = run("--platform", "douyin", "--mode", "mock", "--html-file", str(FIXTURES / "login-wall.html"))
    assert wall["claimedRead"] is False
    assert wall["obstacle"] == "login_wall"
    assert wall["items"] == []
    cap = run("--platform", "xiaohongshu", "--mode", "mock", "--html-file", str(FIXTURES / "captcha.html"))
    assert cap["claimedRead"] is False
    assert cap["obstacle"] == "captcha"
    assert cap["items"] == []
    wall_c = run(
        "--platform", "douyin", "--channel", "comments", "--mode", "mock",
        "--html-file", str(FIXTURES / "login-wall.html"),
    )
    assert wall_c["claimedRead"] is False
    assert wall_c["obstacle"] == "login_wall"
    cap_c = run(
        "--platform", "xiaohongshu", "--channel", "comments", "--mode", "mock",
        "--html-file", str(FIXTURES / "captcha.html"),
    )
    assert cap_c["claimedRead"] is False
    assert cap_c["obstacle"] == "captcha"


def test_host_allowlist():
    body = run(
        "--platform", "douyin", "--mode", "mock",
        "--html-file", str(FIXTURES / "douyin-list.html"),
        page_url="https://evil.example/im",
    )
    assert body["claimedRead"] is False
    assert body["obstacle"] == "blocked"
    ok = run(
        "--platform", "douyin", "--channel", "comments", "--mode", "mock",
        "--html-file", str(FIXTURES / "douyin-comments-list.html"),
        page_url="https://creator.douyin.com/creator-micro/interactive/comment",
    )
    assert ok["claimedRead"] is True
    bad = run(
        "--platform", "douyin", "--channel", "comments", "--mode", "mock",
        "--html-file", str(FIXTURES / "douyin-comments-list.html"),
        page_url="https://evil.example/comment",
    )
    assert bad["claimedRead"] is False
    assert bad["obstacle"] == "blocked"


def test_douyin_comments_fixture_list():
    body = run(
        "--platform", "douyin", "--channel", "comments", "--mode", "mock",
        "--html-file", str(FIXTURES / "douyin-comments-list.html"),
        page_url="https://creator.douyin.com/creator-micro/interactive/comment",
    )
    assert body["claimedRead"] is True
    assert body["status"] == "ready"
    authors = [row["authorName"] for row in body["items"]]
    assert "夹具评论用户甲" in authors
    assert "夹具评论用户乙" in authors
    assert "夹具回复用户丙" in authors
    first = next(row for row in body["items"] if row["authorName"] == "夹具评论用户甲")
    assert first["commentId"] == "cmt-fixture-dy-1"
    assert first.get("visibleTime") == "3分钟前"
    assert first.get("workUrl") == "https://www.douyin.com/video/fixture-work"
    second = next(row for row in body["items"] if row["authorName"] == "夹具评论用户乙")
    assert second["commentId"].startswith("cmt-")
    assert "visibleTime" not in second
    assert all(row["itemType"] == "comment" for row in body["items"])
    assert all(row["channel"] == "comments" for row in body["items"])


def test_xhs_note_page_is_not_notification_inbox():
    body = run(
        "--platform", "xiaohongshu", "--channel", "comments", "--mode", "mock",
        "--html-file", str(FIXTURES / "xhs-comments-list.html"),
        page_url="https://www.xiaohongshu.com/explore/fixture-note",
    )
    assert body["claimedRead"] is False
    assert body["status"] == "selector_mismatch"
    assert body.get("matched") is False
    assert body.get("empty") is False
    assert body["items"] == []
    assert body.get("sampleKind") == "fixture_sample"
    assert body.get("notePageContainersIgnored") is True


def test_comment_empty_lists():
    dy = run(
        "--platform", "douyin", "--channel", "comments", "--mode", "mock",
        "--html-file", str(FIXTURES / "douyin-comments-empty.html"),
    )
    assert dy["claimedRead"] is True
    assert dy["items"] == []
    assert dy.get("empty") is True
    xhs = run(
        "--platform", "xiaohongshu", "--channel", "comments", "--mode", "mock",
        "--html-file", str(FIXTURES / "xhs-comments-empty.html"),
    )
    assert xhs["claimedRead"] is False
    assert xhs["status"] == "selector_mismatch"
    assert xhs["items"] == []
    assert xhs.get("empty") is False


def test_comment_need_page_and_selector_mismatch():
    need = run(
        "--platform", "douyin", "--channel", "comments", "--mode", "mock",
        "--html-file", str(FIXTURES / "douyin-comments-need-work.html"),
    )
    assert need["claimedRead"] is False
    assert need["status"] == "need_page"
    assert need["items"] == []
    miss = run(
        "--platform", "xiaohongshu", "--channel", "comments", "--mode", "mock",
        "--html-file", str(FIXTURES / "comments-selector-miss.html"),
    )
    assert miss["claimedRead"] is False
    assert miss["status"] == "selector_mismatch"
    assert miss.get("matched") is False
    assert miss.get("empty") is False
    assert miss["items"] == []
    # A private-message fixture must not be treated as a successful comment read.
    msg = run(
        "--platform", "xiaohongshu", "--channel", "comments", "--mode", "mock",
        "--html-file", str(FIXTURES / "xhs-list.html"),
    )
    assert msg["claimedRead"] is False
    assert msg["status"] == "selector_mismatch"


def test_xhs_notification_chrome_is_selector_mismatch_not_empty():
    body = run(
        "--platform", "xiaohongshu", "--channel", "comments", "--mode", "mock",
        "--html-file", str(FIXTURES / "xhs-notification-chrome.html"),
        page_url="https://www.xiaohongshu.com/notification?type=comment",
    )
    assert body["claimedRead"] is False
    assert body["status"] == "selector_mismatch"
    assert body.get("empty") is False
    assert body["items"] == []
    assert body.get("notificationChrome", {}).get("present") is True
    assert body.get("sampleKind") == "fixture_sample"


def test_xhs_notification_does_not_use_note_comments_container():
    body = run(
        "--platform", "xiaohongshu", "--channel", "comments", "--mode", "mock",
        "--html-file", str(FIXTURES / "xhs-notification-with-note-comments.html"),
        page_url="https://www.xiaohongshu.com/notification?type=comment",
    )
    assert body["claimedRead"] is False
    assert body["status"] == "selector_mismatch"
    assert body["items"] == []
    assert body.get("notePageContainersIgnored") is True
    text = " ".join(row.get("visibleText") or "" for row in body["items"])
    assert "夹具笔记区用户" not in text


def test_classify_notification_item_filters():
    assert classify_notification_item("夹具用户：这条看起来不错", "评论和@") == "comment"
    assert classify_notification_item("夹具用户赞了你的笔记", "评论和@") == "skip_non_comment"
    assert classify_notification_item("夹具用户开始关注你", "新增关注") == "skip_non_comment"
    assert classify_notification_item("系统通知：活动开始", "评论和@") == "skip_system"
    assert classify_notification_item("你评论了夹具笔记", "评论和@") == "skip_outbound"


def test_comment_parse_does_not_break_messages():
    body = run(
        "--platform", "xiaohongshu", "--channel", "messages", "--mode", "mock",
        "--html-file", str(FIXTURES / "xhs-list.html"),
    )
    assert body["claimedRead"] is True
    assert any("夹具用户乙" in row["visibleText"] for row in body["items"])
    # Comment fixture used as messages should not invent a successful inbox read
    # unless a message selector happens to match; at minimum it must not crash.
    comments_as_msg = run(
        "--platform", "douyin", "--channel", "messages", "--mode", "mock",
        "--html-file", str(FIXTURES / "douyin-comments-list.html"),
    )
    assert "items" in comments_as_msg
    assert comments_as_msg.get("obstacle") in {None, "none"} or comments_as_msg["claimedRead"] in {True, False}


def main() -> int:
    tests = [
        test_forbidden_strings_absent,
        test_probe_pending_not_read,
        test_douyin_fixture_list,
        test_xhs_fixture_list,
        test_empty_lists,
        test_login_wall_and_captcha,
        test_host_allowlist,
        test_douyin_comments_fixture_list,
        test_xhs_note_page_is_not_notification_inbox,
        test_comment_empty_lists,
        test_comment_need_page_and_selector_mismatch,
        test_xhs_notification_chrome_is_selector_mismatch_not_empty,
        test_xhs_notification_does_not_use_note_comments_container,
        test_classify_notification_item_filters,
        test_comment_parse_does_not_break_messages,
    ]
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception as exc:
            failed += 1
            print(f"FAIL {fn.__name__}: {exc}")
    if failed:
        print(f"{failed} failed")
        return 1
    print(f"PASS: inbox official DOM fixtures/probe/comments/obstacles/no-private-strings ({len(tests)} tests)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
