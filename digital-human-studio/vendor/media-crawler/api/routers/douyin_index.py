# -*- coding: utf-8 -*-
"""抖音指数 / 今日热点 API。"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.auth import require_api_key
from ..services import douyin_index as index_svc

router = APIRouter(
    prefix="/douyin",
    tags=["douyin-index"],
    dependencies=[Depends(require_api_key)],
)


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


class DouyinIndexRequest(BaseModel):
    keywords: List[str] = Field(
        ...,
        description="关键词列表，1～5 个",
        min_length=1,
        max_length=5,
        examples=[["咖啡"]],
    )
    start_date: Optional[str] = Field(
        default=None,
        description="开始日期 YYYYMMDD 或 YYYY-MM-DD；默认近 7 天（滞后约 2 天）",
    )
    end_date: Optional[str] = Field(
        default=None,
        description="结束日期 YYYYMMDD 或 YYYY-MM-DD",
    )
    app_name: str = Field(default="aweme", description="平台：aweme=抖音，toutiao=头条")
    region: Optional[List[str]] = Field(
        default=None,
        description="地区筛选，空=全国；如 [\"北京\",\"上海\"]",
    )
    include_interpretation: bool = Field(
        default=True,
        description="是否附带综合解读（内容分/搜索分/传播分）",
    )


@router.post("/index")
async def query_douyin_index(body: DouyinIndexRequest):
    """查询抖音指数（关键词综合指数 + 搜索指数日趋势）。

    数据来源：创作者中心「抖音指数」页
    https://creator.douyin.com/creator-micro/creator-count/arithmetic-index
    """
    try:
        return await index_svc.fetch_keyword_index(
            keywords=body.keywords,
            start_date=body.start_date,
            end_date=body.end_date,
            app_name=body.app_name,
            region=body.region,
            include_interpretation=body.include_interpretation,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/index")
async def query_douyin_index_get(
    keywords: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    app_name: str = "aweme",
    region: Optional[str] = None,
    include_interpretation: bool = True,
):
    """GET 便捷接口：keywords 用英文逗号分隔，如 keywords=咖啡,奶茶"""
    kws = [x.strip() for x in keywords.split(",") if x.strip()]
    regions = [x.strip() for x in (region or "").split(",") if x.strip()] or None
    try:
        return await index_svc.fetch_keyword_index(
            keywords=kws,
            start_date=start_date,
            end_date=end_date,
            app_name=app_name,
            region=regions,
            include_interpretation=include_interpretation,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/hot")
async def get_douyin_hot(
    limit: int = Query(50, ge=1, le=100, description="返回条数，默认 50"),
    category: Optional[str] = Query(
        None,
        description="仅过滤创作者中心附带榜的分类，如 科技/娱乐/时政（Web 总榜无分类字段）",
    ),
    include_creator: bool = Query(
        True,
        description="是否附带创作者中心 current 榜（含 category）",
    ),
):
    """今日热点总榜（抖音热搜）。

    优先 www.douyin.com 热搜完整榜（约 50 条）；可附带创作者中心热点。
    """
    try:
        return await index_svc.fetch_hot_board(
            limit=limit,
            category=category,
            include_creator=include_creator,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/hot/rising")
async def get_douyin_hot_rising(
    limit: int = Query(30, ge=1, le=100, description="返回条数，默认 30"),
    category: Optional[str] = Query(
        None,
        description="过滤创作者上升榜分类，如 科技/娱乐",
    ),
):
    """实时上升热点。

    官方无独立 rising 接口；聚合创作者中心 rocketing + Web trending_list。
    """
    try:
        return await index_svc.fetch_rising_hot(limit=limit, category=category)
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/hot/words")
async def get_douyin_hot_words(
    app_name: str = Query("aweme", description="平台：aweme=抖音，toutiao=头条"),
    limit: int = Query(50, ge=1, le=200, description="返回条数"),
):
    """指数页热词（关键词指数热度 / 涨幅）。"""
    try:
        return await index_svc.fetch_hot_words(app_name=app_name, limit=limit)
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/hot/valid-dates")
async def get_douyin_valid_dates():
    """指数可查最新日期（关键词 / 品牌 / POI）。"""
    try:
        return await index_svc.fetch_valid_dates()
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/areas")
async def get_douyin_areas():
    """指数可用地区列表（供 /index 的 region 参数参考）。"""
    try:
        return await index_svc.fetch_areas()
    except Exception as exc:
        raise _http_error(exc) from exc
