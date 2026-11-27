import sqlite3
import uuid
from pathlib import Path

from conf import BASE_DIR
from newFileUpload.platform_configs import get_platform_key_by_type


DATABASE_PATH = Path(BASE_DIR / "db" / "database.db")
COOKIE_BASE_DIR = Path(BASE_DIR / "cookiesFile")


def ensure_runtime_schema():
    with sqlite3.connect(DATABASE_PATH) as conn:
        cursor = conn.cursor()

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS proxy_pool (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                scheme TEXT NOT NULL DEFAULT 'http',
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT,
                password TEXT,
                region TEXT,
                city TEXT,
                source TEXT DEFAULT 'manual',
                type TEXT DEFAULT 'custom',
                sticky INTEGER DEFAULT 1,
                status INTEGER DEFAULT 1,
                last_check_ip TEXT,
                last_check_at DATETIME,
                remark TEXT,
                create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                update_time DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS browser_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                profile_name TEXT,
                profile_path TEXT NOT NULL,
                proxy_id INTEGER,
                browser_engine TEXT DEFAULT 'chromium',
                locale TEXT DEFAULT 'zh-CN',
                launch_args_json TEXT,
                run_headless INTEGER DEFAULT 0,
                status INTEGER DEFAULT 1,
                last_used_at DATETIME,
                last_login_at DATETIME,
                create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                update_time DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS profile_runtime_locks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id INTEGER NOT NULL,
                task_id TEXT,
                lock_owner TEXT,
                status TEXT DEFAULT 'locked',
                lock_until DATETIME,
                create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                update_time DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        cursor.execute("PRAGMA table_info(user_info)")
        existing_columns = {row[1] for row in cursor.fetchall()}
        required_columns = {
            "runtime_mode": "ALTER TABLE user_info ADD COLUMN runtime_mode TEXT DEFAULT 'storage_state'",
            "browser_profile_id": "ALTER TABLE user_info ADD COLUMN browser_profile_id INTEGER",
            "proxy_id": "ALTER TABLE user_info ADD COLUMN proxy_id INTEGER",
            "status_reason": "ALTER TABLE user_info ADD COLUMN status_reason TEXT",
            "status_detail": "ALTER TABLE user_info ADD COLUMN status_detail TEXT",
            "last_validated_at": "ALTER TABLE user_info ADD COLUMN last_validated_at DATETIME",
        }

        for column, sql in required_columns.items():
            if column not in existing_columns:
                cursor.execute(sql)

        conn.commit()


def build_default_profile_rel_path(platform_type, account_name="profile"):
    platform_key = get_platform_key_by_type(int(platform_type)) or "platform"
    return str(Path("profiles") / f"{platform_key}_{uuid.uuid4().hex}")


def resolve_cookie_relative_path(file_path):
    path = Path(file_path)
    if path.is_absolute():
        try:
            return str(path.resolve().relative_to(COOKIE_BASE_DIR.resolve()))
        except Exception:
            return str(path.name)
    return str(path)


def resolve_cookie_storage_path(file_path):
    path = Path(file_path)
    if path.is_absolute():
        return path
    return COOKIE_BASE_DIR / path


def build_proxy_server(proxy_row):
    if not proxy_row:
        return None

    scheme = (proxy_row.get("scheme") or "http").strip().lower()
    host = (proxy_row.get("host") or "").strip()
    port = proxy_row.get("port")
    if not host or not port:
        return None
    if "://" in host:
        return host
    return f"{scheme}://{host}:{port}"


def build_playwright_proxy(proxy_row):
    server = build_proxy_server(proxy_row)
    if not server:
        return None

    proxy = {"server": server}
    username = (proxy_row.get("username") or "").strip()
    password = proxy_row.get("password") or ""
    if username:
        proxy["username"] = username
        proxy["password"] = password
    return proxy


def build_requests_proxy(proxy_row):
    server = build_proxy_server(proxy_row)
    if not server:
        return None
    username = (proxy_row.get("username") or "").strip()
    password = proxy_row.get("password") or ""
    if username:
        prefix, suffix = server.split("://", 1)
        server = f"{prefix}://{username}:{password}@{suffix}"
    return {"http": server, "https": server}


def serialize_proxy_row(row):
    if not row:
        return None
    proxy = dict(row)
    proxy["proxyServer"] = build_proxy_server(proxy)
    return proxy


def get_proxy_by_id(proxy_id):
    if not proxy_id:
        return None
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM proxy_pool WHERE id = ?", (proxy_id,))
        row = cursor.fetchone()
        return serialize_proxy_row(row) if row else None


def get_account_runtime_by_account_id(account_id):
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                u.*,
                bp.profile_path AS browser_profile_path,
                bp.locale AS browser_profile_locale,
                bp.launch_args_json AS browser_profile_launch_args_json,
                bp.run_headless AS browser_profile_headless
            FROM user_info u
            LEFT JOIN browser_profiles bp ON bp.id = u.browser_profile_id
            WHERE u.id = ?
            """,
            (account_id,),
        )
        account_row = cursor.fetchone()
        if not account_row:
            return None
        runtime = dict(account_row)
        runtime["proxy"] = get_proxy_by_id(runtime.get("proxy_id"))
        return runtime


def get_account_runtime_by_identity(platform_type, user_name):
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                u.*,
                bp.profile_path AS browser_profile_path,
                bp.locale AS browser_profile_locale,
                bp.launch_args_json AS browser_profile_launch_args_json,
                bp.run_headless AS browser_profile_headless
            FROM user_info u
            LEFT JOIN browser_profiles bp ON bp.id = u.browser_profile_id
            WHERE u.type = ? AND u.userName = ?
            ORDER BY u.id DESC
            LIMIT 1
            """,
            (platform_type, user_name),
        )
        account_row = cursor.fetchone()
        if not account_row:
            return None
        runtime = dict(account_row)
        runtime["proxy"] = get_proxy_by_id(runtime.get("proxy_id"))
        return runtime


def get_account_runtime_by_file_path(file_path):
    relative_path = resolve_cookie_relative_path(file_path)
    absolute_path = str(resolve_cookie_storage_path(relative_path))
    candidates = [relative_path, absolute_path, Path(relative_path).name]

    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        placeholders = ",".join("?" for _ in candidates)
        cursor.execute(
            f"""
            SELECT
                u.*,
                bp.profile_path AS browser_profile_path,
                bp.locale AS browser_profile_locale,
                bp.launch_args_json AS browser_profile_launch_args_json,
                bp.run_headless AS browser_profile_headless
            FROM user_info u
            LEFT JOIN browser_profiles bp ON bp.id = u.browser_profile_id
            WHERE u.filePath IN ({placeholders})
            ORDER BY u.id DESC
            LIMIT 1
            """,
            candidates,
        )
        account_row = cursor.fetchone()
        if not account_row:
            return None
        runtime = dict(account_row)
        runtime["proxy"] = get_proxy_by_id(runtime.get("proxy_id"))
        return runtime


def upsert_browser_profile(account_id, platform_type, profile_name=None, profile_rel_path=None, proxy_id=None, locale="zh-CN"):
    profile_rel_path = profile_rel_path or build_default_profile_rel_path(platform_type, profile_name or str(account_id))
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, profile_path FROM browser_profiles WHERE account_id = ? ORDER BY id DESC LIMIT 1",
            (account_id,),
        )
        existing = cursor.fetchone()
        if existing:
            cursor.execute(
                """
                UPDATE browser_profiles
                SET profile_name = ?, profile_path = ?, proxy_id = ?, locale = ?, update_time = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (profile_name or existing["profile_path"], profile_rel_path, proxy_id, locale, existing["id"]),
            )
            conn.commit()
            return existing["id"], profile_rel_path

        cursor.execute(
            """
            INSERT INTO browser_profiles (account_id, profile_name, profile_path, proxy_id, locale)
            VALUES (?, ?, ?, ?, ?)
            """,
            (account_id, profile_name or f"账号环境-{account_id}", profile_rel_path, proxy_id, locale),
        )
        conn.commit()
        return cursor.lastrowid, profile_rel_path
