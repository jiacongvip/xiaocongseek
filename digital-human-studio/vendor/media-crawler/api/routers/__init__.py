# -*- coding: utf-8 -*-
from .crawler import router as crawler_router, tasks_router
from .data import router as data_router
from .websocket import router as websocket_router
from .portal import router as portal_router
from .douyin_index import router as douyin_index_router
from .douhot import router as douhot_router
from .map_leads import router as map_leads_router, public_router as map_public_router
from .hub_demo import router as hub_demo_router
from .douyin_content import router as douyin_content_router

__all__ = [
    "crawler_router",
    "tasks_router",
    "data_router",
    "websocket_router",
    "portal_router",
    "douyin_index_router",
    "douhot_router",
    "map_leads_router",
    "map_public_router",
    "hub_demo_router",
    "douyin_content_router",
]
