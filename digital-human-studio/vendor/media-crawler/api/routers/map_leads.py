# -*- coding: utf-8 -*-
"""地图获客 API：关键词 / 周边搜商家，返回店名、电话、地址（默认无需地图 Key）。"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.auth import require_api_key
from ..services import map_leads as map_svc

router = APIRouter(
    prefix="/map",
    tags=["map-leads"],
    dependencies=[Depends(require_api_key)],
)


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, RuntimeError):
        return HTTPException(status_code=502, detail=str(exc))
    return HTTPException(
        status_code=500,
        detail=f"地图获客失败: {type(exc).__name__}: {exc}",
    )


class TextSearchBody(BaseModel):
    keyword: str = Field(..., description="行业/关键词，如 咖啡店、装修公司")
    city: Optional[str] = Field(None, description="城市，如 杭州、北京市、330100")
    page: int = Field(1, ge=1, le=100)
    page_size: int = Field(20, ge=1, le=50)
    source: Optional[str] = Field(
        None,
        description="amap_web/web（默认，无需Key）| amap（需Key）| baidu（需AK）",
    )
    city_limit: bool = Field(False, description="官方API：是否限制在 city 范围内")
    only_with_phone: bool = Field(False, description="只返回有电话的门店")
    dedupe: bool = Field(True, description="按 poi_id / 电话去重")


class AroundSearchBody(BaseModel):
    keyword: str = Field(..., description="关键词")
    lng: float = Field(..., description="中心点经度")
    lat: float = Field(..., description="中心点纬度")
    radius: int = Field(3000, ge=1, le=50000, description="半径米，默认 3000（官方API生效）")
    page: int = Field(1, ge=1, le=100)
    page_size: int = Field(20, ge=1, le=50)
    source: Optional[str] = None
    only_with_phone: bool = False
    dedupe: bool = True


class BatchSearchBody(BaseModel):
    keywords: List[str] = Field(..., min_length=1, max_length=10, description="最多 10 个关键词")
    city: Optional[str] = None
    page_size: int = Field(20, ge=1, le=50)
    source: Optional[str] = None
    only_with_phone: bool = False
    city_limit: bool = True
    dedupe: bool = True


@router.get("/status")
async def map_status():
    """查看采集模式：web（无需Key）/ amap_api / 是否 ready。"""
    return {"success": True, **map_svc.configured_sources()}


@router.get("/search")
async def search_text_get(
    keyword: str = Query(..., description="关键词，如 奶茶店"),
    city: Optional[str] = Query(None, description="城市"),
    page: int = Query(1, ge=1, le=100),
    page_size: int = Query(20, ge=1, le=50),
    source: Optional[str] = Query(None, description="amap_web / amap / baidu"),
    city_limit: bool = Query(False),
    only_with_phone: bool = Query(False, description="只返回有电话的"),
    dedupe: bool = Query(True, description="按 poi_id / 电话去重"),
):
    """关键词搜商家（城市 + 关键词）。默认抓取 amap.com 公开页，无需 Key。"""
    try:
        return await map_svc.search_text(
            keyword=keyword,
            city=city,
            page=page,
            page_size=page_size,
            source=source,
            city_limit=city_limit,
            only_with_phone=only_with_phone,
            dedupe=dedupe,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.post("/search")
async def search_text_post(body: TextSearchBody):
    """关键词搜商家（POST）。"""
    try:
        return await map_svc.search_text(
            keyword=body.keyword,
            city=body.city,
            page=body.page,
            page_size=body.page_size,
            source=body.source,
            city_limit=body.city_limit,
            only_with_phone=body.only_with_phone,
            dedupe=body.dedupe,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/nearby")
async def search_nearby_get(
    keyword: str = Query(...),
    lng: float = Query(..., description="经度"),
    lat: float = Query(..., description="纬度"),
    radius: int = Query(3000, ge=1, le=50000),
    page: int = Query(1, ge=1, le=100),
    page_size: int = Query(20, ge=1, le=50),
    source: Optional[str] = None,
    only_with_phone: bool = False,
    dedupe: bool = Query(True),
):
    """周边搜商家。无 Key 时：反查城市后按关键词搜（半径仅官方API精确）。"""
    try:
        return await map_svc.search_around(
            keyword=keyword,
            lng=lng,
            lat=lat,
            radius=radius,
            page=page,
            page_size=page_size,
            source=source,
            only_with_phone=only_with_phone,
            dedupe=dedupe,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.post("/nearby")
async def search_nearby_post(body: AroundSearchBody):
    """周边搜商家（POST）。"""
    try:
        return await map_svc.search_around(
            keyword=body.keyword,
            lng=body.lng,
            lat=body.lat,
            radius=body.radius,
            page=body.page,
            page_size=body.page_size,
            source=body.source,
            only_with_phone=body.only_with_phone,
            dedupe=body.dedupe,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.post("/batch")
async def batch_search(body: BatchSearchBody):
    """批量关键词搜（同城多行业），自动按 poi_id/店名去重。"""
    try:
        return await map_svc.batch_search(
            keywords=body.keywords,
            city=body.city,
            page_size=body.page_size,
            source=body.source,
            only_with_phone=body.only_with_phone,
            city_limit=body.city_limit,
            dedupe=body.dedupe,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/poi/{poi_id}")
async def get_poi_detail(
    poi_id: str,
    source: Optional[str] = Query(None, description="amap_web / amap / baidu"),
):
    """按 POI ID 查详情（含公开电话）。例：B0L257DBXI"""
    try:
        return await map_svc.poi_detail(poi_id=poi_id, source=source)
    except Exception as exc:
        raise _http_error(exc) from exc


@router.get("/endpoints")
async def list_endpoints():
    """地图获客接口清单。"""
    return {
        "success": True,
        "prefix": "/api/map",
        "mode_default": "amap_web (无需 Key，抓取 amap.com 公开页)",
        "endpoints": [
            {"method": "GET", "path": "/api/map/status", "desc": "模式/就绪状态"},
            {"method": "GET/POST", "path": "/api/map/search", "desc": "关键词+城市搜商家"},
            {"method": "GET/POST", "path": "/api/map/nearby", "desc": "经纬度周边搜"},
            {"method": "POST", "path": "/api/map/batch", "desc": "多关键词批量搜"},
            {"method": "GET", "path": "/api/map/poi/{poi_id}", "desc": "POI 详情"},
        ],
        "lead_fields": [
            "name",
            "phone",
            "tel",
            "address",
            "location",
            "category",
            "source",
            "poi_id",
            "city",
            "province",
            "district",
            "distance",
        ],
        "note": (
            "默认 source=amap_web：电话来自商家在高德地图公开填写的联系方式；"
            "page_size 最大 50；请控制频率。可选配置 AMAP_WEB_KEY 走官方 API 更快。"
        ),
    }

# === public map UI proxy (no API key) ===
# Same-origin frontend calls these; programmatic clients keep using /api/map/* + X-API-Key.
import time
from collections import defaultdict, deque

from fastapi import Request

public_router = APIRouter(prefix="/map/api", tags=["map-leads-ui"])

# Light per-IP rate limit for the keyless UI proxy (private server).
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


@public_router.get("/status")
async def ui_map_status(request: Request):
    _rate_limit(request)
    return {"success": True, **map_svc.configured_sources()}


@public_router.get("/search")
async def ui_search_text(
    request: Request,
    keyword: str = Query(..., description="关键词"),
    city: Optional[str] = Query(None),
    page: int = Query(1, ge=1, le=100),
    page_size: int = Query(20, ge=1, le=50),
    source: Optional[str] = Query(None),
    city_limit: bool = Query(False),
    only_with_phone: bool = Query(False),
    dedupe: bool = Query(True),
):
    _rate_limit(request)
    try:
        return await map_svc.search_text(
            keyword=keyword,
            city=city,
            page=page,
            page_size=page_size,
            source=source,
            city_limit=city_limit,
            only_with_phone=only_with_phone,
            dedupe=dedupe,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@public_router.get("/nearby")
async def ui_search_nearby(
    request: Request,
    keyword: str = Query(...),
    lng: float = Query(...),
    lat: float = Query(...),
    radius: int = Query(3000, ge=1, le=50000),
    page: int = Query(1, ge=1, le=100),
    page_size: int = Query(20, ge=1, le=50),
    source: Optional[str] = None,
    only_with_phone: bool = False,
    dedupe: bool = Query(True),
):
    _rate_limit(request)
    try:
        return await map_svc.search_around(
            keyword=keyword,
            lng=lng,
            lat=lat,
            radius=radius,
            page=page,
            page_size=page_size,
            source=source,
            only_with_phone=only_with_phone,
            dedupe=dedupe,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@public_router.get("/poi/{poi_id}")
async def ui_poi_detail(
    request: Request,
    poi_id: str,
    source: Optional[str] = Query(None),
):
    _rate_limit(request)
    try:
        return await map_svc.poi_detail(poi_id=poi_id, source=source)
    except Exception as exc:
        raise _http_error(exc) from exc
