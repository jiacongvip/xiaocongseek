import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from ..schemas import CrawlerStartRequest, CrawlerStatusResponse
from ..services import crawler_manager
from ..services.auth import AuthContext, require_api_key


router = APIRouter(prefix="/crawler", tags=["crawler"], dependencies=[Depends(require_api_key)])
tasks_router = APIRouter(prefix="/tasks", tags=["tasks"], dependencies=[Depends(require_api_key)])



def _load_records(path: Path, offset: int, limit: int):
    """Load json list or jsonl lines with pagination."""
    suffix = path.suffix.lower()
    if suffix == ".json":
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            data = [data]
        total = len(data)
        return data[offset: offset + limit], total
    if suffix == ".jsonl":
        rows = []
        total = 0
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                if total >= offset and len(rows) < limit:
                    try:
                        rows.append(json.loads(line))
                    except json.JSONDecodeError:
                        rows.append({"_raw": line})
                total += 1
        return rows, total
    return [], 0


def _task_result_files(task_dir: Path):
    """Find content/comment artifacts under a task output dir."""
    contents, comments = [], []
    if not task_dir.exists():
        return contents, comments
    for path in sorted(task_dir.rglob("*")):
        if not path.is_file():
            continue
        name = path.name.lower()
        if name == "logs.jsonl" or path.suffix.lower() not in {".json", ".jsonl"}:
            continue
        if "comment" in name:
            comments.append(path)
        elif "content" in name or "aweme" in name or "note" in name:
            contents.append(path)
    return contents, comments



def _count_jsonl_or_json(path: Path) -> int:
    suffix = path.suffix.lower()
    try:
        if suffix == ".json":
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            return len(data) if isinstance(data, list) else 1
        if suffix == ".jsonl":
            with path.open("r", encoding="utf-8") as f:
                return sum(1 for line in f if line.strip())
    except Exception:
        return 0
    return 0


def _task_progress(task: dict) -> dict:
    """Summarize incremental outputs so clients know partial results while running are normal."""
    task_dir = Path(task.get("output_dir") or "")
    content_files, comment_files = _task_result_files(task_dir) if task_dir else ([], [])
    contents_count = sum(_count_jsonl_or_json(p) for p in content_files)
    comments_count = sum(_count_jsonl_or_json(p) for p in comment_files)
    status = (task.get("status") or "").lower()
    partial = status in {"queued", "running", "stopping"} and (contents_count > 0 or comments_count > 0)
    cfg = task.get("config_json") or {}
    enable_comments = bool(cfg.get("enable_comments"))
    if status == "running" and enable_comments and contents_count > 0:
        phase = "fetching_comments"
        hint = (
            "搜索内容已边写边落盘，任务仍在抓取评论/子评论；"
            "有结果可先预览，status 会在爬虫进程退出后变为 succeeded/failed，并写入 finished_at。"
        )
    elif status == "running" and contents_count > 0:
        phase = "writing_contents"
        hint = "任务仍在运行，结果文件会边爬边更新；进程结束后才会标记完成。"
    elif status == "running":
        phase = "starting_or_searching"
        hint = "任务运行中，尚无结果文件或正在搜索。"
    elif partial:
        phase = "partial"
        hint = "任务未结束，但已有部分结果可预览。"
    else:
        phase = "done" if status in {"succeeded", "failed", "cancelled"} else status or "unknown"
        hint = None
    return {
        "partial": partial,
        "phase": phase,
        "contents_count": contents_count,
        "comments_count": comments_count,
        "content_files": len(content_files),
        "comment_files": len(comment_files),
        "hint": hint,
    }



def _first(*vals):
    for v in vals:
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        return v
    return None


def _as_int(v):
    if v is None or v == "":
        return None
    try:
        return int(float(str(v).replace(",", "").strip()))
    except (TypeError, ValueError):
        return None


def _fmt_count(v):
    n = _as_int(v)
    if n is None:
        return None
    if n >= 100000000:
        return f"{n / 100000000:.1f}亿".replace(".0亿", "亿")
    if n >= 10000:
        s = f"{n / 10000:.1f}".rstrip("0").rstrip(".")
        return f"{s}万"
    return f"{n:,}"


def _fmt_time(v):
    if v is None or v == "":
        return None
    try:
        n = float(v)
        # ms vs seconds
        if n > 1e12:
            n = n / 1000.0
        from datetime import datetime, timezone
        dt = datetime.fromtimestamp(n, tz=timezone.utc).astimezone()
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(v)


def _clean_content_item(raw: dict) -> dict:
    if not isinstance(raw, dict):
        return {"title": str(raw), "raw": raw}
    item_id = _first(
        raw.get("aweme_id"), raw.get("note_id"), raw.get("video_id"),
        raw.get("content_id"), raw.get("id"), raw.get("tid"),
    )
    title = _first(raw.get("title"), raw.get("desc"), raw.get("content"), raw.get("text"), "")
    if isinstance(title, str) and len(title) > 180:
        title_short = title[:177] + "…"
    else:
        title_short = title or "（无标题）"
    author = _first(
        raw.get("nickname"), raw.get("user_nickname"), raw.get("author"),
        raw.get("user_name"), raw.get("uname"),
    )
    liked = _first(raw.get("liked_count"), raw.get("like_count"), raw.get("digg_count"), raw.get("likes"))
    comments = _first(raw.get("comment_count"), raw.get("comments_count"), raw.get("reply_count"))
    shares = _first(raw.get("share_count"), raw.get("shares"))
    collects = _first(raw.get("collected_count"), raw.get("collect_count"), raw.get("favorite_count"))
    url = _first(
        raw.get("aweme_url"), raw.get("note_url"), raw.get("video_url"),
        raw.get("url"), raw.get("share_url"), raw.get("link"),
    )
    cover = _first(raw.get("cover_url"), raw.get("cover"), raw.get("cover_image"), raw.get("pic_url"))
    return {
        "id": str(item_id) if item_id is not None else None,
        "title": title_short,
        "title_full": title or "",
        "author": author or "—",
        "liked": _as_int(liked),
        "liked_label": _fmt_count(liked) or "0",
        "comments": _as_int(comments),
        "comments_label": _fmt_count(comments) or "0",
        "shares": _as_int(shares),
        "shares_label": _fmt_count(shares) or "0",
        "collects": _as_int(collects),
        "collects_label": _fmt_count(collects) or "0",
        "url": url,
        "cover": cover,
        "keyword": _first(raw.get("source_keyword"), raw.get("keyword"), raw.get("search_keyword")),
        "created_at": _fmt_time(_first(raw.get("create_time"), raw.get("create_date"), raw.get("time"))),
        "type": _first(raw.get("aweme_type"), raw.get("note_type"), raw.get("type")),
    }


def _clean_comment_item(raw: dict) -> dict:
    if not isinstance(raw, dict):
        return {"content": str(raw), "raw": raw}
    content = _first(raw.get("content"), raw.get("text"), raw.get("comment"), "")
    if isinstance(content, str) and len(content) > 240:
        content_short = content[:237] + "…"
    else:
        content_short = content or "（空评论）"
    likes = _first(raw.get("like_count"), raw.get("liked_count"), raw.get("digg_count"))
    return {
        "id": str(_first(raw.get("comment_id"), raw.get("id"), "")) or None,
        "content": content_short,
        "content_full": content or "",
        "author": _first(raw.get("nickname"), raw.get("user_nickname"), raw.get("author")) or "—",
        "liked": _as_int(likes),
        "liked_label": _fmt_count(likes) or "0",
        "aweme_id": _first(raw.get("aweme_id"), raw.get("note_id"), raw.get("content_id")),
        "parent_id": _first(raw.get("parent_comment_id"), raw.get("parent_id")),
        "sub_count": _as_int(_first(raw.get("sub_comment_count"), raw.get("sub_count"))),
        "created_at": _fmt_time(_first(raw.get("create_time"), raw.get("create_date"))),
    }


def _apply_view(pack: dict, kind: str, view: str) -> dict:
    """Return pack with cleaned items when view=cleaned."""
    if view != "cleaned":
        return pack
    cleaner = _clean_comment_item if kind == "comments" else _clean_content_item
    out = dict(pack)
    out["items"] = [cleaner(x) if isinstance(x, dict) else cleaner({"_raw": x}) for x in (pack.get("items") or [])]
    out["view"] = "cleaned"
    return out


def _can_access_task(auth: AuthContext, task: dict) -> bool:
    if auth.is_master:
        return True
    owner = task.get("owner_user_id")
    if owner is None:
        # legacy tasks with no owner: only master
        return False
    return auth.user_id is not None and int(owner) == int(auth.user_id)


@tasks_router.post("")
async def create_task(request: CrawlerStartRequest, auth: AuthContext = Depends(require_api_key)):
    owner = None if auth.is_master else auth.user_id
    task_id = await crawler_manager.start(request, owner_user_id=owner)
    if not task_id:
        raise HTTPException(status_code=409, detail="A crawler task is already running")
    return {"task_id": task_id, "status": "running"}


@tasks_router.get("")
async def list_tasks(limit: int = 50, auth: AuthContext = Depends(require_api_key)):
    if auth.is_master:
        tasks = crawler_manager.list_tasks(limit)
    else:
        tasks = crawler_manager.list_tasks(limit, owner_user_id=auth.user_id)
    enriched = []
    for task in tasks:
        row = dict(task)
        try:
            row["progress"] = _task_progress(task)
        except Exception:
            row["progress"] = None
        enriched.append(row)
    return {"tasks": enriched}


@tasks_router.get("/{task_id}")
async def get_task(task_id: str, auth: AuthContext = Depends(require_api_key)):
    task = crawler_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _can_access_task(auth, task):
        raise HTTPException(status_code=404, detail="Task not found")
    out = dict(task)
    out["progress"] = _task_progress(task)
    return out



@tasks_router.get("/{task_id}/results")
async def get_task_results(
    task_id: str,
    kind: Optional[str] = None,
    offset: int = 0,
    limit: int = 100,
    view: Optional[str] = None,
    auth: AuthContext = Depends(require_api_key),
):
    """Return crawl records as JSON (no file download needed).

    kind: contents | comments | all(default)
    view: raw(default) | cleaned — cleaned extracts title/author/stats/url for UI lists
    """
    task = crawler_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _can_access_task(auth, task):
        raise HTTPException(status_code=404, detail="Task not found")

    offset = max(0, offset)
    limit = max(1, min(limit, 1000))
    kind_q = (kind or "all").lower().strip()
    if kind_q not in {"all", "contents", "comments"}:
        raise HTTPException(status_code=400, detail="kind must be contents, comments, or all")

    view_q = (view or "raw").lower().strip()
    if view_q not in {"raw", "cleaned"}:
        raise HTTPException(status_code=400, detail="view must be raw or cleaned")

    task_dir = Path(task.get("output_dir") or crawler_manager._task_dir(task_id))
    content_files, comment_files = _task_result_files(task_dir)

    def pack(files):
        # Prefer newest matching file if multiple formats exist
        if not files:
            return {"total": 0, "offset": offset, "limit": limit, "items": [], "files": []}
        # merge all files of this kind for completeness
        items = []
        total = 0
        file_metas = []
        remaining_offset = offset
        remaining_limit = limit
        for path in files:
            rows, file_total = _load_records(path, 0, 10**9)
            file_metas.append({
                "path": str(path.relative_to(task_dir)) if str(path).startswith(str(task_dir)) else path.name,
                "type": path.suffix[1:],
                "record_count": file_total,
            })
            # pagination across concatenated files
            if remaining_offset >= file_total:
                remaining_offset -= file_total
                total += file_total
                continue
            slice_rows = rows[remaining_offset: remaining_offset + remaining_limit]
            items.extend(slice_rows)
            remaining_limit -= len(slice_rows)
            remaining_offset = 0
            total += file_total
            if remaining_limit <= 0:
                # still need accurate total from remaining files
                for rest in files[files.index(path) + 1:]:
                    _, ft = _load_records(rest, 0, 10**9)
                    total += ft
                    file_metas.append({
                        "path": str(rest.relative_to(task_dir)) if str(rest).startswith(str(task_dir)) else rest.name,
                        "type": rest.suffix[1:],
                        "record_count": ft,
                    })
                break
        return {"total": total, "offset": offset, "limit": limit, "items": items, "files": file_metas}

    body = {
        "task_id": task_id,
        "status": task.get("status"),
        "platform": task.get("platform"),
        "crawler_type": task.get("crawler_type"),
        "progress": _task_progress(task),
        "view": view_q,
    }
    if kind_q in {"all", "contents"}:
        body["contents"] = _apply_view(pack(content_files), "contents", view_q)
    if kind_q in {"all", "comments"}:
        body["comments"] = _apply_view(pack(comment_files), "comments", view_q)

    # Compact summary for dashboards / task detail headers
    prog = body["progress"]
    body["summary"] = {
        "contents_total": (body.get("contents") or {}).get("total", prog.get("contents_count") or 0),
        "comments_total": (body.get("comments") or {}).get("total", prog.get("comments_count") or 0),
        "platform": task.get("platform"),
        "status": task.get("status"),
        "phase": prog.get("phase"),
        "hint": prog.get("hint"),
    }
    return body


@tasks_router.get("/{task_id}/logs")
async def get_task_logs(task_id: str, limit: int = 100, after: int = 0, auth: AuthContext = Depends(require_api_key)):
    task = crawler_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _can_access_task(auth, task):
        raise HTTPException(status_code=404, detail="Task not found")
    path = crawler_manager._task_log_path(task_id)
    if not path.exists():
        return {"task_id": task_id, "logs": []}
    logs = []
    for line in path.read_text(encoding="utf-8").splitlines():
        item = json.loads(line)
        if item["id"] > after:
            logs.append(item)
    return {"task_id": task_id, "logs": logs[-max(1, min(limit, 500)):]}


@tasks_router.post("/{task_id}/stop")
async def stop_task(task_id: str, auth: AuthContext = Depends(require_api_key)):
    task = crawler_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _can_access_task(auth, task):
        raise HTTPException(status_code=404, detail="Task not found")
    if crawler_manager.current_task_id != task_id:
        raise HTTPException(status_code=409, detail="Task is not the active task")
    if not await crawler_manager.stop():
        raise HTTPException(status_code=409, detail="Task is not running")
    return {"task_id": task_id, "status": "cancelled"}


@router.post("/start")
async def start_crawler(request: CrawlerStartRequest, auth: AuthContext = Depends(require_api_key)):
    owner = None if auth.is_master else auth.user_id
    task_id = await crawler_manager.start(request, owner_user_id=owner)
    if not task_id:
        raise HTTPException(status_code=409, detail="Crawler is already running")
    response = {"status": "ok", "message": "Crawler started successfully"}
    if isinstance(task_id, str):
        response["task_id"] = task_id
    return response


@router.post("/stop")
async def stop_crawler(auth: AuthContext = Depends(require_api_key)):
    if not await crawler_manager.stop():
        raise HTTPException(status_code=400, detail="No crawler is running")
    return {"status": "ok", "message": "Crawler stopped successfully", "task_id": crawler_manager.current_task_id}


@router.get("/status", response_model=CrawlerStatusResponse)
async def get_crawler_status(auth: AuthContext = Depends(require_api_key)):
    return crawler_manager.get_status()


@router.get("/logs")
async def get_logs(limit: int = 100, auth: AuthContext = Depends(require_api_key)):
    safe_limit = max(1, min(limit, 500))
    return {"logs": [log.model_dump() for log in crawler_manager.logs[-safe_limit:]]}
