# -*- coding: utf-8 -*-
"""API authentication: master env key, per-user API keys, or portal session tokens."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from typing import Optional

from fastapi import Header, HTTPException, Request, WebSocket

from .portal_store import portal_store


@dataclass
class AuthContext:
    """Resolved caller identity."""

    is_master: bool = False
    user_id: Optional[int] = None
    username: Optional[str] = None
    auth_type: str = "none"  # master | api_key | session | none
    key_id: Optional[int] = None


def _master_key() -> Optional[str]:
    return os.getenv("MEDIA_CRAWLER_API_KEY") or None


def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def resolve_credential(raw: Optional[str]) -> AuthContext:
    """Resolve a bearer / x-api-key credential into AuthContext."""
    master = _master_key()
    if not raw:
        # No credential: allow only when master key is unset (legacy open mode)
        if master is None:
            return AuthContext(is_master=True, auth_type="none")
        raise HTTPException(status_code=401, detail="Authentication required")

    if master is not None and secrets.compare_digest(raw, master):
        return AuthContext(is_master=True, username="master", auth_type="master")

    key_row = portal_store.resolve_api_key(raw)
    if key_row:
        return AuthContext(
            is_master=False,
            user_id=int(key_row["user_id"]),
            username=key_row.get("username"),
            auth_type="api_key",
            key_id=int(key_row["key_id"]) if key_row.get("key_id") is not None else None,
        )

    user = portal_store.get_user_by_session(raw)
    if user:
        return AuthContext(
            is_master=False,
            user_id=int(user["id"]),
            username=user.get("username"),
            auth_type="session",
            key_id=None,
        )

    raise HTTPException(status_code=401, detail="Invalid credentials")


def _apply_usage(request: Optional[Request], ctx: AuthContext) -> None:
    """Record usage and enforce soft daily quota for portal users (master unlimited)."""
    if request is None:
        return
    path = request.url.path
    try:
        from .usage_store import should_meter, usage_store
    except Exception:
        return
    if not should_meter(path):
        return
    if ctx.is_master:
        # optional light record under user_id=0 / key_id=0
        try:
            usage_store.record(user_id=0, key_id=0, path=path)
        except Exception:
            pass
        return
    if not ctx.user_id:
        return
    try:
        quota = usage_store.daily_quota()
        if quota > 0:
            used = usage_store.user_day_total(int(ctx.user_id))
            if used >= quota:
                raise HTTPException(
                    status_code=429,
                    detail=f"今日 API 配额已用尽（{used}/{quota}）。Master Key 不受限，或明日再试。",
                )
        usage_store.record(user_id=int(ctx.user_id), key_id=ctx.key_id, path=path)
    except HTTPException:
        raise
    except Exception:
        # metering must not break API if DB hiccups
        pass


async def require_api_key(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None),
) -> AuthContext:
    """FastAPI dependency: master key OR user API key OR portal session token."""
    raw = x_api_key or _extract_bearer(authorization)
    ctx = resolve_credential(raw)
    _apply_usage(request, ctx)
    return ctx


async def get_auth_context(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None),
) -> AuthContext:
    """Alias for require_api_key (explicit naming for portal routes)."""
    return await require_api_key(
        request=request, authorization=authorization, x_api_key=x_api_key
    )


def authenticate_websocket(websocket: WebSocket) -> bool:
    master = _master_key()
    provided = websocket.headers.get("x-api-key")
    authorization = websocket.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        provided = authorization[7:].strip()
    # Also allow query ?token= for browser EventSource-like clients
    if not provided:
        provided = websocket.query_params.get("token") or websocket.query_params.get("api_key")

    if master is None and not provided:
        return True
    if not provided:
        return False
    try:
        resolve_credential(provided)
        return True
    except HTTPException:
        return False


def require_user(auth: AuthContext) -> int:
    if auth.is_master:
        raise HTTPException(status_code=400, detail="请使用门户账号登录，而不是 Master Key")
    if not auth.user_id:
        raise HTTPException(status_code=401, detail="需要登录")
    return auth.user_id


def require_master(auth: AuthContext) -> None:
    if not auth.is_master:
        raise HTTPException(status_code=403, detail="需要 Master Key")
