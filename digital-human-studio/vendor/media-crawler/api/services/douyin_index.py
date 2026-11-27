# -*- coding: utf-8 -*-
"""抖音指数 / 热点查询：经创作者中心或抖音 Web 热榜拉取（必要时 AES 解密）。"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import quote

from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad

logger = logging.getLogger("api.douyin_index")

# 官方页面返回 data 字段的 AES-CBC 密钥（站点内固定）
_AES_CANDIDATES = [
    ("SjXbYTJb7zXoUToSicUL3A==", "OekMLjghRg8vlX/PemLc+Q=="),
    ("kbSjOqn9O7APLqUZxdCkTQ==", "JuhL1cOV5JH9ojzt2g2EPg=="),
]

CREATOR_INDEX_URL = (
    "https://creator.douyin.com/creator-micro/creator-count/arithmetic-index"
)
HOT_TREND_API = "/api/v2/index/get_multi_keyword_hot_trend"
INTERPRETATION_API = "/api/v2/index/get_multi_keyword_interpretation"
VALID_DATE_API = "/api/v2/index/get_all_valid_date"
CREATOR_HOT_TOPIC_API = "/api/v2/hot/get_current_hot_topic"
HOT_WORDS_API = "/api/v2/index/get_hot_words"
AREA_API = "/api/v2/area/get_all_area"
WEB_HOT_SEARCH_API = (
    "https://www.douyin.com/aweme/v1/web/hot/search/list/"
    "?device_platform=webapp&aid=6383&channel=channel_pc_web"
    "&detail_list=1&source=6"
)

# 抖音热榜 label 常见映射（未知的保留数字）
_HOT_LABEL_MAP = {
    0: None,
    1: "新",
    2: "荐",
    3: "热",
    4: "首发",
    5: "沸",
    6: "同城",
    8: "爆",
    9: "挑战",
    16: "热议",
    17: "独家",
}

_DATE_RE = re.compile(r"^\d{8}$")
_lock = asyncio.Lock()


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _cookie_candidates() -> list[Path]:
    env = (os.getenv("MEDIA_CRAWLER_DATA_DIR") or "").strip()
    roots = []
    if env:
        roots.append(Path(env))
    roots.append(_project_root() / "data")
    roots.append(_project_root())
    paths: list[Path] = []
    for root in roots:
        paths.append(root / "douyin_cookies.txt")
        paths.append(root / ".douyin_cookies.txt")
    paths.append(Path("/app/data/douyin_cookies.txt"))
    paths.append(Path("/opt/mediacrawler/.douyin_cookies.txt"))
    seen = set()
    out = []
    for p in paths:
        key = str(p)
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def load_douyin_cookie_str() -> str:
    for path in _cookie_candidates():
        try:
            if path.is_file():
                text = path.read_text(encoding="utf-8").strip()
                if text:
                    logger.info("[douyin_index] using cookies from %s", path)
                    return text
        except Exception as exc:
            logger.warning("[douyin_index] read cookie %s failed: %s", path, exc)
    return ""


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


def decrypt_index_payload(cipher_b64: str) -> Any:
    raw = base64.b64decode(cipher_b64)
    errors: list[str] = []
    for key_b64, iv_b64 in _AES_CANDIDATES:
        try:
            pt = AES.new(
                base64.b64decode(key_b64),
                AES.MODE_CBC,
                base64.b64decode(iv_b64),
            ).decrypt(raw)
            try:
                pt = unpad(pt, 16)
            except ValueError:
                pt = pt.rstrip(b"\x00")
            return json.loads(pt.decode("utf-8"))
        except Exception as exc:
            errors.append(f"{key_b64[:8]}:{exc}")
    raise RuntimeError("指数数据解密失败: " + "; ".join(errors))


def _normalize_date(value: Optional[str], fallback: str) -> str:
    if not value:
        return fallback
    v = value.strip().replace("-", "")
    if not _DATE_RE.match(v):
        raise ValueError(f"日期格式须为 YYYYMMDD 或 YYYY-MM-DD，收到: {value}")
    return v


def default_date_range(days: int = 7) -> tuple[str, str]:
    # 官方最新日通常滞后 1～2 天
    end = datetime.now() - timedelta(days=2)
    start = end - timedelta(days=max(1, days) - 1)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")


def _normalize_keywords(keywords: list[str]) -> list[str]:
    cleaned = []
    for kw in keywords:
        s = (kw or "").strip()
        if s and s not in cleaned:
            cleaned.append(s)
    if not cleaned:
        raise ValueError("至少提供 1 个关键词")
    if len(cleaned) > 5:
        raise ValueError("最多支持 5 个关键词")
    return cleaned


def _label_name(label: Any) -> Optional[str]:
    try:
        li = int(label)
    except (TypeError, ValueError):
        return str(label) if label not in (None, "") else None
    return _HOT_LABEL_MAP.get(li, str(li) if li else None)


def _hot_url(sentence_id: Any, word: str) -> str:
    sid = str(sentence_id or "").strip()
    if sid and sid.isdigit():
        return f"https://www.douyin.com/hot/{sid}"
    return f"https://www.douyin.com/search/{quote(word or '')}"


def _shape_hot_trend(raw: dict) -> dict:
    """整理为前端友好结构：综合指数 + 搜索指数。"""
    items = []
    for row in raw.get("hot_list") or []:
        items.append(
            {
                "keyword": row.get("keyword"),
                "composite_index": row.get("hot_list") or [],
                "search_index": row.get("search_hot_list") or [],
                "average": row.get("average") or {},
                "last_average": row.get("last_average") or {},
                "last_year_average": row.get("last_year_average") or {},
                "top_points": row.get("top_point_list") or [],
                "search_top_points": row.get("search_top_point_list") or [],
            }
        )
    return {
        "keywords": items,
        "base_resp": raw.get("BaseResp") or {},
        "raw": raw,
    }


def _shape_web_hot_item(item: dict, rank: int) -> dict:
    word = item.get("word") or item.get("sentence") or ""
    sid = item.get("sentence_id")
    label = item.get("label")
    return {
        "rank": int(item.get("position") or rank),
        "title": word,
        "hot_value": int(item.get("hot_value") or 0),
        "label": label,
        "label_name": _label_name(label),
        "sentence_id": str(sid) if sid is not None else None,
        "sentence_tag": item.get("sentence_tag"),
        "video_count": item.get("video_count"),
        "group_id": str(item.get("group_id")) if item.get("group_id") is not None else None,
        "event_time": item.get("event_time"),
        "url": _hot_url(sid, word),
        "source": "web_hot_search",
    }


def _shape_creator_hot_item(item: dict, board: str = "current") -> dict:
    title = item.get("topic_name") or ""
    rank_raw = item.get("rank")
    try:
        rank = int(rank_raw)
    except (TypeError, ValueError):
        rank = 0
    try:
        hot_value = int(item.get("topic_index") or 0)
    except (TypeError, ValueError):
        hot_value = 0
    try:
        vv = int(item.get("vv") or 0)
    except (TypeError, ValueError):
        vv = 0
    try:
        content_cnt = int(item.get("content_cnt") or 0)
    except (TypeError, ValueError):
        content_cnt = 0
    return {
        "rank": rank,
        "title": title,
        "hot_value": hot_value,
        "category": item.get("category") or None,
        "rank_flag": item.get("rank_flag"),
        "content_cnt": content_cnt,
        "vv": vv,
        "url": f"https://www.douyin.com/search/{quote(title)}" if title else None,
        "board": board,
        "source": "creator_hot_topic",
    }


def _shape_hot_word(item: dict, rank: int) -> dict:
    kw = item.get("keyword") or ""
    try:
        index = float(item.get("index") or 0)
    except (TypeError, ValueError):
        index = 0
    try:
        growth = float(item.get("growth") or 0)
    except (TypeError, ValueError):
        growth = 0
    growth_rate = item.get("growth_rate")
    try:
        growth_rate_f = float(growth_rate) if growth_rate is not None else None
    except (TypeError, ValueError):
        growth_rate_f = None
    return {
        "rank": rank,
        "keyword": kw,
        "index": index,
        "growth": growth,
        "growth_rate": growth_rate_f,
        "url": f"https://www.douyin.com/search/{quote(kw)}" if kw else None,
    }


async def _page_post_json(page, path: str, body: dict) -> dict:
    result = await page.evaluate(
        """async ({path, body}) => {
            const r = await fetch(path, {
                method: "POST",
                headers: {
                    "content-type": "application/json;charset=UTF-8",
                    "accept": "application/json, text/plain, */*",
                },
                body: JSON.stringify(body),
                credentials: "include",
            });
            const text = await r.text();
            return { status: r.status, text };
        }""",
        {"path": path, "body": body},
    )
    status = int(result.get("status") or 0)
    text = result.get("text") or ""
    if status != 200:
        raise RuntimeError(f"上游 HTTP {status}: {text[:300]}")
    if text.lstrip().startswith("<"):
        raise RuntimeError("上游返回了登录页/HTML，Cookie 可能已失效，请更新 douyin_cookies.txt")
    try:
        outer = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"上游非 JSON: {text[:200]}") from exc
    st = outer.get("status")
    if st not in (0, None, "0") and "data" not in outer:
        raise RuntimeError(f"上游业务错误: {outer}")
    data_field = outer.get("data")
    if isinstance(data_field, str) and data_field:
        return decrypt_index_payload(data_field)
    if isinstance(data_field, dict):
        return data_field
    raise RuntimeError(f"上游无 data 字段: {str(outer)[:300]}")


async def _page_get_json(page, path: str) -> Any:
    result = await page.evaluate(
        """async (path) => {
            const r = await fetch(path, {
                method: "GET",
                headers: { "accept": "application/json, text/plain, */*" },
                credentials: "include",
            });
            const text = await r.text();
            return { status: r.status, text };
        }""",
        path,
    )
    status = int(result.get("status") or 0)
    text = result.get("text") or ""
    if status != 200:
        raise RuntimeError(f"上游 HTTP {status}: {text[:300]}")
    if text.lstrip().startswith("<"):
        raise RuntimeError("上游返回了登录页/HTML，Cookie 可能已失效，请更新 douyin_cookies.txt")
    try:
        outer = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"上游非 JSON: {text[:200]}") from exc

    # 创作者中心：{status, data: encrypted|object}
    if isinstance(outer, dict) and "data" in outer:
        data_field = outer.get("data")
        if isinstance(data_field, str) and data_field:
            return decrypt_index_payload(data_field)
        if data_field is not None:
            return data_field

    # Web 热榜：{status_code, data: {...}}
    if isinstance(outer, dict) and "status_code" in outer:
        sc = outer.get("status_code")
        if sc not in (0, "0", None):
            raise RuntimeError(f"上游业务错误 status_code={sc}: {str(outer)[:300]}")
        data_field = outer.get("data")
        if data_field is not None:
            return data_field
    return outer


def _require_cookies() -> list[tuple[str, str]]:
    cookie_str = load_douyin_cookie_str()
    if not cookie_str:
        raise RuntimeError(
            "未找到抖音 Cookie。请将 Cookie 写入 data/douyin_cookies.txt 后重试"
        )
    pairs = parse_cookie_pairs(cookie_str)
    if not any(n == "sessionid" for n, _ in pairs):
        raise RuntimeError("Cookie 缺少 sessionid，请重新导出已登录的抖音 Cookie")
    return pairs


async def _with_creator_page(coro_fn: Callable[..., Awaitable[Any]]) -> Any:
    """打开创作者指数页上下文，执行回调（共享 asyncio.Lock）。"""
    pairs = _require_cookies()
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
                context = await browser.new_context(
                    user_agent=(
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                    viewport={"width": 1440, "height": 900},
                )
                cookies = [
                    {"name": n, "value": v, "domain": ".douyin.com", "path": "/"}
                    for n, v in pairs
                ]
                await context.add_cookies(cookies)
                page = await context.new_page()
                await page.goto(
                    CREATOR_INDEX_URL,
                    wait_until="domcontentloaded",
                    timeout=90000,
                )
                await page.wait_for_timeout(2000)
                try:
                    await page.evaluate(
                        """() => {
                          document.querySelectorAll(
                            '.byted-modal-wrapper,.byted-modal-mask,[class*="modal"]'
                          ).forEach(el => {
                            try { el.style.display = 'none'; } catch (e) {}
                          });
                        }"""
                    )
                except Exception:
                    pass
                return await coro_fn(page)
            finally:
                await browser.close()


async def fetch_keyword_index(
    keywords: list[str],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    app_name: str = "aweme",
    region: Optional[list[str]] = None,
    include_interpretation: bool = True,
) -> dict:
    """查询关键词抖音指数（综合 + 搜索）。"""
    kws = _normalize_keywords(keywords)
    d_start, d_end = default_date_range(7)
    start_s = _normalize_date(start_date, d_start)
    end_s = _normalize_date(end_date, d_end)
    if start_s > end_s:
        raise ValueError("start_date 不能晚于 end_date")
    app = (app_name or "aweme").strip() or "aweme"
    regions = region or []

    body = {
        "keyword_list": kws,
        "start_date": start_s,
        "end_date": end_s,
        "app_name": app,
        "region": regions,
    }

    async def _run(page):
        hot_raw = await _page_post_json(page, HOT_TREND_API, body)
        shaped = _shape_hot_trend(hot_raw if isinstance(hot_raw, dict) else {})

        interpretation = None
        if include_interpretation:
            try:
                interpretation = await _page_post_json(
                    page,
                    INTERPRETATION_API,
                    {
                        "keyword_list": kws,
                        "app_name": app,
                        "start_date": start_s,
                        "end_date": end_s,
                        "region": regions,
                    },
                )
            except Exception as exc:
                logger.warning("[douyin_index] interpretation failed: %s", exc)

        valid_dates = None
        try:
            valid_dates = await _page_get_json(page, VALID_DATE_API)
        except Exception as exc:
            logger.warning("[douyin_index] valid_date failed: %s", exc)

        return {
            "ok": True,
            "source": "creator.douyin.com",
            "endpoint": HOT_TREND_API,
            "request": body,
            "keywords": shaped["keywords"],
            "interpretation": interpretation,
            "valid_dates": valid_dates,
            "base_resp": shaped.get("base_resp"),
        }

    return await _with_creator_page(_run)


async def fetch_hot_board(
    limit: int = 50,
    category: Optional[str] = None,
    include_creator: bool = True,
) -> dict:
    """今日热点总榜：优先抖音 Web 热搜完整榜，可选附带创作者中心榜。"""
    limit = max(1, min(int(limit or 50), 100))
    cat = (category or "").strip() or None

    async def _run(page):
        web_raw = await _page_get_json(page, WEB_HOT_SEARCH_API)
        word_list = (web_raw or {}).get("word_list") or []
        items = []
        for i, it in enumerate(word_list, start=1):
            if not isinstance(it, dict):
                continue
            items.append(_shape_web_hot_item(it, i))
        if limit:
            items = items[:limit]

        creator = None
        creator_err = None
        if include_creator:
            try:
                c_raw = await _page_get_json(page, CREATOR_HOT_TOPIC_API)
                current = []
                for it in (c_raw or {}).get("current") or []:
                    if not isinstance(it, dict):
                        continue
                    shaped = _shape_creator_hot_item(it, "current")
                    if cat and (shaped.get("category") or "") != cat:
                        continue
                    current.append(shaped)
                creator = {
                    "count": len(current),
                    "items": current[:limit],
                    "categories": sorted(
                        {
                            x.get("category")
                            for x in current
                            if x.get("category")
                        }
                    ),
                }
            except Exception as exc:
                creator_err = str(exc)
                logger.warning("[douyin_index] creator hot topic failed: %s", exc)

        return {
            "ok": True,
            "board": "hot",
            "title": "抖音热榜",
            "active_time": (web_raw or {}).get("active_time"),
            "count": len(items),
            "items": items,
            "creator": creator,
            "creator_error": creator_err,
            "source": {
                "primary": "www.douyin.com/aweme/v1/web/hot/search/list",
                "secondary": "creator.douyin.com/api/v2/hot/get_current_hot_topic"
                if include_creator
                else None,
            },
            "queried_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

    return await _with_creator_page(_run)


async def fetch_rising_hot(
    limit: int = 30,
    category: Optional[str] = None,
) -> dict:
    """上升榜：Web trending_list + 创作者中心 rocketing。"""
    limit = max(1, min(int(limit or 30), 100))
    cat = (category or "").strip() or None

    async def _run(page):
        web_items = []
        web_err = None
        active_time = None
        try:
            web_raw = await _page_get_json(page, WEB_HOT_SEARCH_API)
            active_time = (web_raw or {}).get("active_time")
            for i, it in enumerate((web_raw or {}).get("trending_list") or [], start=1):
                if isinstance(it, dict):
                    web_items.append(_shape_web_hot_item(it, i))
            web_items = web_items[:limit]
        except Exception as exc:
            web_err = str(exc)
            logger.warning("[douyin_index] web rising failed: %s", exc)

        creator_items = []
        creator_err = None
        try:
            c_raw = await _page_get_json(page, CREATOR_HOT_TOPIC_API)
            for it in (c_raw or {}).get("rocketing") or []:
                if not isinstance(it, dict):
                    continue
                shaped = _shape_creator_hot_item(it, "rocketing")
                if cat and (shaped.get("category") or "") != cat:
                    continue
                creator_items.append(shaped)
            creator_items = creator_items[:limit]
        except Exception as exc:
            creator_err = str(exc)
            logger.warning("[douyin_index] creator rocketing failed: %s", exc)

        # 主列表优先创作者上升榜（更完整约 30 条），Web trending 作补充
        primary = creator_items if creator_items else web_items
        return {
            "ok": True,
            "board": "rising",
            "title": "实时上升热点",
            "active_time": active_time,
            "count": len(primary),
            "items": primary,
            "web_trending": {
                "count": len(web_items),
                "items": web_items,
                "error": web_err,
            },
            "creator_rocketing": {
                "count": len(creator_items),
                "items": creator_items,
                "categories": sorted(
                    {x.get("category") for x in creator_items if x.get("category")}
                ),
                "error": creator_err,
            },
            "note": (
                "上升榜无独立公开路径；数据来自创作者中心 get_current_hot_topic.rocketing "
                "与 Web 热搜 trending_list"
            ),
            "queried_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

    return await _with_creator_page(_run)


async def fetch_hot_words(app_name: str = "aweme", limit: int = 50) -> dict:
    """指数页热词（get_hot_words）。"""
    app = (app_name or "aweme").strip() or "aweme"
    limit = max(1, min(int(limit or 50), 200))

    async def _run(page):
        path = f"{HOT_WORDS_API}?app_name={quote(app)}"
        raw = await _page_get_json(page, path)
        words = []
        for i, it in enumerate((raw or {}).get("hot_words") or [], start=1):
            if isinstance(it, dict):
                words.append(_shape_hot_word(it, i))
        words = words[:limit]
        return {
            "ok": True,
            "app_name": app,
            "count": len(words),
            "items": words,
            "source": "creator.douyin.com/api/v2/index/get_hot_words",
            "queried_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

    return await _with_creator_page(_run)


async def fetch_valid_dates() -> dict:
    """指数可查日期（关键词/品牌/POI）。"""

    async def _run(page):
        raw = await _page_get_json(page, VALID_DATE_API)
        if not isinstance(raw, dict):
            raw = {"raw": raw}
        return {
            "ok": True,
            "keyword_latest_day": raw.get("keyword_latest_day"),
            "keyword_latest_week": raw.get("keyword_latest_week"),
            "brand_latest_day": raw.get("brand_latest_day"),
            "brand_latest_week": raw.get("brand_latest_week"),
            "poi_latest_day": raw.get("poi_latest_day"),
            "poi_latest_week": raw.get("poi_latest_week"),
            "poi_latest_month": raw.get("poi_latest_month"),
            "base_resp": raw.get("BaseResp"),
            "source": "creator.douyin.com/api/v2/index/get_all_valid_date",
            "queried_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "note": "官方指数数据通常滞后 1～2 天",
        }

    return await _with_creator_page(_run)


async def fetch_areas() -> dict:
    """指数可用地区树（供 /index 的 region 参数参考）。"""

    async def _run(page):
        raw = await _page_get_json(page, AREA_API)
        area_list = []
        if isinstance(raw, dict):
            area_list = raw.get("all_area_list") or raw.get("area_list") or []
        elif isinstance(raw, list):
            area_list = raw

        def flatten_provinces(nodes, depth=0):
            out = []
            for n in nodes or []:
                if not isinstance(n, dict):
                    continue
                label = n.get("label")
                if label and depth <= 2:
                    out.append(
                        {
                            "label": label,
                            "value": n.get("value"),
                            "area_level": n.get("area_level"),
                        }
                    )
                # 仅展开到省级便于选用
                if depth < 1:
                    out.extend(flatten_provinces(n.get("children") or [], depth + 1))
            return out

        provinces = flatten_provinces(area_list)
        return {
            "ok": True,
            "count": len(provinces),
            "areas": provinces,
            "source": "creator.douyin.com/api/v2/area/get_all_area",
            "note": "region 传中文名如 [\"北京\",\"上海\"]；空=全国",
            "queried_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

    return await _with_creator_page(_run)
