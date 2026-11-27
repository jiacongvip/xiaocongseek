import asyncio
import json
import os
import signal
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List

from ..schemas import CrawlerStartRequest, LogEntry
from .task_store import TaskStore, now


class CrawlerManager:
    """Manage one isolated crawler subprocess at a time."""

    def __init__(self):
        self._lock = asyncio.Lock()
        self.process: Optional[subprocess.Popen] = None
        self.status = "idle"
        self.started_at: Optional[datetime] = None
        self.current_config: Optional[CrawlerStartRequest] = None
        self.current_task_id: Optional[str] = None
        self._log_id = 0
        self._logs: List[LogEntry] = []
        self._read_task: Optional[asyncio.Task] = None
        self._project_root = Path(__file__).parent.parent.parent
        self._log_queue: Optional[asyncio.Queue] = None
        self.store = TaskStore()
        self.store.recover_running()

    @property
    def logs(self) -> List[LogEntry]:
        return self._logs

    def get_log_queue(self) -> asyncio.Queue:
        if self._log_queue is None:
            self._log_queue = asyncio.Queue()
        return self._log_queue

    def _create_log_entry(self, message: str, level: str = "info") -> LogEntry:
        self._log_id += 1
        entry = LogEntry(id=self._log_id, timestamp=datetime.now().strftime("%H:%M:%S"), level=level, message=message)
        self._logs.append(entry)
        if len(self._logs) > 500:
            self._logs = self._logs[-500:]
        if self.current_task_id:
            log_path = self._task_log_path(self.current_task_id)
            with log_path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps({"task_id": self.current_task_id, **entry.model_dump()}, ensure_ascii=False) + "\n")
        return entry

    async def _push_log(self, entry: LogEntry):
        if self._log_queue is not None:
            try:
                self._log_queue.put_nowait(entry)
            except asyncio.QueueFull:
                pass

    def _parse_log_level(self, line: str) -> str:
        upper = line.upper()
        if "ERROR" in upper or "FAILED" in upper:
            return "error"
        if "WARNING" in upper or "WARN" in upper:
            return "warning"
        if "SUCCESS" in upper or "完成" in line or "成功" in line:
            return "success"
        if "DEBUG" in upper:
            return "debug"
        return "info"

    def _data_dir(self) -> Path:
        return Path(os.getenv("MEDIA_CRAWLER_DATA_DIR", str(self._project_root / "data")))

    def _task_dir(self, task_id: str) -> Path:
        path = self._data_dir() / "tasks" / task_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _task_log_path(self, task_id: str) -> Path:
        return self._task_dir(task_id) / "logs.jsonl"

    async def start(self, config: CrawlerStartRequest, owner_user_id: Optional[int] = None) -> Optional[str]:
        async with self._lock:
            if self.process and self.process.poll() is None:
                return None
            task_id = str(uuid.uuid4())
            task_dir = self._task_dir(task_id)
            self._logs = []
            self._log_id = 0
            if self._log_queue is None:
                self._log_queue = asyncio.Queue()
            else:
                while not self._log_queue.empty():
                    self._log_queue.get_nowait()
            config = self._resolve_default_cookies(config)
            command = self._build_command(config, task_dir)
            self.current_task_id = task_id
            self.current_config = config
            self.store.create({
                "task_id": task_id,
                "status": "queued",
                "platform": config.platform.value,
                "crawler_type": config.crawler_type.value,
                "created_at": now(),
                "config_json": self._safe_config(config),
                "output_dir": str(task_dir),
                "log_path": str(self._task_log_path(task_id)),
                "owner_user_id": owner_user_id,
            })
            entry = self._create_log_entry(f"Starting crawler: {' '.join(command)}", "info")
            await self._push_log(entry)
            try:
                self.process = subprocess.Popen(
                    command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                    encoding="utf-8", bufsize=1, cwd=str(self._project_root),
                    env={**os.environ, "PYTHONUNBUFFERED": "1"},
                    start_new_session=True,
                )
                self.status = "running"
                self.started_at = datetime.now()
                self.store.update(task_id, status="running", started_at=now(), pid=self.process.pid)
                entry = self._create_log_entry(f"Crawler started on platform: {config.platform.value}, type: {config.crawler_type.value}", "success")
                await self._push_log(entry)
                self._read_task = asyncio.create_task(self._read_output(task_id))
                return task_id
            except Exception as exc:
                self.status = "error"
                self.store.update(task_id, status="failed", finished_at=now(), error_message=str(exc))
                entry = self._create_log_entry(f"Failed to start crawler: {exc}", "error")
                await self._push_log(entry)
                return None

    async def stop(self) -> bool:
        async with self._lock:
            if not self.process or self.process.poll() is not None:
                return False
            self.status = "stopping"
            if self.current_task_id:
                self.store.update(self.current_task_id, status="stopping")
            try:
                os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
                for _ in range(30):
                    if self.process.poll() is not None:
                        break
                    await asyncio.sleep(0.5)
                if self.process.poll() is None:
                    os.killpg(os.getpgid(self.process.pid), signal.SIGKILL)
                return True
            finally:
                self.status = "cancelled"
                if self.current_task_id:
                    self.store.update(self.current_task_id, status="cancelled", finished_at=now(), exit_code=self.process.returncode)

    def get_status(self) -> dict:
        task = self.store.get(self.current_task_id) if self.current_task_id else None
        if task:
            return {"status": task["status"], "platform": task["platform"], "crawler_type": task["crawler_type"], "started_at": task["started_at"], "error_message": task["error_message"], "task_id": task["task_id"], "exit_code": task["exit_code"]}
        return {"status": self.status, "platform": None, "crawler_type": None, "started_at": None, "error_message": None, "task_id": None, "exit_code": None}

    def get_task(self, task_id: str) -> Optional[dict]:
        return self.store.get(task_id)

    def list_tasks(self, limit: int = 50, owner_user_id: Optional[int] = None) -> list[dict]:
        return self.store.list(max(1, min(limit, 100)), owner_user_id=owner_user_id)

    def _safe_config(self, config: CrawlerStartRequest) -> dict:
        data = config.model_dump(mode="json")
        if data.get("cookies"):
            data["cookies"] = "[redacted]"
        return data

    def _force_headless(self) -> bool:
        """Docker/server has no X display; honor FORCE_HEADLESS / MEDIA_CRAWLER_FORCE_HEADLESS or missing DISPLAY."""
        for key in ("FORCE_HEADLESS", "MEDIA_CRAWLER_FORCE_HEADLESS"):
            val = os.getenv(key, "").strip().lower()
            if val in {"1", "true", "yes", "on"}:
                return True
            if val in {"0", "false", "no", "off"}:
                return False
        # Default for containers / headless hosts: no DISPLAY means force headless.
        return not bool(os.getenv("DISPLAY", "").strip())


    def _resolve_default_cookies(self, config: CrawlerStartRequest) -> CrawlerStartRequest:
        """If request has no cookies, load fixed Douyin cookie file when present."""
        if (config.cookies or "").strip():
            return config
        env_path = os.getenv("MEDIA_CRAWLER_DEFAULT_COOKIES_FILE", "").strip()
        candidates = []
        if env_path:
            candidates.append(Path(env_path))
        candidates.extend([
            self._project_root / ".douyin_cookies.txt",
            self._data_dir() / "douyin_cookies.txt",
        ])
        platform = getattr(config.platform, "value", str(config.platform))
        for path in candidates:
            try:
                if not path.is_file():
                    continue
                text = path.read_text(encoding="utf-8").strip()
                if not text:
                    continue
                updates = {"cookies": text}
                # Fixed cookie implies cookie login.
                if hasattr(config.login_type, "value"):
                    from ..schemas import LoginTypeEnum
                    updates["login_type"] = LoginTypeEnum.COOKIE
                return config.model_copy(update=updates)
            except Exception:
                continue
        return config

    def _build_command(self, config: CrawlerStartRequest, task_dir: Optional[Path] = None) -> list:
        task_dir = task_dir or self._data_dir()
        cmd = ["uv", "run", "python", "main.py", "--platform", config.platform.value, "--lt", config.login_type.value, "--type", config.crawler_type.value, "--save_data_option", config.save_option.value]
        if config.crawler_type.value == "search" and config.keywords:
            cmd.extend(["--keywords", config.keywords])
        elif config.crawler_type.value == "detail" and config.specified_ids:
            cmd.extend(["--specified_id", config.specified_ids])
        elif config.crawler_type.value == "creator" and config.creator_ids:
            cmd.extend(["--creator_id", config.creator_ids])
        if config.start_page != 1:
            cmd.extend(["--start", str(config.start_page)])
        headless = True if self._force_headless() else bool(config.headless)
        cmd.extend(["--get_comment", str(config.enable_comments).lower(), "--get_sub_comment", str(config.enable_sub_comments).lower(), "--get_media", str(config.enable_media).lower(), "--save_data_path", str(task_dir), "--headless", str(headless).lower()])
        if config.max_notes_count is not None:
            cmd.extend(["--crawler_max_notes_count", str(config.max_notes_count)])
        # Default was 10/note in MediaCrawler config — too low for comment insights.
        if config.max_comments_count is not None:
            cmd.extend(["--max_comments_count_singlenotes", str(config.max_comments_count)])
        elif config.enable_comments:
            cmd.extend(["--max_comments_count_singlenotes", "200"])
        if config.cookies:
            cmd.extend(["--cookies", config.cookies])
        return cmd

    async def _read_output(self, task_id: str):
        loop = asyncio.get_running_loop()
        try:
            while self.process and self.process.poll() is None:
                line = await loop.run_in_executor(None, self.process.stdout.readline)
                if line.strip():
                    entry = self._create_log_entry(line.strip(), self._parse_log_level(line))
                    await self._push_log(entry)
            if self.process and self.process.stdout:
                remaining = await loop.run_in_executor(None, self.process.stdout.read)
                for line in remaining.strip().splitlines():
                    if line.strip():
                        entry = self._create_log_entry(line.strip(), self._parse_log_level(line))
                        await self._push_log(entry)
            exit_code = self.process.returncode if self.process else -1
            if self.status == "running":
                self.status = "succeeded" if exit_code == 0 else "failed"
                level = "success" if exit_code == 0 else "error"
                entry = self._create_log_entry("Crawler completed successfully" if exit_code == 0 else f"Crawler exited with code: {exit_code}", level)
                await self._push_log(entry)
                self.store.update(task_id, status=self.status, finished_at=now(), exit_code=exit_code)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            self.status = "failed"
            self.store.update(task_id, status="failed", finished_at=now(), error_message=str(exc))


crawler_manager = CrawlerManager()
