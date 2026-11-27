# -*- coding: utf-8 -*-
"""Portal users / sessions / API keys (SQLite)."""
from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_password(password: str, salt: Optional[str] = None, rounds: int = 260000) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), rounds).hex()
    return f"pbkdf2_sha256${rounds}${salt}${digest}"


def _verify_password(password: str, encoded: str) -> bool:
    try:
        algo, rounds_s, salt, digest = encoded.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        rounds = int(rounds_s)
    except ValueError:
        return False
    check = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), rounds).hex()
    return secrets.compare_digest(check, digest)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class PortalStore:
    def __init__(self) -> None:
        data_dir = Path(os.getenv("MEDIA_CRAWLER_DATA_DIR", "data"))
        data_dir.mkdir(parents=True, exist_ok=True)
        self.path = Path(os.getenv("MEDIA_CRAWLER_PORTAL_DB", str(data_dir / "portal.db")))
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
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS api_keys (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    key_prefix TEXT NOT NULL,
                    key_hash TEXT NOT NULL UNIQUE,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL,
                    revoked_at TEXT,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );
                CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
                CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
                """
            )

    # ---- users ----
    def create_user(self, username: str, email: str, password: str) -> dict[str, Any]:
        username = username.strip()
        email = email.strip().lower()
        if len(username) < 3 or len(password) < 6:
            raise ValueError("用户名至少 3 位，密码至少 6 位")
        if "@" not in email:
            raise ValueError("邮箱格式不正确")
        with self._connect() as conn:
            try:
                cur = conn.execute(
                    "INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
                    (username, email, _hash_password(password), _now()),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("用户名或邮箱已存在") from exc
            user_id = int(cur.lastrowid)
        return self.get_user(user_id)  # type: ignore[return-value]

    def get_user(self, user_id: int) -> Optional[dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, username, email, created_at FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        return dict(row) if row else None

    def get_user_by_username(self, username: str) -> Optional[dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", (username.strip(),)).fetchone()
        return dict(row) if row else None

    def authenticate(self, username: str, password: str) -> Optional[dict[str, Any]]:
        row = self.get_user_by_username(username)
        if not row:
            return None
        if not _verify_password(password, row["password_hash"]):
            return None
        return {"id": row["id"], "username": row["username"], "email": row["email"], "created_at": row["created_at"]}

    # ---- sessions ----
    def create_session(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)",
                (_sha256(token), user_id, _now()),
            )
        return token

    def get_user_by_session(self, token: str) -> Optional[dict[str, Any]]:
        if not token:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT u.id, u.username, u.email, u.created_at
                FROM sessions s JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = ?
                """,
                (_sha256(token),),
            ).fetchone()
        return dict(row) if row else None

    def delete_session(self, token: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_sha256(token),))

    # ---- api keys ----
    def create_api_key(self, user_id: int, name: str) -> dict[str, Any]:
        name = (name or "default").strip()[:64] or "default"
        raw = "mc_" + secrets.token_urlsafe(24)
        prefix = raw[:10]
        with self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO api_keys (user_id, name, key_prefix, key_hash, status, created_at)
                VALUES (?, ?, ?, ?, 'active', ?)
                """,
                (user_id, name, prefix, _sha256(raw), _now()),
            )
            key_id = int(cur.lastrowid)
        return {
            "id": key_id,
            "name": name,
            "key_prefix": prefix,
            "api_key": raw,  # only returned once
            "status": "active",
            "created_at": _now(),
        }

    def list_api_keys(self, user_id: int) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, name, key_prefix, status, created_at, revoked_at
                FROM api_keys WHERE user_id = ? ORDER BY id DESC
                """,
                (user_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def revoke_api_key(self, user_id: int, key_id: int) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE api_keys SET status = 'revoked', revoked_at = ?
                WHERE id = ? AND user_id = ? AND status = 'active'
                """,
                (_now(), key_id, user_id),
            )
            return cur.rowcount > 0

    def resolve_api_key(self, raw_key: str) -> Optional[dict[str, Any]]:
        if not raw_key:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT k.id AS key_id, k.user_id, k.name, k.status, u.username, u.email
                FROM api_keys k JOIN users u ON u.id = k.user_id
                WHERE k.key_hash = ?
                """,
                (_sha256(raw_key),),
            ).fetchone()
        if not row or row["status"] != "active":
            return None
        return dict(row)


portal_store = PortalStore()
