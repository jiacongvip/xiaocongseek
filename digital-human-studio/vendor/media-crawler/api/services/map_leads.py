# -*- coding: utf-8 -*-
"""地图获客：默认抓取 amap.com 公开 SEO 页（无需 Key）；若配置了高德/百度 Web Key 则可走官方 API。"""
from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import httpx

AMAP_TEXT_URL = "https://restapi.amap.com/v3/place/text"
AMAP_AROUND_URL = "https://restapi.amap.com/v3/place/around"
AMAP_DETAIL_URL = "https://restapi.amap.com/v3/place/detail"
BAIDU_SEARCH_URL = "https://api.map.baidu.com/place/v2/search"
BAIDU_DETAIL_URL = "https://api.map.baidu.com/place/v2/detail"

AMAP_WEB_SEARCH = "https://www.amap.com/search"
AMAP_WEB_SEARCH_ALT = "https://amap.com/search"
AMAP_WEB_PLACE = "https://amap.com/ssr/place/{poi_id}"
AMAP_WEB_PLACE_ALT = "https://www.amap.com/place/{poi_id}"
AMAP_WEB_REGEO = "https://www.amap.com/service/regeo"

# 兼容多种环境变量命名
_AMAP_ENV_NAMES = ("AMAP_WEB_KEY", "AMAP_KEY", "GAODE_KEY", "GAODE_WEB_KEY")
_BAIDU_ENV_NAMES = ("BAIDU_MAP_AK", "BAIDU_AK", "BAIDU_MAP_KEY")

_BOT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

_PHONE_RE = re.compile(
    r"(?:联系)?电话[：:]\s*([0-9\-;，,\s/]{5,40})"
)
_POI_ID_RE = re.compile(r"/place/(B0[A-Z0-9]+)")
_COORD_RE = re.compile(r"地理坐标[：:]\s*([\d.]+)\s*,\s*([\d.]+)")

# 网页抓取限流
_WEB_CONCURRENCY = 3
_WEB_DETAIL_DELAY = 0.35
_MAX_PAGE_SIZE = 50
_SEO_PAGE_SIZE = 10  # amap SEO 搜索每页约 10 条


def _first_env(*names: str) -> str:
    for name in names:
        val = (os.environ.get(name) or "").strip()
        if val:
            return val
    return ""


def get_amap_key() -> str:
    return _first_env(*_AMAP_ENV_NAMES)


def get_baidu_ak() -> str:
    return _first_env(*_BAIDU_ENV_NAMES)



def dedupe_leads(leads: List[Dict[str, Any]], enabled: bool = True) -> List[Dict[str, Any]]:
    """Deduplicate by poi_id first, then by phone, then by name|address."""
    if not enabled:
        return list(leads or [])
    out: List[Dict[str, Any]] = []
    seen_poi: set = set()
    seen_phone: set = set()
    seen_name: set = set()
    for lead in leads or []:
        if not isinstance(lead, dict):
            continue
        poi = (lead.get("poi_id") or "").strip()
        phone = (lead.get("phone") or lead.get("tel") or "").strip()
        name_key = ((lead.get("name") or "").strip() + "|" + (lead.get("address") or "").strip()).lower()
        if poi:
            if poi in seen_poi:
                continue
            seen_poi.add(poi)
        elif phone:
            if phone in seen_phone:
                continue
            seen_phone.add(phone)
        elif name_key and name_key != "|":
            if name_key in seen_name:
                continue
            seen_name.add(name_key)
        out.append(lead)
    return out

def configured_sources() -> Dict[str, Any]:
    amap = bool(get_amap_key())
    baidu = bool(get_baidu_ak())
    if amap:
        mode = "amap_api"
    else:
        mode = "web"
    return {
        "amap": amap,
        "baidu": baidu,
        "web": True,
        "mode": mode,
        "default": "amap" if amap else "amap_web",
        "authorized": True,
        "ready": True,
        "env_vars": {
            "amap": list(_AMAP_ENV_NAMES),
            "baidu": list(_BAIDU_ENV_NAMES),
        },
        "how_to": (
            "默认无需 Key：直接抓取 amap.com 公开地点页（店名/电话/地址）。"
            "若配置了 AMAP_WEB_KEY 或 BAIDU_MAP_AK，可更快走官方 Web 服务 API。"
            "source=amap_web|web 强制网页；source=amap|baidu 走官方 Key。"
        ),
    }


def resolve_source(preferred: Optional[str] = None) -> str:
    """返回内部源：amap | baidu | amap_web"""
    preferred = (preferred or "").strip().lower() or None
    amap = get_amap_key()
    baidu = get_baidu_ak()
    if preferred in ("amap_web", "web", "gaode_web", "高德网页"):
        return "amap_web"
    if preferred in ("amap", "gaode", "高德"):
        if amap:
            return "amap"
        # 无 Key 时自动降级网页，不报错
        return "amap_web"
    if preferred in ("baidu", "百度"):
        if not baidu:
            raise ValueError(
                "未配置百度 AK。请在 /opt/mediacrawler/.env 设置 BAIDU_MAP_AK，"
                "或改用 source=amap_web（无需 Key）。"
            )
        return "baidu"
    # 默认：有高德 Key 用官方，否则网页
    if amap:
        return "amap"
    if baidu and preferred is None:
        # 仅当显式想用百度时才默认百度；默认优先网页高德公开页
        pass
    return "amap_web"


def _norm_tel(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    if isinstance(raw, list):
        parts = [str(x).strip() for x in raw if str(x).strip()]
        return ";".join(parts) if parts else None
    s = str(raw).strip()
    if not s or s in ("[]", "null", "None"):
        return None
    if s.startswith("[") and s.endswith("]"):
        return None
    # 清理中文逗号等
    s = s.replace("，", ";").replace(",", ";").replace(" ", "")
    s = re.sub(r";+", ";", s).strip(";")
    return s or None


def _split_location(loc: Any) -> Tuple[Optional[float], Optional[float]]:
    if loc is None:
        return None, None
    if isinstance(loc, dict):
        lng = loc.get("lng") or loc.get("lon") or loc.get("longitude")
        lat = loc.get("lat") or loc.get("latitude")
        try:
            return (float(lng) if lng is not None else None, float(lat) if lat is not None else None)
        except (TypeError, ValueError):
            return None, None
    s = str(loc).strip()
    if "," in s:
        a, b = s.split(",", 1)
        try:
            return float(a.strip()), float(b.strip())
        except ValueError:
            return None, None
    return None, None


def _shape_amap_poi(poi: Dict[str, Any]) -> Dict[str, Any]:
    lng, lat = _split_location(poi.get("location"))
    address_parts = [
        poi.get("pname") or "",
        poi.get("cityname") or "",
        poi.get("adname") or "",
        poi.get("address") or "",
    ]
    address = "".join(str(p) for p in address_parts if p and p != "[]")
    if not address:
        address = str(poi.get("address") or "") or None
    biz = poi.get("business") if isinstance(poi.get("business"), dict) else {}
    tel = _norm_tel(poi.get("tel")) or _norm_tel(biz.get("tel")) or _norm_tel(biz.get("phone"))
    return {
        "name": poi.get("name") or "",
        "phone": tel,
        "tel": tel,
        "address": address,
        "location": {"lng": lng, "lat": lat} if lng is not None and lat is not None else None,
        "category": poi.get("type") or None,
        "typecode": poi.get("typecode") or None,
        "source": "amap",
        "poi_id": poi.get("id") or None,
        "city": poi.get("cityname") or None,
        "province": poi.get("pname") or None,
        "district": poi.get("adname") or None,
        "distance": poi.get("distance") or None,
    }


def _shape_baidu_poi(poi: Dict[str, Any]) -> Dict[str, Any]:
    loc = poi.get("location") or {}
    lng = loc.get("lng")
    lat = loc.get("lat")
    try:
        lng_f = float(lng) if lng is not None else None
        lat_f = float(lat) if lat is not None else None
    except (TypeError, ValueError):
        lng_f, lat_f = None, None
    detail = poi.get("detail_info") if isinstance(poi.get("detail_info"), dict) else {}
    tel = _norm_tel(poi.get("telephone")) or _norm_tel(detail.get("telephone"))
    return {
        "name": poi.get("name") or "",
        "phone": tel,
        "tel": tel,
        "address": poi.get("address") or None,
        "location": {"lng": lng_f, "lat": lat_f} if lng_f is not None and lat_f is not None else None,
        "category": (detail.get("tag") or poi.get("detail") or None),
        "typecode": detail.get("type") or None,
        "source": "baidu",
        "poi_id": poi.get("uid") or None,
        "city": (poi.get("city") or detail.get("city") or None),
        "province": poi.get("province") or None,
        "district": poi.get("area") or None,
        "distance": detail.get("distance") or poi.get("distance") or None,
    }


def _shape_web_lead(data: Dict[str, Any]) -> Dict[str, Any]:
    tel = _norm_tel(data.get("phone") or data.get("tel") or data.get("telephone"))
    lng = data.get("lng")
    lat = data.get("lat")
    try:
        lng_f = float(lng) if lng is not None else None
        lat_f = float(lat) if lat is not None else None
    except (TypeError, ValueError):
        lng_f, lat_f = None, None
    return {
        "name": data.get("name") or "",
        "phone": tel,
        "tel": tel,
        "address": data.get("address") or None,
        "location": {"lng": lng_f, "lat": lat_f} if lng_f is not None and lat_f is not None else None,
        "category": data.get("category") or None,
        "typecode": None,
        "source": "amap_web",
        "poi_id": data.get("poi_id") or None,
        "city": data.get("city") or None,
        "province": data.get("province") or None,
        "district": data.get("district") or None,
        "distance": data.get("distance") or None,
    }


async def _amap_get(url: str, params: Dict[str, Any]) -> Dict[str, Any]:
    key = get_amap_key()
    params = {**params, "key": key}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
    status = str(data.get("status", ""))
    if status != "1":
        info = data.get("info") or data.get("infocode") or "unknown"
        raise RuntimeError(f"高德地图接口错误: {info}")
    return data


async def _baidu_get(url: str, params: Dict[str, Any]) -> Dict[str, Any]:
    ak = get_baidu_ak()
    params = {**params, "ak": ak, "output": "json"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
    status = data.get("status")
    if status != 0:
        msg = data.get("message") or data.get("msg") or str(status)
        raise RuntimeError(f"百度地图接口错误: {msg}")
    return data


def _parse_ldjson_blocks(html: str) -> List[Any]:
    out: List[Any] = []
    for m in re.finditer(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.S | re.I,
    ):
        raw = m.group(1).strip()
        if not raw:
            continue
        try:
            out.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return out


def _pick_local_business(blocks: List[Any]) -> Optional[Dict[str, Any]]:
    for b in blocks:
        if not isinstance(b, dict):
            continue
        t = b.get("@type")
        types = t if isinstance(t, list) else [t]
        for tt in types:
            if not tt:
                continue
            if str(tt) in (
                "LocalBusiness",
                "Restaurant",
                "Store",
                "Organization",
                "Place",
                "Corporation",
                "FoodEstablishment",
            ) or "Business" in str(tt):
                # skip the site Organization (高德地图)
                if b.get("name") in ("高德地图", "Amap", "AutoNavi"):
                    continue
                if b.get("telephone") or b.get("address") or b.get("geo"):
                    return b
    return None


def _parse_place_html(html: str, poi_id: str) -> Dict[str, Any]:
    data: Dict[str, Any] = {"poi_id": poi_id}
    for block in _parse_ldjson_blocks(html):
        biz = _pick_local_business([block]) if isinstance(block, dict) else None
        if not biz and isinstance(block, dict) and block.get("@type") in (
            "Restaurant",
            "LocalBusiness",
            "Store",
            "FoodEstablishment",
            "Corporation",
        ):
            biz = block
        if biz:
            data["name"] = biz.get("name") or data.get("name")
            data["phone"] = biz.get("telephone") or data.get("phone")
            addr = biz.get("address")
            if isinstance(addr, dict):
                data["address"] = addr.get("streetAddress") or data.get("address")
                data["city"] = addr.get("addressLocality") or data.get("city")
            elif isinstance(addr, str):
                data["address"] = addr
            geo = biz.get("geo")
            if isinstance(geo, dict):
                data["lat"] = geo.get("latitude")
                data["lng"] = geo.get("longitude")
            break

    desc_m = re.search(
        r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)["\']',
        html,
        re.I,
    ) or re.search(
        r'<meta\s+content=["\']([^"\']+)["\']\s+name=["\']description["\']',
        html,
        re.I,
    )
    desc = desc_m.group(1) if desc_m else ""
    if desc:
        pm = _PHONE_RE.search(desc)
        if pm and not data.get("phone"):
            data["phone"] = pm.group(1).strip()
        # 位于X（完整地址）
        am = re.search(r"位于([^（(]+)[（(]([^）)]+)[）)]", desc)
        if am:
            data.setdefault("district", am.group(1).strip())
            data.setdefault("address", am.group(2).strip())
        elif not data.get("address"):
            am2 = re.search(r"地址[：:]\s*([^。；;]+)", desc)
            if am2:
                data["address"] = am2.group(1).strip()

    title_m = re.search(r"<title>([^<]+)</title>", html, re.I)
    if title_m:
        title = title_m.group(1)
        # 名称 - 区 - 分类 |
        parts = [p.strip() for p in title.split(" - ")]
        if parts and not data.get("name"):
            data["name"] = parts[0].split("|")[0].strip()
        if len(parts) >= 3 and not data.get("category"):
            data["category"] = parts[2].split("|")[0].strip()
        elif len(parts) >= 2 and not data.get("category"):
            maybe_cat = parts[1].split("|")[0].strip()
            if "公司" in maybe_cat or ";" in maybe_cat or "服务" in maybe_cat or "厅" in maybe_cat:
                data["category"] = maybe_cat

    cm = _COORD_RE.search(html)
    if cm:
        data.setdefault("lat", cm.group(1))
        data.setdefault("lng", cm.group(2))

    # 正文里的 电话：
    if not data.get("phone"):
        pm = _PHONE_RE.search(html)
        if pm:
            data["phone"] = pm.group(1).strip()

    return data


def _parse_search_html(html: str) -> Tuple[List[Dict[str, Any]], int]:
    """从 SEO 搜索页提取 POI 列表与总数。"""
    total = 0
    tm = re.search(r"约\s*([\d,]+)\s*条", html)
    if not tm:
        tm = re.search(r"共找到约?\s*([\d,]+)\s*家", html)
    if tm:
        try:
            total = int(tm.group(1).replace(",", ""))
        except ValueError:
            total = 0

    # JSON-LD ItemList
    items_by_pos: Dict[int, Dict[str, Any]] = {}
    for block in _parse_ldjson_blocks(html):
        if not isinstance(block, dict):
            continue
        if block.get("@type") == "ItemList":
            if not total:
                try:
                    total = int(block.get("numberOfItems") or 0)
                except (TypeError, ValueError):
                    pass
            for el in block.get("itemListElement") or []:
                if not isinstance(el, dict):
                    continue
                pos = int(el.get("position") or 0)
                item = el.get("item") if isinstance(el.get("item"), dict) else el
                name = item.get("name")
                addr = item.get("address")
                address = None
                city = None
                if isinstance(addr, dict):
                    address = addr.get("streetAddress")
                    city = addr.get("addressLocality")
                elif isinstance(addr, str):
                    address = addr
                rating = None
                ag = item.get("aggregateRating")
                if isinstance(ag, dict):
                    rating = ag.get("ratingValue")
                items_by_pos[pos] = {
                    "name": name,
                    "address": address,
                    "city": city,
                    "rating": rating,
                    "phone": item.get("telephone"),
                }

    # 按出现顺序提取 place 链接
    ids = []
    seen = set()
    for m in _POI_ID_RE.finditer(html):
        pid = m.group(1)
        if pid in seen:
            continue
        seen.add(pid)
        ids.append(pid)

    leads_meta: List[Dict[str, Any]] = []
    # 将 JSON-LD 按 position 对齐到 ids
    for idx, pid in enumerate(ids):
        meta = items_by_pos.get(idx + 1) or {}
        leads_meta.append(
            {
                "poi_id": pid,
                "name": meta.get("name") or "",
                "address": meta.get("address"),
                "city": meta.get("city"),
                "phone": meta.get("phone"),
                "rating": meta.get("rating"),
            }
        )
    if not total:
        total = len(leads_meta)
    return leads_meta, total


async def _web_get(
    url: str,
    params: Optional[Dict[str, Any]] = None,
    *,
    allow_not_found: bool = False,
) -> Optional[str]:
    """GET HTML. When allow_not_found=True, HTTP 404 returns None (end of SEO pages / missing POI)."""
    async with httpx.AsyncClient(timeout=30.0, headers=_BOT_HEADERS, follow_redirects=True) as client:
        resp = await client.get(url, params=params)
        if resp.status_code == 404 and allow_not_found:
            return None
        resp.raise_for_status()
        text = resp.text
    if "被挤爆" in text or ("punish" in text.lower() and "captcha" in text.lower()):
        raise RuntimeError("高德网页触发验证码，请稍后重试")
    # 高德「页面未找到」偶发也以 200 返回短页
    if "页面未找到" in text and allow_not_found:
        return None
    if len(text) < 500 and "DOCTYPE" not in text[:200].upper():
        raise RuntimeError("高德网页返回异常，请稍后重试")
    return text


async def _web_fetch_place(poi_id: str, sem: asyncio.Semaphore) -> Dict[str, Any]:
    async with sem:
        html = None
        last_err: Optional[Exception] = None
        for tmpl in (AMAP_WEB_PLACE, AMAP_WEB_PLACE_ALT):
            try:
                html = await _web_get(tmpl.format(poi_id=poi_id), allow_not_found=True)
                if html:
                    break
            except Exception as e:  # noqa: BLE001 — try next place URL
                last_err = e
                html = None
        await asyncio.sleep(_WEB_DETAIL_DELAY)
        if not html:
            if last_err:
                raise last_err
            raise RuntimeError(f"POI 不存在或已下线: {poi_id}")
        return _parse_place_html(html, poi_id)


async def _web_search_page(keyword: str, city: Optional[str], pagenum: int) -> Tuple[List[Dict[str, Any]], int]:
    """抓取一页 SEO 搜索结果。超出页码范围时高德返回 404，视为没有更多结果。"""
    params: Dict[str, Any] = {"query": keyword}
    if city:
        params["city"] = city
    if pagenum > 1:
        params["pagenum"] = pagenum

    html = None
    last_err: Optional[Exception] = None
    for base in (AMAP_WEB_SEARCH, AMAP_WEB_SEARCH_ALT):
        try:
            html = await _web_get(base, params=params, allow_not_found=True)
            if html is None:
                return [], 0
            break
        except Exception as e:  # noqa: BLE001 — try alternate host
            last_err = e
            html = None
    if html is None:
        if last_err:
            raise last_err
        return [], 0
    return _parse_search_html(html)


async def _web_enrich(
    metas: List[Dict[str, Any]],
    only_with_phone: bool,
    need: int,
) -> List[Dict[str, Any]]:
    """并发拉取详情补全电话；凑够 need 条（或扫完）为止。"""
    sem = asyncio.Semaphore(_WEB_CONCURRENCY)
    leads: List[Dict[str, Any]] = []

    # 先把列表里已有电话的放进去
    pending_ids: List[str] = []
    meta_by_id = {m["poi_id"]: m for m in metas if m.get("poi_id")}
    for m in metas:
        if m.get("phone"):
            lead = _shape_web_lead(m)
            if (not only_with_phone) or lead.get("phone"):
                leads.append(lead)
        else:
            pending_ids.append(m["poi_id"])

    # 分批拉详情
    for i in range(0, len(pending_ids), _WEB_CONCURRENCY):
        if len(leads) >= need:
            break
        batch = pending_ids[i : i + _WEB_CONCURRENCY]
        results = await asyncio.gather(
            *[_web_fetch_place(pid, sem) for pid in batch],
            return_exceptions=True,
        )
        for pid, res in zip(batch, results):
            if isinstance(res, Exception):
                # 详情失败时仍返回列表基础信息
                base = meta_by_id.get(pid) or {"poi_id": pid}
                lead = _shape_web_lead(base)
            else:
                merged = {**(meta_by_id.get(pid) or {}), **res}
                # 列表地址优先保留更完整的详情地址
                if res.get("address"):
                    merged["address"] = res["address"]
                if res.get("name"):
                    merged["name"] = res["name"]
                lead = _shape_web_lead(merged)
            if only_with_phone and not lead.get("phone"):
                continue
            leads.append(lead)
            if len(leads) >= need:
                break
    return leads[:need]


async def search_text_web(
    keyword: str,
    city: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    only_with_phone: bool = False,
) -> Dict[str, Any]:
    page = max(1, int(page))
    page_size = max(1, min(int(page_size), _MAX_PAGE_SIZE))
    # SEO 每页约 10 条；为凑 page_size，从对应偏移开始拉多页
    start = (page - 1) * page_size
    first_seo = start // _SEO_PAGE_SIZE + 1
    # only_with_phone 时多翻几页，尽量凑满有电话的条数；超出总页时高德会 404，下面按 total 封顶并吞掉 404
    extra = 4 if only_with_phone else 1
    pages_needed = (page_size + _SEO_PAGE_SIZE - 1) // _SEO_PAGE_SIZE + extra
    # 硬上限：SEO 搜索页过深必 404（实测约 5 页后）
    max_seo_hard = 20

    all_meta: List[Dict[str, Any]] = []
    total = 0
    seen = set()
    last_seo = first_seo + pages_needed
    pnum = first_seo
    while pnum <= last_seo and pnum <= max_seo_hard:
        metas, tot = await _web_search_page(keyword, city, pnum)
        if tot:
            total = tot
            # 按总数封顶，避免 only_with_phone 盲目翻到 404 页
            max_by_total = max(1, (total + _SEO_PAGE_SIZE - 1) // _SEO_PAGE_SIZE)
            last_seo = min(last_seo, max_by_total)
        if not metas:
            break
        for m in metas:
            pid = m.get("poi_id")
            if not pid or pid in seen:
                continue
            seen.add(pid)
            all_meta.append(m)
        await asyncio.sleep(0.25)
        want = start + (page_size * 3 if only_with_phone else page_size)
        if len(all_meta) >= want:
            break
        pnum += 1

    if only_with_phone:
        fetch_meta = all_meta[start : start + max(page_size * 3, page_size)]
    else:
        fetch_meta = all_meta[start : start + page_size]

    leads = await _web_enrich(fetch_meta, only_with_phone=only_with_phone, need=page_size)
    return {
        "success": True,
        "source": "amap_web",
        "mode": "text",
        "keyword": keyword,
        "city": city,
        "page": page,
        "page_size": page_size,
        "total": total or len(leads),
        "count": len(leads),
        "with_phone": sum(1 for x in leads if x.get("phone")),
        "leads": leads,
    }


async def poi_detail_web(poi_id: str) -> Dict[str, Any]:
    sem = asyncio.Semaphore(1)
    data = await _web_fetch_place(poi_id, sem)
    lead = _shape_web_lead(data)
    if not lead.get("name") and not lead.get("phone") and not lead.get("address"):
        raise RuntimeError("未找到该 POI 或网页无公开信息")
    return {"success": True, "source": "amap_web", "lead": lead}


async def _city_from_lnglat(lng: float, lat: float) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=20.0, headers={"User-Agent": "Mozilla/5.0"}) as client:
            resp = await client.get(AMAP_WEB_REGEO, params={"longitude": lng, "latitude": lat})
            data = resp.json()
        d = data.get("data") if isinstance(data, dict) else None
        if isinstance(d, dict):
            return d.get("city") or d.get("cityadcode") or d.get("province")
    except Exception:
        return None
    return None


async def search_text(
    keyword: str,
    city: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    source: Optional[str] = None,
    city_limit: bool = False,
    only_with_phone: bool = False,
    dedupe: bool = True,
) -> Dict[str, Any]:
    keyword = (keyword or "").strip()
    if not keyword:
        raise ValueError("keyword 不能为空")
    page = max(1, int(page))
    page_size = max(1, min(int(page_size), _MAX_PAGE_SIZE))
    src = resolve_source(source)

    if src == "amap_web":
        result = await search_text_web(
            keyword=keyword,
            city=city,
            page=page,
            page_size=page_size,
            only_with_phone=only_with_phone,
        )
        leads = dedupe_leads(result.get("leads") or [], enabled=dedupe)
        result["leads"] = leads
        result["count"] = len(leads)
        result["with_phone"] = sum(1 for x in leads if x.get("phone"))
        result["dedupe"] = bool(dedupe)
        return result

    if src == "amap":
        params: Dict[str, Any] = {
            "keywords": keyword,
            "offset": page_size,
            "page": page,
            "extensions": "all",
        }
        if city:
            params["city"] = city
            if city_limit:
                params["citylimit"] = "true"
        data = await _amap_get(AMAP_TEXT_URL, params)
        pois = data.get("pois") or []
        if not isinstance(pois, list):
            pois = []
        leads = [_shape_amap_poi(p) for p in pois if isinstance(p, dict)]
        total = int(data.get("count") or len(leads) or 0)
    else:
        params = {
            "query": keyword,
            "page_size": page_size,
            "page_num": page - 1,
            "scope": 2,
        }
        if city:
            params["region"] = city
            params["city_limit"] = "true" if city_limit else "false"
        else:
            params["region"] = "全国"
        data = await _baidu_get(BAIDU_SEARCH_URL, params)
        results = data.get("results") or []
        if not isinstance(results, list):
            results = []
        leads = [_shape_baidu_poi(p) for p in results if isinstance(p, dict)]
        total = int(data.get("total") or len(leads) or 0)

    if only_with_phone:
        leads = [x for x in leads if x.get("phone")]
    leads = dedupe_leads(leads, enabled=dedupe)

    return {
        "success": True,
        "source": src,
        "mode": "text",
        "keyword": keyword,
        "city": city,
        "page": page,
        "page_size": page_size,
        "total": total,
        "count": len(leads),
        "with_phone": sum(1 for x in leads if x.get("phone")),
        "dedupe": bool(dedupe),
        "leads": leads,
    }


async def search_around(
    keyword: str,
    lng: float,
    lat: float,
    radius: int = 3000,
    page: int = 1,
    page_size: int = 20,
    source: Optional[str] = None,
    only_with_phone: bool = False,
    dedupe: bool = True,
) -> Dict[str, Any]:
    keyword = (keyword or "").strip()
    if not keyword:
        raise ValueError("keyword 不能为空")
    try:
        lng_f = float(lng)
        lat_f = float(lat)
    except (TypeError, ValueError) as exc:
        raise ValueError("lng/lat 必须是数字") from exc
    page = max(1, int(page))
    page_size = max(1, min(int(page_size), _MAX_PAGE_SIZE))
    radius = max(1, min(int(radius), 50000))
    src = resolve_source(source)

    if src == "amap_web":
        city = await _city_from_lnglat(lng_f, lat_f)
        result = await search_text_web(
            keyword=keyword,
            city=city,
            page=page,
            page_size=page_size,
            only_with_phone=only_with_phone,
        )
        leads = dedupe_leads(result.get("leads") or [], enabled=dedupe)
        result["leads"] = leads
        result["count"] = len(leads)
        result["with_phone"] = sum(1 for x in leads if x.get("phone"))
        result["dedupe"] = bool(dedupe)
        result["mode"] = "around"
        result["center"] = {"lng": lng_f, "lat": lat_f}
        result["radius"] = radius
        result["note"] = "网页模式按中心点反查城市后再关键词搜索；无官方 Key 时无法按精确半径过滤"
        return result

    if src == "amap":
        params: Dict[str, Any] = {
            "keywords": keyword,
            "location": f"{lng_f},{lat_f}",
            "radius": radius,
            "offset": page_size,
            "page": page,
            "extensions": "all",
            "sortrule": "distance",
        }
        data = await _amap_get(AMAP_AROUND_URL, params)
        pois = data.get("pois") or []
        if not isinstance(pois, list):
            pois = []
        leads = [_shape_amap_poi(p) for p in pois if isinstance(p, dict)]
        total = int(data.get("count") or len(leads) or 0)
    else:
        params = {
            "query": keyword,
            "location": f"{lat_f},{lng_f}",
            "radius": radius,
            "page_size": page_size,
            "page_num": page - 1,
            "scope": 2,
        }
        data = await _baidu_get(BAIDU_SEARCH_URL, params)
        results = data.get("results") or []
        if not isinstance(results, list):
            results = []
        leads = [_shape_baidu_poi(p) for p in results if isinstance(p, dict)]
        total = int(data.get("total") or len(leads) or 0)

    if only_with_phone:
        leads = [x for x in leads if x.get("phone")]
    leads = dedupe_leads(leads, enabled=dedupe)

    return {
        "success": True,
        "source": src,
        "mode": "around",
        "keyword": keyword,
        "center": {"lng": lng_f, "lat": lat_f},
        "radius": radius,
        "page": page,
        "page_size": page_size,
        "total": total,
        "count": len(leads),
        "with_phone": sum(1 for x in leads if x.get("phone")),
        "dedupe": bool(dedupe),
        "leads": leads,
    }


async def poi_detail(poi_id: str, source: Optional[str] = None) -> Dict[str, Any]:
    poi_id = (poi_id or "").strip()
    if not poi_id:
        raise ValueError("poi_id 不能为空")
    src = resolve_source(source)
    if src == "amap_web":
        return await poi_detail_web(poi_id)
    if src == "amap":
        data = await _amap_get(AMAP_DETAIL_URL, {"id": poi_id, "extensions": "all"})
        pois = data.get("pois") or []
        if not isinstance(pois, list) or not pois:
            raise RuntimeError("未找到该 POI")
        lead = _shape_amap_poi(pois[0] if isinstance(pois[0], dict) else {})
    else:
        data = await _baidu_get(BAIDU_DETAIL_URL, {"uid": poi_id, "scope": 2})
        result = data.get("result")
        if not isinstance(result, dict):
            raise RuntimeError("未找到该 POI")
        lead = _shape_baidu_poi(result)
    return {"success": True, "source": src, "lead": lead}


async def batch_search(
    keywords: List[str],
    city: Optional[str] = None,
    page_size: int = 20,
    source: Optional[str] = None,
    only_with_phone: bool = False,
    city_limit: bool = True,
    dedupe: bool = True,
) -> Dict[str, Any]:
    kws = [k.strip() for k in (keywords or []) if k and str(k).strip()]
    if not kws:
        raise ValueError("keywords 不能为空")
    if len(kws) > 10:
        raise ValueError("keywords 最多 10 个")
    all_leads: List[Dict[str, Any]] = []
    per_keyword: List[Dict[str, Any]] = []
    src = resolve_source(source)
    for kw in kws:
        part = await search_text(
            keyword=kw,
            city=city,
            page=1,
            page_size=page_size,
            source=source,
            city_limit=city_limit,
            only_with_phone=only_with_phone,
        )
        per_keyword.append(
            {
                "keyword": kw,
                "count": part["count"],
                "with_phone": part["with_phone"],
                "total": part["total"],
            }
        )
        for lead in part["leads"]:
            lead = {**lead, "keyword": kw}
            all_leads.append(lead)
        await asyncio.sleep(0.4)
    if dedupe:
        all_leads = dedupe_leads(all_leads, enabled=True)
    return {
        "success": True,
        "source": src,
        "mode": "batch",
        "city": city,
        "keywords": kws,
        "count": len(all_leads),
        "with_phone": sum(1 for x in all_leads if x.get("phone")),
        "dedupe": bool(dedupe),
        "per_keyword": per_keyword,
        "leads": all_leads,
    }
