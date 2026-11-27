# -*- coding: utf-8 -*-
# Copyright (c) 2025 relakkes@gmail.com
#
# This file is part of MediaCrawler project.
# Repository: https://github.com/NanmiCoder/MediaCrawler/blob/main/api/main.py
# GitHub: https://github.com/NanmiCoder
# Licensed under NON-COMMERCIAL LEARNING LICENSE 1.1
#
# 声明：本代码仅供学习和研究目的使用。使用者应遵守以下原则：
# 1. 不得用于任何商业用途。
# 2. 使用时应遵守目标平台的使用条款和robots.txt规则。
# 3. 不得进行大规模爬取或对平台造成运营干扰。
# 4. 应合理控制请求频率，避免给目标平台带来不必要的负担。
# 5. 不得用于任何非法或不当的用途。
#
# 详细许可条款请参阅项目根目录下的LICENSE文件。
# 使用本代码即表示您同意遵守上述原则和LICENSE中的所有条款。

"""
MediaCrawler WebUI API Server
Start command: uvicorn api.main:app --port 8080 --reload
Or: python -m api.main
"""
import asyncio
import os
import sys
import subprocess
from pathlib import Path
import uvicorn
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse

from .routers import crawler_router, tasks_router, data_router, websocket_router, portal_router, douyin_index_router, douhot_router, map_leads_router, map_public_router, hub_demo_router, douyin_content_router
from .services.auth import require_api_key

# Project root directory (used for running subprocesses like uv run main.py)
PROJECT_ROOT = Path(__file__).parent.parent

app = FastAPI(
    title="MediaCrawler WebUI API",
    description="API for controlling MediaCrawler from WebUI",
    version="1.0.0"
)

# Get webui static files directory
WEBUI_DIR = os.path.join(os.path.dirname(__file__), "webui")

# CORS configuration - allow frontend dev server access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # Backup port
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(crawler_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
app.include_router(data_router, prefix="/api", dependencies=[Depends(require_api_key)])
app.include_router(websocket_router, prefix="/api")
app.include_router(portal_router, prefix="/api")
app.include_router(douyin_index_router, prefix="/api")
app.include_router(douhot_router, prefix="/api")
app.include_router(map_leads_router, prefix="/api")
# Keyless same-origin proxy for /map frontend (service-layer; no key in browser)
app.include_router(map_public_router)
app.include_router(hub_demo_router)
app.include_router(douyin_content_router, prefix="/api")


@app.get("/")
async def serve_frontend():
    """Product landing (Hub). Legacy command center is at /console."""
    hub_index = os.path.join(WEBUI_DIR, "hub", "index.html")
    if os.path.exists(hub_index):
        return FileResponse(hub_index)
    index_path = os.path.join(WEBUI_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {
        "message": "MediaCrawler WebUI API",
        "version": "1.0.0",
        "docs": "/hub/docs",
        "note": "Hub UI not found",
    }

HUB_DIR = os.path.join(WEBUI_DIR, "hub")


@app.get("/console")
@app.get("/console/")
async def serve_console():
    """Legacy command-center SPA."""
    index_path = os.path.join(WEBUI_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Console WebUI missing", "path": index_path}


@app.get("/hub")
@app.get("/hub/")
async def serve_hub():
    """MediaCrawler product landing (TikHub-style IA, own brand)."""
    index_path = os.path.join(HUB_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Hub UI missing", "path": index_path}


def _hub_file_response(*parts: str):
    """Resolve a file under HUB_DIR safely."""
    path = os.path.normpath(os.path.join(HUB_DIR, *parts))
    hub_real = os.path.realpath(HUB_DIR)
    file_real = os.path.realpath(path)
    if not (file_real == hub_real or file_real.startswith(hub_real + os.sep)):
        return None
    if os.path.isfile(file_real):
        return FileResponse(file_real)
    return None


@app.get("/hub/docs")
@app.get("/hub/docs/")
async def serve_hub_docs():
    # Prefer multi-page docs index; fall back to legacy docs.html
    for candidate in (
        os.path.join(HUB_DIR, "docs", "index.html"),
        os.path.join(HUB_DIR, "docs.html"),
    ):
        if os.path.exists(candidate):
            return FileResponse(candidate)
    return {"message": "Hub docs missing"}


@app.get("/hub/playground")
@app.get("/hub/playground/")
async def serve_hub_playground():
    play_path = os.path.join(HUB_DIR, "playground.html")
    if os.path.exists(play_path):
        return FileResponse(play_path)
    return {"message": "Hub playground missing", "path": play_path}


@app.get("/hub/pricing")
@app.get("/hub/pricing/")
async def serve_hub_pricing():
    resp = _hub_file_response("pricing.html")
    return resp or {"message": "pricing missing"}


@app.get("/hub/solutions")
@app.get("/hub/solutions/")
async def serve_hub_solutions():
    resp = _hub_file_response("solutions.html")
    return resp or {"message": "solutions missing"}


@app.get("/hub/getting-started")
@app.get("/hub/getting-started/")
async def serve_hub_getting_started():
    resp = _hub_file_response("getting-started.html")
    return resp or {"message": "getting-started missing"}


@app.get("/hub/changelog")
@app.get("/hub/changelog/")
async def serve_hub_changelog():
    resp = _hub_file_response("changelog.html")
    return resp or {"message": "changelog missing"}


@app.get("/hub/faq")
@app.get("/hub/faq/")
async def serve_hub_faq():
    resp = _hub_file_response("faq.html")
    return resp or {"message": "faq missing"}


@app.get("/hub/status")
@app.get("/hub/status/")
async def serve_hub_status():
    resp = _hub_file_response("status.html")
    return resp or {"message": "status missing"}


@app.get("/hub/examples")
@app.get("/hub/examples/")
async def serve_hub_examples():
    resp = _hub_file_response("examples.html")
    return resp or {"message": "examples missing"}


@app.get("/hub/api-reference")
@app.get("/hub/api-reference/")
async def serve_hub_api_reference():
    resp = _hub_file_response("api-reference.html")
    return resp or {"message": "api-reference missing"}


@app.get("/hub/login")
@app.get("/hub/login/")
async def serve_hub_login():
    resp = _hub_file_response("login.html")
    return resp or {"message": "login missing"}


@app.get("/hub/register")
@app.get("/hub/register/")
async def serve_hub_register():
    resp = _hub_file_response("register.html")
    return resp or {"message": "register missing"}


@app.get("/hub/account")
@app.get("/hub/account/")
@app.get("/hub/me")
@app.get("/hub/me/")
async def serve_hub_account():
    resp = _hub_file_response("account.html")
    return resp or {"message": "account missing"}


@app.get("/hub/datasource")
@app.get("/hub/datasource/")
@app.get("/hub/tasks-ui")
@app.get("/hub/tasks-ui/")
async def serve_hub_datasource():
    resp = _hub_file_response("datasource.html")
    return resp or {"message": "datasource missing"}


@app.get("/hub/douhot-auth")
@app.get("/hub/douhot-auth/")
async def serve_hub_douhot_auth():
    resp = _hub_file_response("douhot-auth.html")
    return resp or {"message": "douhot-auth missing"}


@app.get("/hub/products/{slug}")
@app.get("/hub/products/{slug}/")
async def serve_hub_product(slug: str):
    safe = slug.replace("..", "").strip("/")
    resp = _hub_file_response("products", f"{safe}.html")
    if resp:
        return resp
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="product page not found")


@app.get("/hub/docs/{slug}")
@app.get("/hub/docs/{slug}/")
async def serve_hub_docs_page(slug: str):
    safe = slug.replace("..", "").strip("/")
    resp = _hub_file_response("docs", f"{safe}.html")
    if resp:
        return resp
    # legacy single-page anchors no longer apply
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="docs page not found")


@app.get("/hub/tools/{slug}")
@app.get("/hub/tools/{slug}/")
async def serve_hub_tools_page(slug: str):
    safe = slug.replace("..", "").strip("/")
    resp = _hub_file_response("tools", f"{safe}.html")
    if resp:
        return resp
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="tools page not found")




@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


PORTAL_DIR = os.path.join(os.path.dirname(__file__), "portal")


@app.get("/portal")
@app.get("/portal/")
async def serve_portal():
    """Legacy portal UI — redirect to Hub account (API keys)."""
    return RedirectResponse(url="/hub/account", status_code=302)



@app.get("/map")
@app.get("/map/")
async def serve_map():
    """地图获客前端：关键词/城市查询门店线索。"""
    map_path = os.path.join(WEBUI_DIR, "map.html")
    if os.path.exists(map_path):
        return FileResponse(
            map_path,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )
    return {"message": "Map UI missing", "path": map_path}



@app.get("/api/env/check", dependencies=[Depends(require_api_key)])
async def check_environment():
    """Check if MediaCrawler environment is configured correctly"""
    try:
        # Run uv run main.py --help command to check environment
        # Use PROJECT_ROOT so it works regardless of where uvicorn was started
        if sys.platform == "win32":
            loop = asyncio.get_running_loop()
            process = await loop.run_in_executor(
                None,
                lambda: subprocess.run(
                    ["uv", "run", "main.py", "--help"],
                    capture_output=True,
                    timeout=30.0,
                    cwd=str(PROJECT_ROOT)
                )
            )
            stdout, stderr = process.stdout, process.stderr  # bytes
        else:
            process = await asyncio.create_subprocess_exec(
                "uv", "run", "main.py", "--help",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=str(PROJECT_ROOT)  # Project root directory
            )
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=30.0  # 30 seconds timeout
            )
        if process.returncode == 0:
            return {
                "success": True,
                "message": "MediaCrawler environment configured correctly",
                "output": stdout.decode("utf-8", errors="ignore")[:500]  # Truncate to first 500 characters
            }
        else:
            error_msg = stderr.decode("utf-8", errors="ignore") or stdout.decode("utf-8", errors="ignore")
            return {
                "success": False,
                "message": "Environment check failed",
                "error": error_msg[:500]
            }
    except asyncio.TimeoutError:
        return {
            "success": False,
            "message": "Environment check timeout",
            "error": "Command execution exceeded 30 seconds"
        }
    except FileNotFoundError:
        return {
            "success": False,
            "message": "uv command not found",
            "error": "Please ensure uv is installed and configured in system PATH"
        }
    except Exception as e:
        return {
            "success": False,
            "message": "Environment check error",
            "error": f"{type(e).__name__}: {str(e) or 'Unknown'}"
        }


@app.get("/api/config/platforms")
async def get_platforms():
    """Get list of supported platforms"""
    return {
        "platforms": [
            {"value": "xhs", "label": "Xiaohongshu", "icon": "book-open"},
            {"value": "dy", "label": "Douyin", "icon": "music"},
            {"value": "ks", "label": "Kuaishou", "icon": "video"},
            {"value": "bili", "label": "Bilibili", "icon": "tv"},
            {"value": "wb", "label": "Weibo", "icon": "message-circle"},
            {"value": "tieba", "label": "Baidu Tieba", "icon": "messages-square"},
            {"value": "zhihu", "label": "Zhihu", "icon": "help-circle"},
        ]
    }


@app.get("/api/config/options")
async def get_config_options():
    """Get all configuration options"""
    return {
        "login_types": [
            {"value": "qrcode", "label": "QR Code Login"},
            {"value": "cookie", "label": "Cookie Login"},
        ],
        "crawler_types": [
            {"value": "search", "label": "Search Mode"},
            {"value": "detail", "label": "Detail Mode"},
            {"value": "creator", "label": "Creator Mode"},
        ],
        "save_options": [
            {"value": "jsonl", "label": "JSONL File"},
            {"value": "json", "label": "JSON File"},
            {"value": "csv", "label": "CSV File"},
            {"value": "excel", "label": "Excel File"},
            {"value": "sqlite", "label": "SQLite Database"},
            {"value": "db", "label": "MySQL Database"},
            {"value": "mongodb", "label": "MongoDB Database"},
        ],
    }


# Mount static resources - must be placed after all routes
if os.path.exists(WEBUI_DIR):
    hub_assets = os.path.join(WEBUI_DIR, "hub", "assets")
    if os.path.exists(hub_assets):
        app.mount("/hub/assets", StaticFiles(directory=hub_assets), name="hub-assets")
    assets_dir = os.path.join(WEBUI_DIR, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    # Mount logos directory
    logos_dir = os.path.join(WEBUI_DIR, "logos")
    if os.path.exists(logos_dir):
        app.mount("/logos", StaticFiles(directory=logos_dir), name="logos")
    # Mount other static files (e.g., vite.svg)
    app.mount("/static", StaticFiles(directory=WEBUI_DIR), name="webui-static")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
