# -*- coding: utf-8 -*-
"""抖音：传入视频链接，解析 aweme_id 并下载 mp4 到本地。"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional
from urllib.parse import unquote

import httpx

from media_platform.douyin.client import DouYinClient
from media_platform.douyin.help import parse_video_info_from_url
from media_platform.douyin.media import extract_video_urls
from tools import utils
from tools.httpx_util import make_async_client

from .douyin_index import load_douyin_cookie_str, parse_cookie_pairs

logger = logging.getLogger("api.douyin_download")

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

_URL_IN_TEXT = re.compile(
    r"https?://(?:v\.douyin\.com/[^\s\"'<>]+|(?:www\.)?douyin\.com/[^\s\"'<>]+)",
    re.IGNORECASE,
)

_lock = asyncio.Lock()


class DownloadError(Exception):
    """带 HTTP 语义的业务错误。"""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _data_dir() -> Path:
    env = (os.getenv("MEDIA_CRAWLER_DATA_DIR") or "").strip()
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent.parent / "data"


def extract_url_from_text(text: str) -> str:
    """从分享文案或纯链接里抽出抖音 URL；纯数字 ID 也接受。"""
    raw = (text or "").strip()
    if not raw:
        raise DownloadError(400, "url 不能为空")
    # 去掉常见分享尾巴
    raw = raw.replace("\u200b", " ").strip()
    if raw.isdigit():
        return raw
    m = _URL_IN_TEXT.search(raw)
    if m:
        return m.group(0).rstrip(")。,.，；;]'\"")
    # 可能是已带路径的相对片段
    if "douyin.com" in raw or raw.startswith("http"):
        # 取第一个疑似 URL token
        token = raw.split()[0].strip("。,.，；;]'\"")
        return token
    raise DownloadError(400, "无法从输入中识别抖音链接或作品 ID")


async def resolve_short_url(short_url: str, timeout: float = 15.0) -> str:
    async with make_async_client(follow_redirects=False) as client:
        try:
            resp = await client.get(short_url, timeout=timeout, headers={"User-Agent": _UA})
            if resp.status_code in (301, 302, 303, 307, 308):
                loc = resp.headers.get("Location") or ""
                return loc
            # 部分短链直接 200 跟跳
            if resp.status_code == 200 and str(resp.url) != short_url:
                return str(resp.url)
        except Exception as exc:
            logger.warning("resolve short url failed: %s", exc)
    return ""


async def parse_aweme_id(url_or_text: str) -> str:
    extracted = extract_url_from_text(url_or_text)
    if extracted.isdigit():
        return extracted

    info = parse_video_info_from_url(extracted)
    if info.aweme_id:
        return info.aweme_id

    if info.url_type == "short" or "v.douyin.com" in extracted:
        redirected = await resolve_short_url(extracted)
        if not redirected:
            # 再试 follow redirects
            async with make_async_client(follow_redirects=True) as client:
                try:
                    resp = await client.get(extracted, timeout=20, headers={"User-Agent": _UA})
                    redirected = str(resp.url)
                except Exception as exc:
                    raise DownloadError(400, f"短链解析失败: {exc}") from exc
        if not redirected:
            raise DownloadError(400, "短链无法解析，请换完整视频链接")
        # Location 偶发还是短链或带 query
        redirected = unquote(redirected)
        try:
            info2 = parse_video_info_from_url(redirected)
            if info2.aweme_id:
                return info2.aweme_id
        except ValueError:
            pass
        # 兜底正则
        m = re.search(r"/video/(\d+)", redirected) or re.search(r"modal_id=(\d+)", redirected)
        if m:
            return m.group(1)
        raise DownloadError(400, f"短链跳转后仍无法解析作品 ID: {redirected[:120]}")

    raise DownloadError(400, f"无法解析作品 ID: {extracted[:120]}")


def _cookie_str_or_raise(body_cookies: str = "") -> str:
    cookie = (body_cookies or "").strip()
    if cookie:
        return cookie
    cookie = load_douyin_cookie_str()
    if not cookie:
        raise DownloadError(
            401,
            "未找到抖音 Cookie。请在请求 Body 传 cookies，或写入 data/douyin_cookies.txt",
        )
    pairs = parse_cookie_pairs(cookie)
    if not any(n == "sessionid" for n, _ in pairs):
        raise DownloadError(401, "Cookie 缺少 sessionid，请重新导出已登录的抖音 Cookie")
    return cookie


async def fetch_aweme_detail(aweme_id: str, cookie_str: str) -> dict:
    """用 Playwright + DouYinClient 拉作品详情（复用项目签名逻辑）。"""
    pairs = parse_cookie_pairs(cookie_str)
    if not pairs:
        raise DownloadError(401, "Cookie 为空或格式无效")

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
                    user_agent=_UA,
                    viewport={"width": 1440, "height": 900},
                )
                await context.add_cookies(
                    [
                        {"name": n, "value": v, "domain": ".douyin.com", "path": "/"}
                        for n, v in pairs
                    ]
                )
                page = await context.new_page()
                await page.goto(
                    "https://www.douyin.com/",
                    wait_until="domcontentloaded",
                    timeout=90000,
                )
                try:
                    await page.wait_for_timeout(1500)
                except Exception:
                    pass

                cookie_header, cookie_dict = await utils.convert_browser_context_cookies(
                    context,
                    urls=[
                        "https://douyin.com",
                        "https://www.douyin.com",
                    ],
                )
                client = DouYinClient(
                    timeout=60,
                    proxy=None,
                    headers={
                        "User-Agent": _UA,
                        "Cookie": cookie_header,
                        "Host": "www.douyin.com",
                        "Origin": "https://www.douyin.com/",
                        "Referer": "https://www.douyin.com/",
                        "Content-Type": "application/json;charset=UTF-8",
                    },
                    playwright_page=page,
                    cookie_dict=cookie_dict,
                )
                try:
                    detail = await client.get_video_by_id(aweme_id)
                except Exception as exc:
                    msg = str(exc)
                    low = msg.lower()
                    if "blocked" in low or "login" in low or "登录" in msg or "account blocked" in low:
                        raise DownloadError(
                            401,
                            f"抖音拒绝访问（Cookie 失效或风控）: {msg[:240]}",
                        ) from exc
                    raise DownloadError(502, f"拉取作品详情失败: {msg[:300]}") from exc

                if not detail or not isinstance(detail, dict):
                    raise DownloadError(
                        502,
                        "作品详情为空，可能链接无效、已删除，或 Cookie/风控导致未返回数据",
                    )
                return detail
            finally:
                await browser.close()


def _title_of(detail: dict) -> str:
    desc = detail.get("desc") or ""
    if isinstance(desc, str) and desc.strip():
        return desc.strip()[:200]
    share = detail.get("share_info") or {}
    if isinstance(share, dict):
        t = share.get("share_title") or share.get("share_desc") or ""
        if t:
            return str(t).strip()[:200]
    return ""


async def stream_download(urls: list[str], dest: Path, timeout: float = 120.0) -> int:
    """按候选 CDN 地址依次下载，成功返回字节数。"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    headers = {
        "User-Agent": _UA,
        "Referer": "https://www.douyin.com/",
        "Accept-Encoding": "identity",
    }
    last_err: Optional[Exception] = None
    async with make_async_client(follow_redirects=True, timeout=timeout) as client:
        for url in urls:
            try:
                async with client.stream("GET", url, headers=headers) as resp:
                    if resp.status_code >= 400:
                        last_err = RuntimeError(f"HTTP {resp.status_code}")
                        continue
                    ctype = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
                    if ctype.startswith("text/html"):
                        last_err = RuntimeError("CDN 返回 HTML（可能防盗链）")
                        continue
                    size = 0
                    with open(tmp, "wb") as f:
                        async for chunk in resp.aiter_bytes(1024 * 256):
                            f.write(chunk)
                            size += len(chunk)
                    if size < 1024:
                        last_err = RuntimeError(f"文件过小 ({size} bytes)")
                        try:
                            tmp.unlink(missing_ok=True)
                        except Exception:
                            pass
                        continue
                    tmp.replace(dest)
                    return size
            except Exception as exc:
                last_err = exc
                logger.warning("download candidate failed: %s", exc)
                try:
                    tmp.unlink(missing_ok=True)
                except Exception:
                    pass
    raise DownloadError(502, f"视频文件下载失败: {last_err}")


async def download_from_url(
    *,
    url: str,
    cookies: str = "",
    overwrite: bool = False,
) -> dict[str, Any]:
    """主流程：解析 → 详情 → 下文件 → 返回元信息。"""
    aweme_id = await parse_aweme_id(url)
    cookie_str = _cookie_str_or_raise(cookies)

    out_dir = _data_dir() / "downloads" / "douyin"
    dest = out_dir / f"{aweme_id}.mp4"

    if dest.is_file() and dest.stat().st_size > 1024 and not overwrite:
        rel = f"downloads/douyin/{aweme_id}.mp4"
        return {
            "success": True,
            "aweme_id": aweme_id,
            "title": "",
            "file_path": str(dest),
            "relative_path": rel,
            "download_url": f"/api/data/download/{rel}",
            "size": dest.stat().st_size,
            "cached": True,
        }

    detail = await fetch_aweme_detail(aweme_id, cookie_str)
    title = _title_of(detail)
    video_urls = extract_video_urls(detail)
    if not video_urls:
        # 图集等无视频
        images = detail.get("images")
        if images:
            raise DownloadError(400, "该作品是图集，不含可下载视频；本接口仅支持视频")
        raise DownloadError(502, "详情中未找到视频播放地址（可能被风控或作品无视频）")

    size = await stream_download(video_urls, dest)
    rel = f"downloads/douyin/{aweme_id}.mp4"
    return {
        "success": True,
        "aweme_id": aweme_id,
        "title": title,
        "file_path": str(dest),
        "relative_path": rel,
        "download_url": f"/api/data/download/{rel}",
        "size": size,
        "cached": False,
    }
