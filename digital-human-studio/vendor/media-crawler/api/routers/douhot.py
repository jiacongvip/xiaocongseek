# -*- coding: utf-8 -*-
"""抖音热点中心（douhot.douyin.com）API 路由。"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.auth import AuthContext, require_api_key, require_master
from ..services import douhot as douhot_svc

router = APIRouter(
    prefix="/douyin/douhot",
    tags=["douyin-douhot"],
    dependencies=[Depends(require_api_key)],
)


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, RuntimeError):
        msg = str(exc)
        code = (
            401
            if any(
                k in msg
                for k in (
                    "授权",
                    "未登录",
                    "OAuth",
                    "Cookie",
                    "登录态",
                    "storage_state",
                )
            )
            else 502
        )
        return HTTPException(status_code=code, detail=msg)
    return HTTPException(
        status_code=500,
        detail=f"douhot 查询失败: {type(exc).__name__}: {exc}",
    )


@router.get("/status")
async def douhot_status():
    """检查 douhot 授权状态；未授权时返回 how_to（HTTP 200 + authorized=false）。"""
    try:
        return await douhot_svc.check_auth()
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/billboard/{board}")
async def douhot_billboard(
    board: str,
    page: int = Query(1, ge=1, le=100),
    page_size: int = Query(50, ge=1, le=100),
    limit: int = Query(50, ge=1, le=200, description="返回条数裁剪"),
    keyword: Optional[str] = None,
    city_code: Optional[str] = Query(None, description="同城榜城市码"),
    sentence_tag: Optional[str] = Query(None, description="分类 tag，多个逗号分隔"),
    order: Optional[str] = None,
    board_type: Optional[str] = Query(
        None, alias="type", description="日期类型等，如 snapshot"
    ),
    start_date: Optional[str] = Query(None, description="YYYYMMDD"),
    end_date: Optional[str] = Query(None, description="YYYYMMDD"),
    snapshot_time: Optional[str] = Query(None, description="YYYYMMDDHHmmss"),
):
    """热点榜：total / rise / city / challenge。"""
    try:
        return await douhot_svc.fetch_billboard(
            board,
            page=page,
            page_size=page_size,
            keyword=keyword,
            city_code=city_code,
            sentence_tag=sentence_tag,
            order=order,
            type_=board_type,
            start_date=start_date,
            end_date=end_date,
            snapshot_time=snapshot_time,
            limit=limit,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/hot")
async def douhot_hot_alias(
    page: int = Query(1, ge=1, le=100),
    page_size: int = Query(50, ge=1, le=100),
    limit: int = Query(50, ge=1, le=200),
    keyword: Optional[str] = None,
    sentence_tag: Optional[str] = None,
):
    """便捷：总榜 = billboard/total。"""
    try:
        return await douhot_svc.fetch_billboard(
            "total",
            page=page,
            page_size=page_size,
            keyword=keyword,
            sentence_tag=sentence_tag,
            limit=limit,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/rising")
async def douhot_rising_alias(
    page: int = Query(1, ge=1, le=100),
    page_size: int = Query(50, ge=1, le=100),
    limit: int = Query(50, ge=1, le=200),
    keyword: Optional[str] = None,
    sentence_tag: Optional[str] = None,
    order: Optional[str] = None,
):
    """便捷：上升榜 = billboard/rise。"""
    try:
        return await douhot_svc.fetch_billboard(
            "rise",
            page=page,
            page_size=page_size,
            keyword=keyword,
            sentence_tag=sentence_tag,
            order=order,
            limit=limit,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/distribution")
async def douhot_distribution(
    billboard_type: Optional[str] = None,
    keyword: Optional[str] = None,
    city_code: Optional[str] = None,
    board_type: Optional[str] = Query(None, alias="type"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    snapshot_time: Optional[str] = None,
):
    """榜单分类分布（billboard/distribution）。"""
    try:
        return await douhot_svc.fetch_distribution(
            billboard_type=billboard_type,
            keyword=keyword,
            city_code=city_code,
            type_=board_type,
            start_date=start_date,
            end_date=end_date,
            snapshot_time=snapshot_time,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/common/{kind}")
async def douhot_common(kind: str):
    """公共数据：city / category / fans_config。"""
    try:
        return await douhot_svc.fetch_common(kind)
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/sentence/{sentence_id}")
async def douhot_sentence(
    sentence_id: str,
    part: str = Query(
        "timeline",
        description="timeline/index/videos/trends/hot_analysis/word_cloud/comments",
    ),
    page: int = Query(1, ge=1, le=100),
    page_size: int = Query(30, ge=1, le=100),
    keyword: Optional[str] = None,
):
    """话题/热点详情。"""
    try:
        return await douhot_svc.fetch_sentence(
            sentence_id,
            part=part,
            page=page,
            page_size=page_size,
            keyword=keyword,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/sentence/{sentence_id}/{part}")
async def douhot_sentence_part(
    sentence_id: str,
    part: str,
    page: int = Query(1, ge=1, le=100),
    page_size: int = Query(30, ge=1, le=100),
    keyword: Optional[str] = None,
):
    """话题详情子资源（路径形式）。"""
    try:
        return await douhot_svc.fetch_sentence(
            sentence_id,
            part=part,
            page=page,
            page_size=page_size,
            keyword=keyword,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


class HotWordsRequest(BaseModel):
    page_num: int = Field(1, ge=1, le=100)
    page_size: int = Field(20, ge=1, le=100)
    keyword: Optional[str] = None
    date_window: Optional[str] = Field(
        None, description="时间窗，站点内部枚举，如近7天对应值"
    )
    first_tag: Optional[str] = None
    sub_type: Optional[str] = None


@router.post("/hot-words")
async def douhot_hot_words(body: HotWordsRequest):
    """热点趋势词列表（POST /dashboard/hot_word/query_list）。"""
    try:
        return await douhot_svc.fetch_hot_words(
            page_num=body.page_num,
            page_size=body.page_size,
            keyword=body.keyword,
            date_window=body.date_window,
            first_tag=body.first_tag,
            sub_type=body.sub_type,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/hot-words")
async def douhot_hot_words_get(
    page_num: int = Query(1, ge=1, le=100),
    page_size: int = Query(20, ge=1, le=100),
    keyword: Optional[str] = None,
    date_window: Optional[str] = None,
    first_tag: Optional[str] = None,
    sub_type: Optional[str] = None,
):
    """热点趋势词列表（GET 便捷）。"""
    try:
        return await douhot_svc.fetch_hot_words(
            page_num=page_num,
            page_size=page_size,
            keyword=keyword,
            date_window=date_window,
            first_tag=first_tag,
            sub_type=sub_type,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/hot-words/detail")
async def douhot_hot_word_detail(
    word_id: Optional[str] = None,
    keyword: Optional[str] = None,
):
    """热词详情。"""
    params = {k: v for k, v in {"word_id": word_id, "keyword": keyword}.items() if v}
    if not params:
        raise HTTPException(status_code=400, detail="需要 word_id 或 keyword")
    try:
        return await douhot_svc.fetch_hot_word_detail(params)
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/hot-words/trends")
async def douhot_hot_word_trends(
    word_id: Optional[str] = None,
    keyword: Optional[str] = None,
):
    """热词趋势。"""
    params = {k: v for k, v in {"word_id": word_id, "keyword": keyword}.items() if v}
    if not params:
        raise HTTPException(status_code=400, detail="需要 word_id 或 keyword")
    try:
        return await douhot_svc.fetch_hot_word_trends(params)
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/hot-search")
async def douhot_hot_search():
    """热搜查询列表（dashboard/hot_search/query_list）。"""
    try:
        return await douhot_svc.fetch_hot_search()
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/calendar")
async def douhot_calendar(
    action: str = Query(
        "query_list",
        description="query_list/holiday_list/future_event/publish_list/item_list",
    ),
):
    """活动日历。"""
    try:
        return await douhot_svc.fetch_calendar(action=action)
    except Exception as exc:
        raise _http_error(exc) from exc


class RawRequest(BaseModel):
    method: str = Field("GET", description="GET 或 POST")
    path: str = Field(..., description="相对路径，如 /billboard/total")
    params: Optional[Dict[str, Any]] = None
    body: Optional[Dict[str, Any]] = None


@router.post("/raw")
async def douhot_raw(body: RawRequest):
    """受限透传已发现的 douhot/v1 接口（白名单前缀）。"""
    try:
        return await douhot_svc.fetch_raw(
            body.method,
            body.path,
            params=body.params,
            body=body.body,
        )
    except Exception as exc:
        raise _http_error(exc) from exc




class DouhotCookiesBody(BaseModel):
    cookies: str = Field(..., description="Cookie 头字符串、[{name,value}] JSON，或 Playwright storage_state JSON")


@router.post("/cookies")
async def douhot_save_cookies(
    body: DouhotCookiesBody,
    auth: AuthContext = Depends(require_api_key),
):
    """写入 douhot Cookie / storage_state（仅 Master Key）。"""
    require_master(auth)
    try:
        path = douhot_svc.save_cookies_text(body.cookies)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"写入失败: {exc}") from exc
    # Recheck auth when possible
    status = None
    try:
        status = await douhot_svc.check_auth()
    except Exception as exc:
        status = {"authorized": False, "error": str(exc)}
    return {
        "success": True,
        "saved_to": str(path),
        "status": status,
        "note": "已写入。若 authorized 仍为 false，请确认 Cookie 来自已授权的 douhot.douyin.com 会话。",
    }


@router.get("/endpoints")
async def douhot_endpoints():
    """已接入 / 已发现的 douhot 能力清单（说明用）。"""
    return {
        "ok": True,
        "site": "https://douhot.douyin.com/",
        "oauth_app": "生活服务热点中心",
        "oauth_client_key": "awuu67pp4wjdf1hg",
        "auth_note": (
            "需单独扫码 OAuth；Cookie 写入 data/douhot_cookies.txt 或 "
            "storage_state 写入 data/douhot_storage_state.json"
        ),
        "our_routes": [
            "GET  /api/douyin/douhot/status",
            "GET  /api/douyin/douhot/hot",
            "GET  /api/douyin/douhot/rising",
            "GET  /api/douyin/douhot/billboard/{total|rise|city|challenge}",
            "GET  /api/douyin/douhot/distribution",
            "GET  /api/douyin/douhot/common/{city|category|fans_config}",
            "GET  /api/douyin/douhot/sentence/{id}?part=...",
            "GET  /api/douyin/douhot/sentence/{id}/{part}",
            "GET|POST /api/douyin/douhot/hot-words",
            "GET  /api/douyin/douhot/hot-words/detail",
            "GET  /api/douyin/douhot/hot-words/trends",
            "GET  /api/douyin/douhot/hot-search",
            "GET  /api/douyin/douhot/calendar",
            "POST /api/douyin/douhot/raw",
            "GET  /api/douyin/douhot/endpoints",
        ],
        "upstream_examples": [
            "GET  /douhot/v1/user/user_info",
            "GET  /douhot/v1/billboard/total|rise|city|challenge",
            "GET  /douhot/v1/billboard/distribution",
            "GET  /douhot/v1/common/city|category",
            "GET  /douhot/v1/sentence/{id}/sentence_timeline|sentence_item|index|trends|hot_analysis",
            "GET  /douhot/v1/sentence/{id}/comment_analysis/word_cloud|comment_list",
            "POST /douhot/v1/dashboard/hot_word/query_list",
            "GET  /douhot/v1/dashboard/hot_word/detail|trends",
            "GET  /douhot/v1/dashboard/hot_search/query_list",
            "GET  /douhot/v1/calendar/query_list|holiday_list|future_event",
            "GET  /douhot/v1/material/video_billboard|challenge_billboard",
        ],
    }
