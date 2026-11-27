# -*- coding: utf-8 -*-
"""抖音搜索 / 视频详情 / 评论 / 链接下载：封装为任务或同步下载。"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..schemas import (
    CrawlerStartRequest,
    CrawlerTypeEnum,
    LoginTypeEnum,
    PlatformEnum,
    SaveDataOptionEnum,
)
from ..services import crawler_manager
from ..services.auth import AuthContext, require_api_key
from ..services.douyin_download import DownloadError, download_from_url

router = APIRouter(
    prefix="/douyin",
    tags=["douyin-content"],
    dependencies=[Depends(require_api_key)],
)


class SearchBody(BaseModel):
    keywords: str = Field(..., description="关键词，多个用逗号或空格分隔")
    max_notes_count: int = Field(20, ge=1, le=200, description="最多拉多少条内容")
    enable_comments: bool = Field(False, description="是否同时拉评论")
    max_comments_count: Optional[int] = Field(None, ge=1, le=500)
    enable_sub_comments: bool = False
    cookies: str = Field("", description="可选；不传则用服务器已有抖音 Cookie")
    headless: bool = True
    save_option: SaveDataOptionEnum = SaveDataOptionEnum.JSONL


class VideoDetailBody(BaseModel):
    aweme_ids: str = Field(..., description="视频/作品 ID，多个逗号分隔")
    enable_comments: bool = Field(True, description="详情模式默认拉评论")
    max_comments_count: Optional[int] = Field(50, ge=1, le=500)
    enable_sub_comments: bool = False
    cookies: str = ""
    headless: bool = True
    save_option: SaveDataOptionEnum = SaveDataOptionEnum.JSONL


class CommentsBody(BaseModel):
    aweme_ids: str = Field(..., description="视频 ID，逗号分隔")
    max_comments_count: int = Field(100, ge=1, le=1000)
    enable_sub_comments: bool = False
    cookies: str = ""
    headless: bool = True
    save_option: SaveDataOptionEnum = SaveDataOptionEnum.JSONL


class DownloadBody(BaseModel):
    url: str = Field(
        ...,
        description="抖音视频链接、短链、分享文案，或纯 aweme_id",
    )
    cookies: str = Field("", description="可选；优先于服务器 data/douyin_cookies.txt")
    overwrite: bool = Field(False, description="已存在本地文件时是否重新下载")
    return_file: bool = Field(
        False,
        description="为 true 时直接以 video/mp4 流式返回文件，否则返回 JSON 元信息",
    )


def _owner(auth: AuthContext):
    return None if auth.is_master else auth.user_id


async def _start(req: CrawlerStartRequest, auth: AuthContext) -> dict:
    task_id = await crawler_manager.start(req, owner_user_id=_owner(auth))
    if not task_id:
        raise HTTPException(status_code=409, detail="已有采集任务在运行，请稍后再试或先停止当前任务")
    return {
        "success": True,
        "task_id": task_id,
        "status": "running",
        "platform": "dy",
        "crawler_type": req.crawler_type.value if hasattr(req.crawler_type, "value") else req.crawler_type,
        "poll": f"/api/tasks/{task_id}",
        "results": f"/api/tasks/{task_id}/results",
        "logs": f"/api/tasks/{task_id}/logs",
        "note": "异步任务：轮询 poll 至 completed/failed 后，用 results?kind=contents|comments 取 JSON",
    }


@router.post("/search")
async def douyin_search(body: SearchBody, auth: AuthContext = Depends(require_api_key)):
    """关键词搜索视频/作品（异步任务，crawler_type=search）。"""
    kws = (body.keywords or "").strip()
    if not kws:
        raise HTTPException(status_code=400, detail="keywords 不能为空")
    req = CrawlerStartRequest(
        platform=PlatformEnum.DOUYIN,
        login_type=LoginTypeEnum.COOKIE if (body.cookies or "").strip() else LoginTypeEnum.COOKIE,
        crawler_type=CrawlerTypeEnum.SEARCH,
        keywords=kws,
        enable_comments=body.enable_comments,
        enable_sub_comments=body.enable_sub_comments,
        max_notes_count=body.max_notes_count,
        max_comments_count=body.max_comments_count,
        cookies=body.cookies or "",
        headless=body.headless,
        save_option=body.save_option,
    )
    return await _start(req, auth)


@router.post("/video")
async def douyin_video(body: VideoDetailBody, auth: AuthContext = Depends(require_api_key)):
    """按作品 ID 拉详情（异步任务，crawler_type=detail）。"""
    ids = (body.aweme_ids or "").strip()
    if not ids:
        raise HTTPException(status_code=400, detail="aweme_ids 不能为空")
    req = CrawlerStartRequest(
        platform=PlatformEnum.DOUYIN,
        login_type=LoginTypeEnum.COOKIE,
        crawler_type=CrawlerTypeEnum.DETAIL,
        specified_ids=ids,
        enable_comments=body.enable_comments,
        enable_sub_comments=body.enable_sub_comments,
        max_comments_count=body.max_comments_count,
        cookies=body.cookies or "",
        headless=body.headless,
        save_option=body.save_option,
    )
    return await _start(req, auth)


@router.post("/comments")
async def douyin_comments(body: CommentsBody, auth: AuthContext = Depends(require_api_key)):
    """按作品 ID 拉评论（detail 模式 + enable_comments）。"""
    ids = (body.aweme_ids or "").strip()
    if not ids:
        raise HTTPException(status_code=400, detail="aweme_ids 不能为空")
    req = CrawlerStartRequest(
        platform=PlatformEnum.DOUYIN,
        login_type=LoginTypeEnum.COOKIE,
        crawler_type=CrawlerTypeEnum.DETAIL,
        specified_ids=ids,
        enable_comments=True,
        enable_sub_comments=body.enable_sub_comments,
        max_comments_count=body.max_comments_count,
        cookies=body.cookies or "",
        headless=body.headless,
        save_option=body.save_option,
    )
    return await _start(req, auth)


@router.post("/download")
async def douyin_download(
    body: DownloadBody,
    return_file: Optional[bool] = Query(
        None,
        description="可选 query；覆盖 body.return_file，为 true 时直接返回 mp4 文件",
    ),
    auth: AuthContext = Depends(require_api_key),
):
    """传入抖音视频链接（或短链 / 分享文案 / aweme_id），同步下载到本地并返回元信息或文件。"""
    want_file = body.return_file if return_file is None else bool(return_file)
    try:
        result = await download_from_url(
            url=body.url,
            cookies=body.cookies or "",
            overwrite=body.overwrite,
        )
    except DownloadError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"下载失败: {exc}") from exc

    if want_file:
        path = result.get("file_path") or ""
        from pathlib import Path

        p = Path(path)
        if not p.is_file():
            raise HTTPException(status_code=500, detail="文件落盘失败")
        return FileResponse(
            path=p,
            filename=f"{result.get('aweme_id') or 'douyin'}.mp4",
            media_type="video/mp4",
        )
    return result


@router.get("/content/endpoints")
async def content_endpoints():
    return {
        "success": True,
        "note": "search/video/comments 为异步任务；download 为同步下载 mp4",
        "endpoints": [
            {
                "method": "POST",
                "path": "/api/douyin/search",
                "desc": "关键词搜索视频",
                "body": {"keywords": "小程序开发", "max_notes_count": 20, "enable_comments": False},
            },
            {
                "method": "POST",
                "path": "/api/douyin/video",
                "desc": "视频/作品详情",
                "body": {"aweme_ids": "7xxxxxxxxxxxx", "enable_comments": True},
            },
            {
                "method": "POST",
                "path": "/api/douyin/comments",
                "desc": "评论拉取",
                "body": {"aweme_ids": "7xxxxxxxxxxxx", "max_comments_count": 100},
            },
            {
                "method": "POST",
                "path": "/api/douyin/download",
                "desc": "传入链接同步下载视频 mp4",
                "body": {
                    "url": "https://www.douyin.com/video/7xxxxxxxxxxxx",
                    "cookies": "",
                    "return_file": False,
                },
            },
            {"method": "GET", "path": "/api/tasks/{task_id}", "desc": "任务状态"},
            {
                "method": "GET",
                "path": "/api/tasks/{task_id}/results?kind=contents|comments",
                "desc": "结果 JSON",
            },
        ],
    }
