# -*- coding: utf-8 -*-
"""Keyless Hub demo proxies for landing / playground (rate-limited)."""
from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

from ..services import douyin_index as index_svc
from ..services import map_leads as map_svc

router = APIRouter(prefix="/hub/api", tags=["hub-demo"])

_RL_WINDOW = 60.0
_RL_MAX = 40
_rl_hits: dict = defaultdict(deque)


def _rate_limit(request: Request) -> None:
    ip = (request.client.host if request.client else "unknown") or "unknown"
    now = time.time()
    q = _rl_hits[ip]
    while q and now - q[0] > _RL_WINDOW:
        q.popleft()
    if len(q) >= _RL_MAX:
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
    q.append(now)


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, RuntimeError):
        msg = str(exc)
        code = 401 if ("Cookie" in msg or "登录" in msg or "sessionid" in msg) else 502
        return HTTPException(status_code=code, detail=msg)
    return HTTPException(
        status_code=500,
        detail=f"查询失败: {type(exc).__name__}: {exc}",
    )


@router.get("/hot")
async def hub_hot(
    request: Request,
    limit: int = Query(20, ge=1, le=50),
    include_creator: bool = Query(False),
):
    _rate_limit(request)
    try:
        return await index_svc.fetch_hot_board(
            limit=limit,
            category=None,
            include_creator=include_creator,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/hot/rising")
async def hub_hot_rising(
    request: Request,
    limit: int = Query(20, ge=1, le=50),
):
    _rate_limit(request)
    try:
        return await index_svc.fetch_rising_hot(limit=limit, category=None)
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/hot/words")
async def hub_hot_words(
    request: Request,
    app_name: str = Query("aweme"),
    limit: int = Query(20, ge=1, le=50),
):
    _rate_limit(request)
    try:
        return await index_svc.fetch_hot_words(app_name=app_name, limit=limit)
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/map/search")
async def hub_map_search(
    request: Request,
    keyword: str = Query(...),
    city: Optional[str] = Query(None),
    page: int = Query(1, ge=1, le=20),
    page_size: int = Query(10, ge=1, le=30),
    only_with_phone: bool = Query(False),
):
    _rate_limit(request)
    try:
        return await map_svc.search_text(
            keyword=keyword,
            city=city,
            page=page,
            page_size=page_size,
            source=None,
            city_limit=False,
            only_with_phone=only_with_phone,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/status")
async def hub_status(request: Request):
    _rate_limit(request)
    return {
        "success": True,
        "product": "MediaCrawler Hub",
        "demo": ["hot", "hot/rising", "hot/words", "map/search"],
        "api_base": "/api",
        "docs": "/hub/docs",
        "playground": "/hub/playground",
    }
