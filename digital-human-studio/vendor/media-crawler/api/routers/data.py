# -*- coding: utf-8 -*-
"""Data file listing / preview / download for MediaCrawler API."""

import json
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/data", tags=["data"])

# Prefer env so Docker MEDIA_CRAWLER_DATA_DIR works; fall back to project data/
_ENV_DATA = os.getenv("MEDIA_CRAWLER_DATA_DIR", "").strip()
DATA_DIR = Path(_ENV_DATA) if _ENV_DATA else (Path(__file__).parent.parent.parent / "data")

SUPPORTED_EXTENSIONS = {".json", ".jsonl", ".csv", ".xlsx", ".xls"}
SKIP_NAMES = {"logs.jsonl", "portal.db", "tasks.db", "douyin_cookies.txt"}

# Folder name (as stored under data/) -> platform code
PLATFORM_DIRS = {
    "douyin": "dy",
    "dy": "dy",
    "xiaohongshu": "xhs",
    "xhs": "xhs",
    "kuaishou": "ks",
    "ks": "ks",
    "bilibili": "bili",
    "bili": "bili",
    "weibo": "wb",
    "wb": "wb",
    "tieba": "tieba",
    "zhihu": "zhihu",
}


def infer_platform(rel_path: str) -> Optional[str]:
    """Infer platform from path segments, never substring-match inside 'tasks'."""
    parts = Path(rel_path).parts
    for part in parts:
        key = part.lower()
        if key in PLATFORM_DIRS:
            return PLATFORM_DIRS[key]
    return None


def get_file_info(file_path: Path) -> dict:
    """Get file information"""
    stat = file_path.stat()
    record_count = None
    suffix = file_path.suffix.lower()

    try:
        if suffix == ".json":
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    record_count = len(data)
        elif suffix == ".jsonl":
            with open(file_path, "r", encoding="utf-8") as f:
                record_count = sum(1 for line in f if line.strip())
        elif suffix == ".csv":
            with open(file_path, "r", encoding="utf-8") as f:
                record_count = max(0, sum(1 for _ in f) - 1)
    except Exception:
        pass

    rel = str(file_path.relative_to(DATA_DIR))
    return {
        "name": file_path.name,
        "path": rel,
        "size": stat.st_size,
        "modified_at": stat.st_mtime,
        "record_count": record_count,
        "type": suffix[1:] if suffix else "unknown",
        "platform": infer_platform(rel),
    }


@router.get("/files")
async def list_data_files(platform: Optional[str] = None, file_type: Optional[str] = None):
    """Get data file list (includes jsonl task outputs)."""
    if not DATA_DIR.exists():
        return {"files": []}

    files = []
    platform_q = platform.lower().strip() if platform else None
    # accept both code and folder alias
    if platform_q in PLATFORM_DIRS:
        platform_q = PLATFORM_DIRS[platform_q]

    for root, dirs, filenames in os.walk(DATA_DIR):
        # skip hidden / db-ish dirs if any
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        root_path = Path(root)
        for filename in filenames:
            if filename in SKIP_NAMES or filename.startswith("."):
                continue
            file_path = root_path / filename
            if file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue

            try:
                info = get_file_info(file_path)
            except Exception:
                continue

            if platform_q and info.get("platform") != platform_q:
                # also allow legacy substring filter on folder name for callers
                rel = info["path"].lower()
                aliases = [k for k, v in PLATFORM_DIRS.items() if v == platform_q]
                if not any(f"/{a}/" in f"/{rel}/" or rel.startswith(f"{a}/") for a in aliases):
                    continue

            if file_type and info["type"].lower() != file_type.lower():
                continue

            files.append(info)

    files.sort(key=lambda x: x["modified_at"], reverse=True)
    return {"files": files}


@router.get("/files/{file_path:path}")
async def get_file_content(file_path: str, preview: bool = True, limit: int = 100):
    limit = max(1, min(limit, 500))
    full_path = DATA_DIR / file_path

    if not full_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not full_path.is_file():
        raise HTTPException(status_code=400, detail="Not a file")
    try:
        full_path.resolve().relative_to(DATA_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    if not preview:
        return FileResponse(
            path=full_path,
            filename=full_path.name,
            media_type="application/octet-stream",
        )

    try:
        suffix = full_path.suffix.lower()
        if suffix == ".json":
            with open(full_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return {"data": data[:limit], "total": len(data)}
                return {"data": data, "total": 1}
        elif suffix == ".jsonl":
            rows = []
            total = 0
            with open(full_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    total += 1
                    if len(rows) < limit:
                        try:
                            rows.append(json.loads(line))
                        except json.JSONDecodeError:
                            rows.append({"_raw": line})
            return {"data": rows, "total": total}
        elif suffix == ".csv":
            import csv
            with open(full_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                rows = []
                for i, row in enumerate(reader):
                    if i >= limit:
                        break
                    rows.append(row)
                f.seek(0)
                total = max(0, sum(1 for _ in f) - 1)
                return {"data": rows, "total": total}
        elif suffix in (".xlsx", ".xls"):
            import pandas as pd
            df = pd.read_excel(full_path, nrows=limit)
            df_count = pd.read_excel(full_path, usecols=[0])
            rows = df.where(pd.notnull(df), None).to_dict(orient="records")
            return {"data": rows, "total": len(df_count), "columns": list(df.columns)}
        raise HTTPException(status_code=400, detail="Unsupported file type for preview")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/download/{file_path:path}")
async def download_file(file_path: str):
    full_path = DATA_DIR / file_path
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not full_path.is_file():
        raise HTTPException(status_code=400, detail="Not a file")
    try:
        full_path.resolve().relative_to(DATA_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")
    return FileResponse(
        path=full_path,
        filename=full_path.name,
        media_type="application/octet-stream",
    )


@router.get("/stats")
async def get_data_stats():
    if not DATA_DIR.exists():
        return {"total_files": 0, "total_size": 0, "by_platform": {}, "by_type": {}}

    stats = {"total_files": 0, "total_size": 0, "by_platform": {}, "by_type": {}}

    for root, dirs, filenames in os.walk(DATA_DIR):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        root_path = Path(root)
        for filename in filenames:
            if filename in SKIP_NAMES or filename.startswith("."):
                continue
            file_path = root_path / filename
            if file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            try:
                st = file_path.stat()
                stats["total_files"] += 1
                stats["total_size"] += st.st_size
                file_type = file_path.suffix[1:].lower()
                stats["by_type"][file_type] = stats["by_type"].get(file_type, 0) + 1
                rel = str(file_path.relative_to(DATA_DIR))
                platform = infer_platform(rel) or "unknown"
                stats["by_platform"][platform] = stats["by_platform"].get(platform, 0) + 1
            except Exception:
                continue

    return stats
