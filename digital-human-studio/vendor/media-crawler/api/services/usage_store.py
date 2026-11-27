# -*- coding: utf-8 -*-
"""Per-API-key / per-user daily usage metering (SQLite)."""
from __future__ import annotations

import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _normalize_path(path: str) -> str:
    path = (path or "/").split("?", 1)[0]
    # Collapse task / poi / sentence ids
    path = re.sub(r"/tasks/[0-9a-fA-F-]{8,}", "/tasks/{id}", path)
    path = re.sub(r"/poi/[A-Za-z0-9_-]+", "/poi/{id}", path)
    path = re.sub(r"/sentence/[A-Za-z0-9_-]+", "/sentence/{id}", path)
    path = re.sub(r"/keys/\d+", "/keys/{id}", path)
    path = re.sub(r"/billboard/[A-Za-z0-9_-]+", "/billboard/{board}", path)
    path = re.sub(r"/common/[A-Za-z0-9_-]+", "/common/{kind}", path)
    if len(path) > 160:
        path = path[:160]
    return path


class UsageStore:
    def __init__(self) -> None:
        data_dir = Path(os.getenv("MEDIA_CRAWLER_DATA_DIR", "data"))
        data_dir.mkdir(parents=True, exist_ok=True)
        self.path = Path(os.getenv("MEDIA_CRAWLER_USAGE_DB", str(data_dir / "usage.db")))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS usage_daily (
                    day TEXT NOT NULL,
                    user_id INTEGER,
                    key_id INTEGER,
                    path TEXT NOT NULL,
                    count INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (day, user_id, key_id, path)
                );
                CREATE INDEX IF NOT EXISTS idx_usage_user_day ON usage_daily(user_id, day);
                CREATE INDEX IF NOT EXISTS idx_usage_key_day ON usage_daily(key_id, day);
                """
            )

    def daily_quota(self) -> int:
        try:
            return max(0, int(os.getenv("PORTAL_DAILY_QUOTA", "1000")))
        except ValueError:
            return 1000

    def user_day_total(self, user_id: int, day: Optional[str] = None) -> int:
        day = day or _today()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COALESCE(SUM(count), 0) AS n FROM usage_daily WHERE user_id = ? AND day = ?",
                (int(user_id), day),
            ).fetchone()
        return int(row["n"] if row else 0)

    def key_day_total(self, key_id: int, day: Optional[str] = None) -> int:
        day = day or _today()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COALESCE(SUM(count), 0) AS n FROM usage_daily WHERE key_id = ? AND day = ?",
                (int(key_id), day),
            ).fetchone()
        return int(row["n"] if row else 0)

    def record(
        self,
        *,
        user_id: Optional[int],
        key_id: Optional[int],
        path: str,
        day: Optional[str] = None,
    ) -> None:
        day = day or _today()
        norm = _normalize_path(path)
        uid = int(user_id) if user_id is not None else 0
        kid = int(key_id) if key_id is not None else 0
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO usage_daily (day, user_id, key_id, path, count)
                VALUES (?, ?, ?, ?, 1)
                ON CONFLICT(day, user_id, key_id, path)
                DO UPDATE SET count = count + 1
                """,
                (day, uid, kid, norm),
            )

    def summary_for_user(self, user_id: int, day: Optional[str] = None) -> dict[str, Any]:
        day = day or _today()
        quota = self.daily_quota()
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT path, SUM(count) AS count
                FROM usage_daily
                WHERE user_id = ? AND day = ?
                GROUP BY path
                ORDER BY count DESC
                LIMIT 50
                """,
                (int(user_id), day),
            ).fetchall()
            by_key = conn.execute(
                """
                SELECT key_id, SUM(count) AS count
                FROM usage_daily
                WHERE user_id = ? AND day = ?
                GROUP BY key_id
                ORDER BY count DESC
                """,
                (int(user_id), day),
            ).fetchall()
        total = sum(int(r["count"]) for r in rows)
        return {
            "day": day,
            "user_id": int(user_id),
            "total": total,
            "quota": quota,
            "remaining": None if quota <= 0 else max(0, quota - total),
            "unlimited": quota <= 0,
            "by_path": [{"path": r["path"], "count": int(r["count"])} for r in rows],
            "by_key": [{"key_id": int(r["key_id"]), "count": int(r["count"])} for r in by_key],
        }


usage_store = UsageStore()

# Paths that should not consume portal quota (still may be recorded optionally)
_SKIP_PREFIXES = (
    "/api/health",
    "/api/portal/login",
    "/api/portal/register",
    "/api/config/",
)


def should_meter(path: str) -> bool:
    if not path.startswith("/api/"):
        return False
    for p in _SKIP_PREFIXES:
        if path == p or path.startswith(p):
            return False
    # hub demo / map public proxies are keyless — no auth dependency
    if path.startswith("/hub/") or path.startswith("/map/api"):
        return False
    return True
