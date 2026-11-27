#!/usr/bin/env python3
"""Read-only official-page inbox and comment adapter.

Maps Douyin/Xiaohongshu personal-message list DOM selectors excerpted from
authorized BiliGo sources, and Douyin official-page comment list selectors
excerpted from MIT-licensed MediaMate sources. Xiaohongshu notification comment
lists are not claimed as mapped: licensed public sources give the official URL
and visible tab labels, but not a copyable list-item DOM. This script:

- never launches a real browser against a live account (see inbox_dom_runner.py)
- never reads cookie or login-store files or tokens
- never calls hidden/private IM endpoints or sniffs XHR
- never reads hidden page application state
- never sends or clicks a send control
- only parses provided HTML (fixture samples or a runner-supplied page snapshot)
- returns selector_mismatch when a required container is missing, never an empty success
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse


LOGIN_WALL = re.compile(
    r"请先登录|请登录|登录后查看|扫码登录|密码登录|登录后免费畅享|登录后即可|登录已过期|session expired|sign in to continue",
    re.I,
)
CAPTCHA = re.compile(r"验证码|安全验证|滑动验证|captcha|unusual traffic|robot check", re.I)
BLOCKED = re.compile(r"访问频率过高|操作过于频繁|账号异常|暂时无法访问|请求被拦截", re.I)
TIME_LINE = re.compile(r"^(刚刚|\d{1,2}:\d{2}|\d+分钟前|\d+小时前|\d{4}[/\-]\d{1,2}[/\-]\d{1,2}|昨天|前天)$")

LIKE_FOLLOW_HINTS = re.compile(r"(赞了你|收藏了你|喜欢了你|关注了你|开始关注)")
SYSTEM_HINTS = re.compile(r"(系统通知|小红书团队|活动通知|账号通知)")
OUTBOUND_HINTS = re.compile(r"^(你评论了|我评论了|你回复了)")


def classify_notification_item(text: str, tab: str = "评论和@") -> str:
    """Classify a visible notification row. Likes, follows, system notices and
    outbound self-comments are not inbound comments.
    """
    label = (tab or "").strip()
    if label in {"赞和收藏", "新增关注", "likes", "connections"}:
        return "skip_non_comment"
    raw = " ".join((text or "").split())
    if not raw:
        return "skip_empty"
    if LIKE_FOLLOW_HINTS.search(raw):
        return "skip_non_comment"
    if SYSTEM_HINTS.search(raw):
        return "skip_system"
    if OUTBOUND_HINTS.search(raw):
        return "skip_outbound"
    return "comment"


VENDOR_BILIGO = Path(__file__).with_name("vendor") / "biligo-dom" / "extracted-dom.json"
VENDOR_MEDIAMATE = Path(__file__).with_name("vendor") / "mediamate-dom" / "extracted-dom.json"


class Node:
    __slots__ = ("tag", "attrs", "children", "text")

    def __init__(self, tag: str, attrs: dict[str, str]):
        self.tag = tag
        self.attrs = attrs
        self.children: list[Node] = []
        self.text = ""


class TreeParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.root = Node("document", {})
        self._stack = [self.root]
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript"}:
            self._skip += 1
            return
        node = Node(tag, {k: (v or "") for k, v in attrs})
        self._stack[-1].children.append(node)
        if tag not in {"br", "img", "input", "meta", "link", "hr"}:
            self._stack.append(node)

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript"} and self._skip:
            self._skip -= 1
            return
        for i in range(len(self._stack) - 1, 0, -1):
            if self._stack[i].tag == tag:
                self._stack = self._stack[:i]
                break

    def handle_data(self, data):
        if self._skip:
            return
        text = " ".join((data or "").split())
        if text and self._stack:
            if self._stack[-1].text:
                self._stack[-1].text += " " + text
            else:
                self._stack[-1].text = text


def class_names(node: Node) -> str:
    return " " + (node.attrs.get("class") or "") + " "


def has_class(node: Node, token: str) -> bool:
    return f" {token} " in class_names(node) or token in (node.attrs.get("class") or "").split()


def class_contains(node: Node, token: str) -> bool:
    return token.lower() in (node.attrs.get("class") or "").lower()


def attr_eq(node: Node, key: str, value: str) -> bool:
    return (node.attrs.get(key) or "") == value


def walk(node: Node):
    yield node
    for child in node.children:
        yield from walk(child)


def visible_text(node: Node) -> str:
    parts: list[str] = []

    def collect(n: Node):
        if n.text:
            parts.append(n.text)
        for c in n.children:
            collect(c)

    collect(node)
    return "\n".join(p for p in (x.strip() for x in parts) if p)


def document_text(root: Node) -> str:
    return visible_text(root)


def find_all(root: Node, pred):
    return [n for n in walk(root) if n is not root and pred(n)]


def first_child(node: Node, pred):
    for n in walk(node):
        if n is not node and pred(n):
            return n
    return None


def classify_visible(text: str, url: str = "") -> str:
    if CAPTCHA.search(text or ""):
        return "captcha"
    if LOGIN_WALL.search(text or "") or re.search(r"passport|/login|website-login/error", url or "", re.I):
        return "login_wall"
    if BLOCKED.search(text or ""):
        return "blocked"
    return "none"


def load_contract() -> dict:
    path = Path(__file__).with_name("inbox-page-contract.json")
    return json.loads(path.read_text(encoding="utf-8"))


def load_extracted() -> dict:
    if VENDOR_BILIGO.exists():
        return json.loads(VENDOR_BILIGO.read_text(encoding="utf-8"))
    return {}


def comments_list_mapped(entry: dict | None) -> bool:
    if not entry:
        return False
    if entry.get("commentsListMapped") is False:
        return False
    if entry.get("commentsVerification") == "awaiting_list_dom":
        return False
    return bool(entry.get("commentsPage"))


def channel_status(entry: dict | None, channel: str) -> str:
    if not entry:
        return "unsupported"
    if channel == "messages":
        if entry.get("inboxPage") and entry.get("inboxVerification") == "pending_page_check":
            return "pending_verification"
        return "ready" if entry.get("inboxPage") and entry.get("inboxVerification") == "verified" else "not_configured"
    if channel == "comments":
        if not comments_list_mapped(entry):
            return "not_configured" if entry.get("commentsPage") else "not_configured"
        if entry.get("commentsPage") and entry.get("commentsVerification") == "pending_page_check":
            return "pending_verification"
        return "ready" if entry.get("commentsPage") and entry.get("commentsVerification") == "verified" else "not_configured"
    return "not_configured"


def capability(platform: str) -> dict:
    contract = load_contract()
    entry = (contract.get("platforms") or {}).get(platform)
    if not entry:
        return {
            "platform": platform,
            "messages": "unsupported",
            "comments": "unsupported",
            "inboxPage": None,
            "commentsPage": None,
            "inboxVerification": "not_configured",
            "commentsVerification": "not_configured",
        }
    return {
        "platform": platform,
        "messages": channel_status(entry, "messages"),
        "comments": channel_status(entry, "comments"),
        "inboxPage": entry.get("inboxPage"),
        "commentsPage": entry.get("commentsPage"),
        "inboxVerification": entry.get("inboxVerification") or "not_configured",
        "commentsVerification": entry.get("commentsVerification") or "not_configured",
        "commentsListMapped": comments_list_mapped(entry),
        "allowHosts": entry.get("allowHosts") or [],
        "pages": entry.get("pages") or [],
    }


def emit(payload: dict, code: int = 0) -> int:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    return code


def host_allowed(url: str, hosts: list[str]) -> bool:
    if not url:
        return True
    host = (urlparse(url).hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in hosts)


def parse_legacy_items(root: Node, comment_only: bool = False) -> list[dict]:
    items = []
    for node in walk(root):
        is_comment = attr_eq(node, "data-comment-item", "1")
        is_inbox = attr_eq(node, "data-inbox-item", "1")
        if comment_only and not is_comment:
            continue
        if not comment_only and not (is_inbox or is_comment):
            continue
        key = node.attrs.get("data-visible-key") or node.attrs.get("aria-label") or ""
        text = node.attrs.get("aria-label") or visible_text(node) or key
        if not key:
            key = text
        if key or text:
            items.append({"visibleKey": key, "visibleText": text})
    return items


def parse_douyin_list(root: Node, contract: dict) -> list[dict]:
    vis = contract.get("visibleListContract") or {}
    tokens = [t.lower() for t in (vis.get("classTokens") or ["conversation", "session"])]
    skip = set(vis.get("skipTitles") or [])
    rows = []
    seen = set()
    candidates = find_all(
        root,
        lambda n: any(class_contains(n, tok) for tok in tokens) or (n.attrs.get("role") == "listitem"),
    )
    for node in candidates:
        text = visible_text(node)
        if not text or len(text) < 2 or len(text) > 400:
            continue
        lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
        if not lines:
            continue
        title = lines[0]
        if title in skip or len(title) > 40:
            continue
        body = [ln for ln in lines[1:] if not TIME_LINE.match(ln) and not re.fullmatch(r"\d{1,3}", ln)]
        preview = " ".join(body).strip()
        if not preview:
            continue
        key = f"{title}\n{preview}"
        if key in seen:
            continue
        seen.add(key)
        rows.append({"visibleKey": key, "visibleText": f"{title}：{preview}", "nickname": title, "last_message": preview})
    return rows


def parse_xhs_list(root: Node, contract: dict) -> list[dict]:
    vis = contract.get("visibleListContract") or {}
    rows = []
    seen = set()
    for node in find_all(root, lambda n: has_class(n, "xhs-im-conv-item") or class_contains(n, "xhs-im-conv-item")):
        name_node = first_child(node, lambda n: has_class(n, "xhs-im-conv-item__name") or class_contains(n, "xhs-im-conv-item__name"))
        summary_node = first_child(node, lambda n: has_class(n, "xhs-im-conv-item__summary") or class_contains(n, "xhs-im-conv-item__summary"))
        nickname = visible_text(name_node) if name_node else ""
        preview = visible_text(summary_node) if summary_node else ""
        if not nickname:
            continue
        if nickname in seen:
            continue
        seen.add(nickname)
        key = f"{nickname}\n{preview}" if preview else nickname
        text = f"{nickname}：{preview}" if preview else nickname
        rows.append({"visibleKey": key, "visibleText": text, "nickname": nickname, "last_message": preview})
    return rows


def is_empty_xhs(text: str, contract: dict) -> bool:
    hints = (contract.get("visibleListContract") or {}).get("emptyHints") or []
    return any(h and h in (text or "") for h in hints)


def comments_contract(entry: dict) -> dict:
    return entry.get("visibleCommentsContract") or {}


def hrefs(node: Node) -> list[str]:
    out = []
    for n in walk(node):
        href = (n.attrs.get("href") or "").strip()
        if href.startswith("http://") or href.startswith("https://"):
            out.append(href)
    return out


def visible_time_in(node: Node) -> str:
    for n in walk(node):
        text = (n.text or "").strip()
        if text and TIME_LINE.match(text):
            return text
    return ""


def stable_comment_id(platform: str, author: str, text: str, work_url: str, visible_time: str, raw_id: str = "") -> str:
    raw_id = (raw_id or "").strip()
    if raw_id:
        return raw_id
    payload = f"{platform}\0{author}\0{text}\0{work_url}\0{visible_time}"
    return "cmt-" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def comment_item(platform: str, author: str, text: str, work_url: str = "", visible_time: str = "", raw_id: str = "") -> dict:
    comment_id = stable_comment_id(platform, author, text, work_url, visible_time, raw_id)
    visible = f"{author}：{text}" if author else text
    row = {
        "visibleKey": comment_id,
        "visibleText": visible,
        "channel": "comments",
        "itemType": "comment",
        "platform": platform,
        "commentId": comment_id,
        "authorName": author,
    }
    if work_url:
        row["workUrl"] = work_url
    if visible_time:
        row["visibleTime"] = visible_time
    return row


def page_work_url(root: Node) -> str:
    for href in hrefs(root):
        path = urlparse(href).path or ""
        if any(token in path for token in ("/video/", "/explore/", "/discovery/")):
            return href
    return ""


def parse_douyin_comments(root: Node, entry: dict) -> tuple[list[dict], str]:
    vis = comments_contract(entry)
    empty_hints = vis.get("emptyHints") or ["暂无评论", "还没有评论", "你还没有"]
    visible = document_text(root)
    lists = find_all(root, lambda n: n.tag == "ul" and class_contains(n, "cmt-ul"))
    work_url = page_work_url(root)
    rows: list[dict] = []
    seen: set[str] = set()
    for ul in lists:
        for li in find_all(ul, lambda n: n.tag == "li"):
            author_node = first_child(li, lambda n: n.tag == "h4")
            content_node = first_child(li, lambda n: n.tag == "pre")
            author = visible_text(author_node) if author_node else ""
            text = visible_text(content_node) if content_node else ""
            if not author or not text:
                continue
            raw_id = (li.attrs.get("id") or li.attrs.get("data-id") or li.attrs.get("data-comment-id") or "").strip()
            item_time = visible_time_in(li)
            # Use work URL only when it is visible on the page; never invent one.
            row = comment_item("douyin", author, text, work_url, item_time, raw_id)
            if row["commentId"] in seen:
                continue
            seen.add(row["commentId"])
            rows.append(row)
    if rows:
        return rows, "ok"
    if lists or any(h in visible for h in empty_hints if h):
        # A list shell or a documented empty hint is present.
        if lists or "暂无评论" in visible or "还没有评论" in visible or "你还没有" in visible:
            return [], "empty"
    if "评论管理" in visible and "选择作品" in visible:
        return [], "need_page"
    return [], "mismatch"


def is_comment_block(node: Node) -> bool:
    author = first_child(node, lambda n: has_class(n, "author") or class_contains(n, "author"))
    content = first_child(node, lambda n: has_class(n, "content") or class_contains(n, "content"))
    return bool(author and content)


def parse_xhs_comments(root: Node, entry: dict) -> tuple[list[dict], str]:
    vis = comments_contract(entry)
    empty_hints = vis.get("emptyHints") or ["暂无评论", "还没有评论"]
    visible = document_text(root)
    containers = find_all(root, lambda n: has_class(n, "comments-container") or class_contains(n, "comments-container"))
    empty_nodes = find_all(root, lambda n: has_class(n, "no-comments-text") or class_contains(n, "no-comments-text"))
    work_url = page_work_url(root)
    rows: list[dict] = []
    seen: set[str] = set()
    for container in containers:
        # Prefer item roots that themselves contain both author and content,
        # skipping the container and nested wrappers already covered by a parent item.
        candidates = find_all(container, is_comment_block)
        items = []
        for node in candidates:
            # Skip a node if a descendant is also a candidate closer to the author/content pair
            # and this node is just the container-like wrapper: keep the smallest block.
            smaller = [c for c in candidates if c is not node and _is_descendant(node, c)]
            if smaller:
                continue
            items.append(node)
        for node in items:
            author_wrap = first_child(node, lambda n: has_class(n, "author") or class_contains(n, "author"))
            content_wrap = first_child(node, lambda n: has_class(n, "content") or class_contains(n, "content"))
            author_link = first_child(author_wrap, lambda n: n.tag == "a") if author_wrap else None
            author = visible_text(author_link or author_wrap) if author_wrap else ""
            text = visible_text(content_wrap) if content_wrap else ""
            if not author or not text:
                continue
            raw_id = (node.attrs.get("id") or node.attrs.get("data-id") or node.attrs.get("data-comment-id") or "").strip()
            item_time = visible_time_in(node)
            row = comment_item("xiaohongshu", author, text, work_url, item_time, raw_id)
            if row["commentId"] in seen:
                continue
            seen.add(row["commentId"])
            rows.append(row)
    if rows:
        return rows, "ok"
    if empty_nodes or (containers and any(h in visible for h in empty_hints if h)) or (
        containers and not rows
    ):
        if empty_nodes or any(h in visible for h in empty_hints if h) or containers:
            # Container present with no author/content pairs counts as empty, not mismatch.
            return [], "empty"
    return [], "mismatch"


def _is_descendant(parent: Node, child: Node) -> bool:
    for n in walk(parent):
        if n is child:
            return True
    return False


def notification_chrome(root: Node, entry: dict | None = None) -> dict:
    vis = comments_contract(entry or {})
    chrome = vis.get("notificationChrome") or {}
    tab_token = "reds-tab-item"
    tabs = find_all(root, lambda n: has_class(n, tab_token) or class_contains(n, tab_token))
    labels = [visible_text(n).strip() for n in tabs if visible_text(n).strip()]
    visible = document_text(root)
    comment_label = chrome.get("commentTabLabel") or "评论和@"
    like_label = chrome.get("likeTabLabel") or "赞和收藏"
    follow_label = chrome.get("followTabLabel") or "新增关注"
    present = any(comment_label in lab for lab in labels) or (
        comment_label in visible and like_label in visible
    )
    return {
        "present": bool(present),
        "labels": labels,
        "commentTab": any(comment_label in lab for lab in labels) or comment_label in visible,
        "likeTab": any(like_label in lab for lab in labels) or like_label in visible,
        "followTab": any(follow_label in lab for lab in labels) or follow_label in visible,
    }


def looks_like_note_comment_page(root: Node) -> bool:
    return bool(find_all(root, lambda n: has_class(n, "comments-container") or class_contains(n, "comments-container")))


def parse_xhs_notification_comments(root: Node, entry: dict, page_url: str = "") -> tuple[list[dict], str, dict]:
    """Notification inbox parser.

    List-item selectors are not mapped. A recognized official chrome without a
    licensed list contract is selector_mismatch, never an empty success.
    Note-page comments-container is ignored and must not be treated as this list.
    """
    chrome = notification_chrome(root, entry)
    note_page = looks_like_note_comment_page(root)
    meta = {
        "chrome": chrome,
        "notePageContainersIgnored": note_page,
        "listMapped": False,
        "pageUrl": page_url or "",
    }
    # Intentionally do not parse note-page comments-container as the notification list.
    return [], "selector_mismatch", meta


def mock_read(args, cap: dict, entry: dict) -> int:
    html = Path(args.html_file).read_text(encoding="utf-8")
    parser = TreeParser()
    parser.feed(html)
    visible = document_text(parser.root)
    page_url = args.page_url or ""
    hosts = cap.get("allowHosts") or entry.get("allowHosts") or []
    if page_url and hosts and not host_allowed(page_url, hosts):
        return emit({
            "status": "stopped",
            "claimedRead": False,
            "obstacle": "blocked",
            "reason": "页面地址不在已允许的官方域名内，已停止。",
            "items": [],
        })
    obstacle = classify_visible(visible, page_url)
    if obstacle != "none":
        reason = {
            "captcha": "页面出现验证码或安全拦截，已停止，需要你在官方页面处理。",
            "login_wall": "页面需要重新登录，已停止，需要你在官方页面处理。",
            "blocked": "页面被拦截，已停止，需要你在官方页面处理。",
        }[obstacle]
        return emit({
            "status": "stopped",
            "claimedRead": False,
            "obstacle": obstacle,
            "reason": reason,
            "items": [],
        })

    platform = args.platform
    if args.channel == "comments":
        if platform == "douyin":
            items, verdict = parse_douyin_comments(parser.root, entry)
            meta = {}
        elif platform == "xiaohongshu":
            items, verdict, meta = parse_xhs_notification_comments(parser.root, entry, page_url)
        else:
            return emit({
                "status": "unsupported",
                "claimedRead": False,
                "obstacle": "none",
                "reason": "这个平台没有可映射的官方评论页。",
                "items": [],
                "capability": cap,
            })
        if verdict in {"mismatch", "selector_mismatch"}:
            xhs_reason = (
                "小红书通知页地址和分区标签已知，但通知列表条目选择器没有取得可独立编写的许可证据。"
                "不会用笔记页评论区冒充通知列表，也不会把未匹配当成空成功。"
            )
            reason = xhs_reason if platform == "xiaohongshu" else "评论列表选择器未匹配，不能当作已读，也不能当成空列表。映射仍待实页验证。"
            payload = {
                "status": "selector_mismatch",
                "claimedRead": False,
                "obstacle": "none",
                "matched": False,
                "empty": False,
                "reason": reason,
                "items": [],
                "capability": cap,
                "sampleKind": getattr(args, "sample_kind", "") or "fixture_sample",
            }
            if meta:
                payload["notificationChrome"] = meta.get("chrome")
                payload["notePageContainersIgnored"] = bool(meta.get("notePageContainersIgnored"))
                payload["listMapped"] = False
            return emit(payload)
        if verdict == "need_page":
            return emit({
                "status": "need_page",
                "claimedRead": False,
                "obstacle": "none",
                "reason": "评论管理页还需要选择作品后才出现列表，没有当作已读或空成功。",
                "items": [],
                "capability": cap,
            })
        limit = int(entry.get("maxListItems") or 20)
        trimmed = []
        for row in items[: max(1, limit)]:
            out = {
                "visibleKey": str(row.get("visibleKey") or "")[:500],
                "visibleText": str(row.get("visibleText") or row.get("visibleKey") or "")[:500],
                "channel": "comments",
                "itemType": "comment",
                "platform": platform,
                "commentId": str(row.get("commentId") or row.get("visibleKey") or "")[:500],
                "authorName": str(row.get("authorName") or "")[:200],
            }
            if row.get("workUrl"):
                out["workUrl"] = str(row["workUrl"])[:500]
            if row.get("visibleTime"):
                out["visibleTime"] = str(row["visibleTime"])[:80]
            trimmed.append(out)
        sample_kind = getattr(args, "sample_kind", "") or "fixture_sample"
        reason = (
            "已从真实网页只读采样读取评论。这仍需写入核验记录后才能视为可巡查。"
            if sample_kind == "live_page"
            else "已从提供的可见DOM样本读取评论（测试/夹具样例，不是真实平台评论，也不是真实页面采样）。映射选择器仍待实际网页走查，不能当作已验证。"
        )
        return emit({
            "status": "ready",
            "claimedRead": True,
            "obstacle": "none",
            "matched": True,
            "reason": reason,
            "items": trimmed,
            "capability": cap,
            "empty": verdict == "empty" and not trimmed,
            "sampleKind": sample_kind,
        })

    items: list[dict]
    if platform == "douyin":
        items = parse_douyin_list(parser.root, entry)
    elif platform == "xiaohongshu":
        items = parse_xhs_list(parser.root, entry)
        if not items and is_empty_xhs(visible, entry):
            items = []
    else:
        items = parse_legacy_items(parser.root)

    if not items:
        items = parse_legacy_items(parser.root)

    limit = int(entry.get("maxListItems") or 20)
    trimmed = []
    for row in items[: max(1, limit)]:
        trimmed.append({
            "visibleKey": str(row.get("visibleKey") or "")[:500],
            "visibleText": str(row.get("visibleText") or row.get("visibleKey") or "")[:500],
        })
    empty_ok = (platform == "xiaohongshu" and is_empty_xhs(visible, entry)) or (
        platform == "douyin" and not trimmed and "fixture" in html.lower()
    ) or (not trimmed and not LOGIN_WALL.search(visible))
    sample_kind = getattr(args, "sample_kind", "") or "fixture_sample"
    reason = (
        "已从真实网页只读采样读取私信。这仍需写入核验记录后才能视为可巡查。"
        if sample_kind == "live_page"
        else "已从提供的可见DOM样本读取（测试/夹具样例，不是真实平台消息，也不是真实页面采样）。映射选择器仍待实际网页走查。"
    )
    return emit({
        "status": "ready",
        "claimedRead": True,
        "obstacle": "none",
        "reason": reason,
        "items": trimmed,
        "capability": cap,
        "empty": empty_ok and not trimmed,
        "sampleKind": sample_kind,
    })


def probe(args, cap: dict) -> int:
    needed = cap[args.channel]
    if needed in {"unsupported", "not_configured"}:
        reason = "该平台该通道尚未映射官方页，不会打开浏览器，也不会假装读到内容。"
        if args.platform == "xiaohongshu" and args.channel == "comments":
            reason = (
                "小红书通知页地址和分区标签已知，但通知列表条目选择器没有取得可独立编写的许可证据，"
                "不能当作已接入。不会打开真实浏览器，也不会假装读到评论。"
            )
        return emit({
            "status": needed,
            "claimedRead": False,
            "obstacle": "none",
            "reason": reason,
            "items": [],
            "capability": cap,
            "listMapped": bool(cap.get("commentsListMapped")) if args.channel == "comments" else True,
        })
    kind = "评论" if args.channel == "comments" else "私信"
    return emit({
        "status": "pending_verification" if needed == "pending_verification" else needed,
        "claimedRead": False,
        "obstacle": "none",
        "reason": f"已按公开官方页映射{kind}列表，仍待真实网页核对。本路径只做能力探查，不打开真实浏览器，不读取真实{kind}，也不发送。",
        "items": [],
        "capability": cap,
    })


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Read-only official UI inbox adapter")
    parser.add_argument("--platform", required=True)
    parser.add_argument("--channel", choices=["messages", "comments"], default="messages")
    parser.add_argument("--mode", choices=["probe", "mock", "parse"], default="probe")
    parser.add_argument("--html-file", default="")
    parser.add_argument("--page-url", default="", help="Optional fixture or sampled page URL for host allowlist / login-path checks")
    parser.add_argument("--sample-kind", default="", help="fixture_sample or live_page; never implied as verified")
    parser.add_argument("--allow-browser", action="store_true", help="Ignored: this adapter will not launch against live accounts from this path.")
    args = parser.parse_args(argv)

    cap = capability(args.platform)
    contract = load_contract()
    entry = (contract.get("platforms") or {}).get(args.platform) or {}

    if args.mode in {"mock", "parse"}:
        if not args.html_file:
            return emit({"status": "not_configured", "claimedRead": False, "obstacle": "none", "reason": "parse/mock 模式需要 --html-file", "items": [], "capability": cap}, 2)
        if not getattr(args, "sample_kind", ""):
            args.sample_kind = "fixture_sample"
        return mock_read(args, cap, entry)

    return probe(args, cap)


if __name__ == "__main__":
    raise SystemExit(main())
