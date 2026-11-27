import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


class TaskStore:
    def __init__(self) -> None:
        data_dir = Path(os.getenv("MEDIA_CRAWLER_DATA_DIR", "data"))
        data_dir.mkdir(parents=True, exist_ok=True)
        self.path = Path(os.getenv("MEDIA_CRAWLER_TASK_DB", str(data_dir / "tasks.db")))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path) as connection:
            connection.execute(
                """CREATE TABLE IF NOT EXISTS crawler_tasks (
                    task_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    crawler_type TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    pid INTEGER,
                    exit_code INTEGER,
                    error_message TEXT,
                    config_json TEXT NOT NULL,
                    output_dir TEXT NOT NULL,
                    log_path TEXT NOT NULL
                )"""
            )
            cols = {row[1] for row in connection.execute("PRAGMA table_info(crawler_tasks)").fetchall()}
            if "owner_user_id" not in cols:
                connection.execute("ALTER TABLE crawler_tasks ADD COLUMN owner_user_id INTEGER")

    def create(self, task: dict[str, Any]) -> None:
        columns = ", ".join(task.keys())
        placeholders = ", ".join("?" for _ in task)
        values = [json.dumps(value, ensure_ascii=False) if isinstance(value, dict) else value for value in task.values()]
        with sqlite3.connect(self.path) as connection:
            connection.execute(f"INSERT INTO crawler_tasks ({columns}) VALUES ({placeholders})", values)

    def update(self, task_id: str, **values: Any) -> None:
        if not values:
            return
        assignments = ", ".join(f"{key} = ?" for key in values)
        with sqlite3.connect(self.path) as connection:
            connection.execute(f"UPDATE crawler_tasks SET {assignments} WHERE task_id = ?", [*values.values(), task_id])

    def get(self, task_id: str) -> Optional[dict[str, Any]]:
        with sqlite3.connect(self.path) as connection:
            connection.row_factory = sqlite3.Row
            row = connection.execute("SELECT * FROM crawler_tasks WHERE task_id = ?", (task_id,)).fetchone()
        return self._decode(row) if row else None

    def list(self, limit: int = 50, owner_user_id: Optional[int] = None) -> list[dict[str, Any]]:
        with sqlite3.connect(self.path) as connection:
            connection.row_factory = sqlite3.Row
            if owner_user_id is None:
                rows = connection.execute(
                    "SELECT * FROM crawler_tasks ORDER BY created_at DESC LIMIT ?", (limit,)
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM crawler_tasks WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT ?",
                    (owner_user_id, limit),
                ).fetchall()
        return [self._decode(row) for row in rows]

    def recover_running(self) -> None:
        with sqlite3.connect(self.path) as connection:
            rows = connection.execute(
                "SELECT task_id, pid FROM crawler_tasks WHERE status IN ('queued', 'running', 'stopping')"
            ).fetchall()
            for task_id, pid in rows:
                alive = False
                if pid:
                    try:
                        os.kill(pid, 0)
                        alive = True
                    except OSError:
                        pass
                if not alive:
                    connection.execute(
                        "UPDATE crawler_tasks SET status = 'failed', finished_at = ?, error_message = ? WHERE task_id = ?",
                        (now(), "API service restarted while task was running", task_id),
                    )

    @staticmethod
    def _decode(row: sqlite3.Row) -> dict[str, Any]:
        item = dict(row)
        item["config_json"] = json.loads(item["config_json"])
        return item


def now() -> str:
    return datetime.now(timezone.utc).isoformat()
