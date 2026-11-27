# -*- coding: utf-8 -*-
"""抖音热点中心（douhot.douyin.com）查询服务。

需单独 OAuth 授权「生活服务热点中心」(client_key=awuu67pp4wjdf1hg)。
普通 www/creator Cookie 通常不够；请在浏览器完成授权后导出 Cookie 到
data/douhot_cookies.txt，或保存 Playwright storage_state 到
data/douhot_storage_state.json。
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import urlencode

logger = logging.getLogger("api.douhot")

DOUHOT_HOME = "https://douhot.douyin.com/ranking"
DOUHOT_BASE = "https://douhot.douyin.com/douhot/v1"
OAUTH_CLIENT = "awuu67pp4wjdf1hg"
OAUTH_APP_NAME = "生活服务热点中心"

_AUTH_HINT = (
    "douhot 需要单独授权登录（OAuth「生活服务热点中心」），"
    "现有 www.douyin.com / creator.douyin.com Cookie 通常不够。"
    "请在浏览器打开 https://douhot.douyin.com/ ，用抖音扫码同意授权后，"
    "将 douhot.douyin.com 域下 Cookie（含 sessionid / sid_tt 等）写入 "
    "data/douhot_cookies.txt；或把 Playwright storage_state 存为 "
    "data/douhot_storage_state.json。完成后重试本接口。"
)

_lock = asyncio.Lock()


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _data_roots() -> list[Path]:
    env = (os.getenv("MEDIA_CRAWLER_DATA_DIR") or "").strip()
    roots: list[Path] = []
    if env:
        roots.append(Path(env))
    roots.append(_project_root() / "data")
    roots.append(_project_root())
    roots.append(Path("/app/data"))
    roots.append(Path("/opt/mediacrawler/data"))
    roots.append(Path("/opt/mediacrawler"))
    seen = set()
    out = []
    for r in roots:
        key = str(r)
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def _cookie_candidates() -> list[Path]:
    paths: list[Path] = []
    for root in _data_roots():
        paths.append(root / "douhot_cookies.txt")
        paths.append(root / ".douhot_cookies.txt")
    # fallback: shared douyin cookies（多数情况不够，但仍尝试）
    for root in _data_roots():
        paths.append(root / "douyin_cookies.txt")
        paths.append(root / ".douyin_cookies.txt")
    seen = set()
    out = []
    for p in paths:
        key = str(p)
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def _storage_state_candidates() -> list[Path]:
    paths: list[Path] = []
    for root in _data_roots():
        paths.append(root / "douhot_storage_state.json")
        paths.append(root / ".douhot_storage_state.json")
    seen = set()
    out = []
    for p in paths:
        key = str(p)
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def load_douhot_cookie_str() -> tuple[str, Optional[Path]]:
    for path in _cookie_candidates():
        try:
            if path.is_file():
                text = path.read_text(encoding="utf-8").strip()
                if text:
                    return text, path
        except Exception as exc:
            logger.warning("[douhot] read cookie %s failed: %s", path, exc)
    return "", None




def save_cookies_text(raw: str) -> Path:
    """Write douhot cookie string to data/douhot_cookies.txt (Master-only via API)."""
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("cookies 不能为空")
    env = (os.getenv("MEDIA_CRAWLER_DATA_DIR") or "").strip()
    root = Path(env) if env else (_project_root() / "data")
    root.mkdir(parents=True, exist_ok=True)

    if raw.startswith("{") and ("cookies" in raw or "origins" in raw):
        import json
        try:
            data = json.loads(raw)
            state_path = root / "douhot_storage_state.json"
            state_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            return state_path
        except Exception as exc:
            raise ValueError(f"storage_state JSON 解析失败: {exc}") from exc

    if raw.startswith("["):
        import json
        try:
            arr = json.loads(raw)
            if isinstance(arr, list):
                parts = []
                for item in arr:
                    if isinstance(item, dict) and item.get("name"):
                        parts.append(f"{item['name']}={item.get('value', '')}")
                raw = "; ".join(parts)
        except Exception as exc:
            raise ValueError(f"cookies JSON 解析失败: {exc}") from exc

    path = root / "douhot_cookies.txt"
    path.write_text(raw.strip() + "\n", encoding="utf-8")
    return path


def find_storage_state() -> Optional[Path]:
    for path in _storage_state_candidates():
        try:
            if path.is_file() and path.stat().st_size > 10:
                return path
        except Exception:
            continue
    return None


def parse_cookie_pairs(cookie_str: str) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for part in cookie_str.replace("\n", ";").split(";"):
        part = part.strip()
        if not part or "=" not in part or part.startswith("#"):
            continue
        name, value = part.split("=", 1)
        name, value = name.strip(), value.strip()
        if name:
            pairs.append((name, value))
    return pairs


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _clean_params(params: Optional[dict]) -> dict:
    out = {}
    for k, v in (params or {}).items():
        if v is None or v == "":
            continue
        out[k] = v
    return out


async def _page_request_json(
    page,
    method: str,
    path: str,
    *,
    params: Optional[dict] = None,
    body: Optional[dict] = None,
) -> Any:
    """在已打开的 douhot 页面上下文中请求 /douhot/v1/..."""
    method_u = (method or "GET").upper()
    params = _clean_params(params)
    url = path if path.startswith("http") else f"{DOUHOT_BASE}{path if path.startswith('/') else '/' + path}"
    if params and method_u == "GET":
        url = f"{url}?{urlencode(params, doseq=True)}"

    result = await page.evaluate(
        """async ({method, url, body, isGet}) => {
            const opts = {
                method,
                headers: {
                    "accept": "application/json, text/plain, */*",
                },
                credentials: "include",
            };
            if (!isGet && body !== null && body !== undefined) {
                opts.headers["content-type"] = "application/json;charset=UTF-8";
                opts.body = JSON.stringify(body);
            }
            const r = await fetch(url, opts);
            const text = await r.text();
            return {
                status: r.status,
                url: r.url,
                text,
                finalUrl: window.location.href,
            };
        }""",
        {
            "method": method_u,
            "url": url if method_u == "GET" else (
                f"{url}?{urlencode(params, doseq=True)}" if params else url
            ),
            "body": body if method_u != "GET" else None,
            "isGet": method_u == "GET",
        },
    )
    status = int(result.get("status") or 0)
    text = result.get("text") or ""
    final_url = result.get("finalUrl") or ""

    if "open.douyin.com" in final_url or "oauth" in final_url.lower():
        raise RuntimeError(_AUTH_HINT)
    if status in (401, 403):
        raise RuntimeError(_AUTH_HINT + f" (HTTP {status})")
    if status != 200:
        raise RuntimeError(f"douhot 上游 HTTP {status}: {text[:400]}")
    if text.lstrip().startswith("<"):
        raise RuntimeError(_AUTH_HINT + "（上游返回 HTML/登录页）")

    try:
        outer = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"douhot 上游非 JSON: {text[:200]}") from exc

    if isinstance(outer, dict):
        code = outer.get("code")
        # douhot 惯例：code==0 成功；code==8 未登录
        if code == 8 or (
            isinstance(outer.get("data"), str)
            and "未登录" in str(outer.get("data"))
        ):
            raise RuntimeError(_AUTH_HINT + f" upstream={outer}")
        if code not in (0, None, "0", 200, "200") and "data" not in outer:
            msg = outer.get("message") or outer.get("msg") or outer.get("data") or outer
            raise RuntimeError(f"douhot 业务错误 code={code}: {msg}")
    return outer


async def _with_douhot_page(coro_fn: Callable[..., Awaitable[Any]]) -> Any:
    """打开 douhot 上下文并执行回调（独立 asyncio.Lock）。"""
    storage = find_storage_state()
    cookie_str, cookie_path = load_douhot_cookie_str()
    if not storage and not cookie_str:
        raise RuntimeError(
            "未找到 douhot 登录态。请写入 data/douhot_cookies.txt 或 "
            "data/douhot_storage_state.json。" + _AUTH_HINT
        )

    async with _lock:
        from playwright.async_api import async_playwright

        browsers_path = os.getenv("PLAYWRIGHT_BROWSERS_PATH") or "/ms-playwright"
        os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", browsers_path)

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            try:
                ctx_kwargs: dict[str, Any] = {
                    "user_agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                    "viewport": {"width": 1440, "height": 900},
                }
                if storage:
                    ctx_kwargs["storage_state"] = str(storage)
                    logger.info("[douhot] using storage_state %s", storage)

                context = await browser.new_context(**ctx_kwargs)

                if cookie_str:
                    pairs = parse_cookie_pairs(cookie_str)
                    cookies = []
                    for n, v in pairs:
                        cookies.append(
                            {"name": n, "value": v, "domain": ".douyin.com", "path": "/"}
                        )
                        cookies.append(
                            {
                                "name": n,
                                "value": v,
                                "domain": "douhot.douyin.com",
                                "path": "/",
                            }
                        )
                    await context.add_cookies(cookies)
                    logger.info(
                        "[douhot] injected %s cookie pairs from %s",
                        len(pairs),
                        cookie_path,
                    )

                page = await context.new_page()
                await page.goto(
                    DOUHOT_HOME,
                    wait_until="domcontentloaded",
                    timeout=90000,
                )
                await page.wait_for_timeout(2500)

                # 若已跳到 OAuth，直接失败
                if "open.douyin.com" in page.url or "oauth" in page.url.lower():
                    raise RuntimeError(_AUTH_HINT + f" current_url={page.url}")

                # 登录探活
                try:
                    probe = await _page_request_json(page, "GET", "/user/user_info")
                    if isinstance(probe, dict) and probe.get("code") not in (
                        0,
                        None,
                        "0",
                        200,
                        "200",
                    ):
                        raise RuntimeError(_AUTH_HINT + f" user_info={probe}")
                except RuntimeError:
                    raise
                except Exception as exc:
                    logger.warning("[douhot] user_info probe soft-fail: %s", exc)

                # 成功后尝试持久化 storage_state，方便下次
                try:
                    state_path = _project_root() / "data" / "douhot_storage_state.json"
                    alt = Path("/app/data/douhot_storage_state.json")
                    for target in (alt, state_path):
                        try:
                            target.parent.mkdir(parents=True, exist_ok=True)
                            await context.storage_state(path=str(target))
                            logger.info("[douhot] saved storage_state to %s", target)
                            break
                        except Exception:
                            continue
                except Exception as exc:
                    logger.warning("[douhot] save storage_state failed: %s", exc)

                return await coro_fn(page)
            finally:
                await browser.close()


def _shape_billboard_item(it: dict, board: str, rank: int) -> dict:
    title = (
        it.get("sentence")
        or it.get("sentence_name")
        or it.get("title")
        or it.get("challenge_name")
        or it.get("name")
        or ""
    )
    sid = (
        it.get("sentence_id")
        or it.get("id")
        or it.get("challenge_id")
        or it.get("item_id")
    )
    try:
        hot = int(
            float(
                str(
                    it.get("hot_score")
                    or it.get("score")
                    or it.get("hot_value")
                    or it.get("index")
                    or 0
                ).replace(",", "")
            )
        )
    except (TypeError, ValueError):
        hot = 0
    try:
        rnk = int(it.get("rank") or it.get("index") or rank)
    except (TypeError, ValueError):
        rnk = rank
    return {
        "rank": rnk,
        "title": title,
        "hot_value": hot,
        "sentence_id": str(sid) if sid is not None else None,
        "category": it.get("sentence_tag_name")
        or it.get("category")
        or it.get("tag_name"),
        "city": it.get("city_name") or it.get("city"),
        "video_count": it.get("video_count") or it.get("item_count"),
        "board": board,
        "raw": it,
    }


def _wrap_billboard(board: str, raw: Any, limit: int) -> dict:
    data = raw.get("data") if isinstance(raw, dict) else raw
    if not isinstance(data, dict):
        data = {}
    objs = data.get("objs") or data.get("list") or data.get("items") or []
    items = []
    for i, it in enumerate(objs, start=1):
        if isinstance(it, dict):
            items.append(_shape_billboard_item(it, board, i))
    if limit:
        items = items[:limit]
    page = data.get("page") or {}
    return {
        "ok": True,
        "source": "douhot.douyin.com",
        "board": board,
        "count": len(items),
        "items": items,
        "page": page,
        "last_update_time": data.get("last_update_time"),
        "raw_code": raw.get("code") if isinstance(raw, dict) else None,
        "queried_at": _now(),
    }


async def check_auth() -> dict:
    """检查 douhot 登录态。"""

    async def _run(page):
        raw = await _page_request_json(page, "GET", "/user/user_info")
        data = raw.get("data") if isinstance(raw, dict) else None
        return {
            "ok": True,
            "authorized": True,
            "user": data if isinstance(data, dict) else {"raw": data},
            "oauth_app": OAUTH_APP_NAME,
            "oauth_client_key": OAUTH_CLIENT,
            "page_url": page.url,
            "cookie_hint": (
                "已授权。建议保留 data/douhot_cookies.txt 或 "
                "data/douhot_storage_state.json"
            ),
            "queried_at": _now(),
        }

    try:
        return await _with_douhot_page(_run)
    except RuntimeError as exc:
        msg = str(exc)
        if "授权" in msg or "未登录" in msg or "OAuth" in msg or "Cookie" in msg:
            return {
                "ok": False,
                "authorized": False,
                "error": msg,
                "oauth_app": OAUTH_APP_NAME,
                "oauth_client_key": OAUTH_CLIENT,
                "login_url": "https://douhot.douyin.com/",
                "how_to": [
                    "浏览器打开 https://douhot.douyin.com/",
                    "用抖音 App 扫码，同意授权「生活服务热点中心」",
                    "DevTools → Application → Cookies → 复制 douhot.douyin.com 全部 Cookie",
                    "写入服务器 data/douhot_cookies.txt（一行 name=value; ...）",
                    "或用 Playwright 保存 storage_state 到 data/douhot_storage_state.json",
                    "再调用本接口 /api/douyin/douhot/status 验证",
                ],
                "queried_at": _now(),
            }
        raise


async def fetch_billboard(
    board: str,
    *,
    page: int = 1,
    page_size: int = 50,
    keyword: Optional[str] = None,
    city_code: Optional[str] = None,
    sentence_tag: Optional[str] = None,
    order: Optional[str] = None,
    type_: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    snapshot_time: Optional[str] = None,
    limit: int = 50,
) -> dict:
    board = (board or "total").strip().lower()
    path_map = {
        "total": "/billboard/total",
        "rise": "/billboard/rise",
        "rising": "/billboard/rise",
        "city": "/billboard/city",
        "challenge": "/billboard/challenge",
    }
    if board not in path_map:
        raise ValueError(f"未知榜单 board={board}，可选: total/rise/city/challenge")
    path = path_map[board]
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 50), 100))
    limit = max(1, min(int(limit or page_size), 200))

    params: dict[str, Any] = {
        "page": page,
        "page_size": page_size,
        "keyword": keyword,
        "city_code": city_code,
        "sentence_tag": sentence_tag,
        "order": order,
        "type": type_,
        "start_date": start_date,
        "end_date": end_date,
        "snapshot_time": snapshot_time,
    }

    async def _run(pg):
        raw = await _page_request_json(pg, "GET", path, params=params)
        shaped = _wrap_billboard(board if board != "rising" else "rise", raw, limit)
        shaped["request"] = {"path": path, "params": _clean_params(params)}
        return shaped

    return await _with_douhot_page(_run)


async def fetch_distribution(
    *,
    billboard_type: Optional[str] = None,
    keyword: Optional[str] = None,
    city_code: Optional[str] = None,
    type_: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    snapshot_time: Optional[str] = None,
) -> dict:
    params = {
        "billboard_type": billboard_type,
        "keyword": keyword,
        "city_code": city_code,
        "type": type_,
        "start_date": start_date,
        "end_date": end_date,
        "snapshot_time": snapshot_time,
    }

    async def _run(page):
        raw = await _page_request_json(
            page, "GET", "/billboard/distribution", params=params
        )
        return {
            "ok": True,
            "source": "douhot.douyin.com",
            "endpoint": "/billboard/distribution",
            "data": raw.get("data") if isinstance(raw, dict) else raw,
            "raw": raw,
            "queried_at": _now(),
        }

    return await _with_douhot_page(_run)


async def fetch_common(kind: str) -> dict:
    kind = (kind or "").strip().lower()
    path_map = {
        "city": "/common/city",
        "category": "/common/category",
        "fans_config": "/common/fans_config",
        "fans-config": "/common/fans_config",
    }
    if kind not in path_map:
        raise ValueError("kind 须为 city / category / fans_config")
    path = path_map[kind]

    async def _run(page):
        raw = await _page_request_json(page, "GET", path)
        return {
            "ok": True,
            "source": "douhot.douyin.com",
            "endpoint": path,
            "data": raw.get("data") if isinstance(raw, dict) else raw,
            "raw": raw,
            "queried_at": _now(),
        }

    return await _with_douhot_page(_run)


async def fetch_sentence(
    sentence_id: str,
    part: str = "timeline",
    *,
    page: int = 1,
    page_size: int = 30,
    keyword: Optional[str] = None,
) -> dict:
    sid = str(sentence_id or "").strip()
    if not sid:
        raise ValueError("sentence_id 不能为空")
    part = (part or "timeline").strip().lower()
    part_map = {
        "timeline": f"/sentence/{sid}/sentence_timeline",
        "info": f"/sentence/{sid}/sentence_timeline",
        "index": f"/sentence/{sid}/index",
        "videos": f"/sentence/{sid}/sentence_item",
        "items": f"/sentence/{sid}/sentence_item",
        "trends": f"/sentence/{sid}/trends",
        "hot_analysis": f"/sentence/{sid}/hot_analysis",
        "hot-analysis": f"/sentence/{sid}/hot_analysis",
        "audience": f"/sentence/{sid}/hot_analysis",
        "word_cloud": f"/sentence/{sid}/comment_analysis/word_cloud",
        "word-cloud": f"/sentence/{sid}/comment_analysis/word_cloud",
        "comments": f"/sentence/{sid}/comment_analysis/comment_list",
    }
    if part not in part_map:
        raise ValueError(
            "part 可选: timeline/index/videos/trends/hot_analysis/word_cloud/comments"
        )
    path = part_map[part]
    params = {
        "page": max(1, int(page or 1)),
        "page_size": max(1, min(int(page_size or 30), 100)),
        "keyword": keyword,
    }

    async def _run(pg):
        # timeline / index / word_cloud 通常无分页参数
        use_params = params if part in (
            "videos",
            "items",
            "comments",
            "trends",
        ) else None
        raw = await _page_request_json(pg, "GET", path, params=use_params)
        return {
            "ok": True,
            "source": "douhot.douyin.com",
            "sentence_id": sid,
            "part": part,
            "endpoint": path,
            "data": raw.get("data") if isinstance(raw, dict) else raw,
            "raw": raw,
            "queried_at": _now(),
        }

    return await _with_douhot_page(_run)


async def fetch_hot_words(
    *,
    page_num: int = 1,
    page_size: int = 20,
    keyword: Optional[str] = None,
    date_window: Optional[str] = None,
    first_tag: Optional[str] = None,
    sub_type: Optional[str] = None,
) -> dict:
    body = _clean_params(
        {
            "page_num": max(1, int(page_num or 1)),
            "page_size": max(1, min(int(page_size or 20), 100)),
            "keyword": keyword,
            "date_window": date_window,
            "first_tag": first_tag,
            "sub_type": sub_type,
        }
    )

    async def _run(page):
        raw = await _page_request_json(
            page, "POST", "/dashboard/hot_word/query_list", body=body
        )
        data = raw.get("data") if isinstance(raw, dict) else raw
        return {
            "ok": True,
            "source": "douhot.douyin.com",
            "endpoint": "/dashboard/hot_word/query_list",
            "request": body,
            "data": data,
            "raw": raw,
            "queried_at": _now(),
        }

    return await _with_douhot_page(_run)


async def fetch_hot_word_detail(params: dict) -> dict:
    async def _run(page):
        raw = await _page_request_json(
            page, "GET", "/dashboard/hot_word/detail", params=params
        )
        return {
            "ok": True,
            "source": "douhot.douyin.com",
            "endpoint": "/dashboard/hot_word/detail",
            "data": raw.get("data") if isinstance(raw, dict) else raw,
            "raw": raw,
            "queried_at": _now(),
        }

    return await _with_douhot_page(_run)


async def fetch_hot_word_trends(params: dict) -> dict:
    async def _run(page):
        raw = await _page_request_json(
            page, "GET", "/dashboard/hot_word/trends", params=params
        )
        return {
            "ok": True,
            "source": "douhot.douyin.com",
            "endpoint": "/dashboard/hot_word/trends",
            "data": raw.get("data") if isinstance(raw, dict) else raw,
            "raw": raw,
            "queried_at": _now(),
        }

    return await _with_douhot_page(_run)


async def fetch_hot_search(params: Optional[dict] = None) -> dict:
    async def _run(page):
        raw = await _page_request_json(
            page, "GET", "/dashboard/hot_search/query_list", params=params or {}
        )
        return {
            "ok": True,
            "source": "douhot.douyin.com",
            "endpoint": "/dashboard/hot_search/query_list",
            "data": raw.get("data") if isinstance(raw, dict) else raw,
            "raw": raw,
            "queried_at": _now(),
        }

    return await _with_douhot_page(_run)


async def fetch_calendar(
    *,
    action: str = "query_list",
    params: Optional[dict] = None,
) -> dict:
    action = (action or "query_list").strip()
    allowed = {
        "query_list",
        "holiday_list",
        "future_event",
        "publish_list",
        "item_list",
    }
    if action not in allowed:
        raise ValueError(f"action 可选: {', '.join(sorted(allowed))}")
    path = f"/calendar/{action}"

    async def _run(page):
        raw = await _page_request_json(page, "GET", path, params=params or {})
        return {
            "ok": True,
            "source": "douhot.douyin.com",
            "endpoint": path,
            "data": raw.get("data") if isinstance(raw, dict) else raw,
            "raw": raw,
            "queried_at": _now(),
        }

    return await _with_douhot_page(_run)


async def fetch_raw(
    method: str,
    path: str,
    *,
    params: Optional[dict] = None,
    body: Optional[dict] = None,
) -> dict:
    """受限透传：仅允许 /douhot/v1 下已知前缀。"""
    method_u = (method or "GET").upper()
    if method_u not in ("GET", "POST"):
        raise ValueError("method 仅支持 GET/POST")
    p = (path or "").strip()
    if p.startswith("http"):
        raise ValueError("path 请用相对路径，如 /billboard/total")
    if not p.startswith("/"):
        p = "/" + p
    allowed_prefixes = (
        "/billboard/",
        "/common/",
        "/sentence/",
        "/dashboard/",
        "/calendar/",
        "/material/",
        "/user/",
        "/item/",
        "/author_analysis/",
        "/monitor/",
    )
    if not any(p.startswith(pref) for pref in allowed_prefixes):
        raise ValueError(f"path 不在白名单前缀内: {allowed_prefixes}")

    async def _run(page):
        raw = await _page_request_json(
            page, method_u, p, params=params, body=body
        )
        return {
            "ok": True,
            "source": "douhot.douyin.com",
            "method": method_u,
            "endpoint": p,
            "data": raw.get("data") if isinstance(raw, dict) else raw,
            "raw": raw,
            "queried_at": _now(),
        }

    return await _with_douhot_page(_run)
