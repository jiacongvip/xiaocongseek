# -*- coding: utf-8 -*-
"""Developer portal API: register / login / API keys / task lookup helpers."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from ..services.auth import AuthContext, require_api_key, require_user
from ..services.portal_store import portal_store
from ..services import crawler_manager

router = APIRouter(prefix="/portal", tags=["portal"])


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: str = Field(min_length=3, max_length=128)
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class CreateKeyRequest(BaseModel):
    name: str = Field(default="default", max_length=64)


@router.post("/register")
async def register(body: RegisterRequest):
    try:
        user = portal_store.create_user(body.username, body.email, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    token = portal_store.create_session(int(user["id"]))
    return {"user": user, "token": token, "token_type": "bearer"}


@router.post("/login")
async def login(body: LoginRequest):
    user = portal_store.authenticate(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = portal_store.create_session(int(user["id"]))
    return {"user": user, "token": token, "token_type": "bearer"}


@router.post("/logout")
async def logout(
    auth: AuthContext = Depends(require_api_key),
    authorization: Optional[str] = Header(default=None),
):
    if auth.auth_type == "session" and authorization and authorization.lower().startswith("bearer "):
        portal_store.delete_session(authorization[7:].strip())
    return {"ok": True}


@router.get("/me")
async def me(auth: AuthContext = Depends(require_api_key)):
    if auth.is_master:
        return {"auth_type": "master", "username": "master", "is_master": True}
    user_id = require_user(auth)
    user = portal_store.get_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    return {"auth_type": auth.auth_type, "is_master": False, "user": user}


@router.get("/usage")
async def usage(auth: AuthContext = Depends(require_api_key)):
    """今日用量与配额（门户用户按 user 汇总；Master 无限）。"""
    from ..services.usage_store import usage_store

    quota = usage_store.daily_quota()
    if auth.is_master:
        return {
            "auth_type": "master",
            "is_master": True,
            "unlimited": True,
            "quota": None,
            "total": 0,
            "remaining": None,
            "day": usage_store.summary_for_user(0).get("day"),
            "by_path": [],
            "note": "Master Key 不受门户日配额限制",
        }
    user_id = require_user(auth)
    summary = usage_store.summary_for_user(user_id)
    summary["auth_type"] = auth.auth_type
    summary["is_master"] = False
    summary["key_id"] = auth.key_id
    return summary


@router.get("/keys")
async def list_keys(auth: AuthContext = Depends(require_api_key)):
    user_id = require_user(auth)
    return {"keys": portal_store.list_api_keys(user_id)}


@router.post("/keys")
async def create_key(body: CreateKeyRequest, auth: AuthContext = Depends(require_api_key)):
    user_id = require_user(auth)
    created = portal_store.create_api_key(user_id, body.name)
    return {
        "key": {
            "id": created["id"],
            "name": created["name"],
            "key_prefix": created["key_prefix"],
            "status": created["status"],
            "created_at": created["created_at"],
        },
        "api_key": created["api_key"],
        "warning": "请立即保存完整 API Key，之后无法再查看明文",
    }


@router.post("/keys/{key_id}/revoke")
async def revoke_key(key_id: int, auth: AuthContext = Depends(require_api_key)):
    user_id = require_user(auth)
    ok = portal_store.revoke_api_key(user_id, key_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Key 不存在或已吊销")
    return {"ok": True, "id": key_id, "status": "revoked"}


@router.get("/tasks")
async def portal_list_tasks(limit: int = 50, auth: AuthContext = Depends(require_api_key)):
    """List tasks visible to the caller (own tasks, or all for master)."""
    if auth.is_master:
        tasks = crawler_manager.list_tasks(limit)
    else:
        user_id = require_user(auth)
        tasks = crawler_manager.list_tasks(limit, owner_user_id=user_id)
    return {"tasks": tasks}


@router.get("/tasks/{task_id}")
async def portal_get_task(task_id: str, auth: AuthContext = Depends(require_api_key)):
    task = crawler_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if auth.is_master:
        return task
    user_id = require_user(auth)
    owner = task.get("owner_user_id")
    if owner is None or int(owner) != int(user_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return task
