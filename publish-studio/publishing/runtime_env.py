"""Resolve isolated publish-studio Python + Playwright browsers path."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

PLUGIN_PUBLISHING = Path(__file__).resolve().parent
PLUGIN_ROOT = PLUGIN_PUBLISHING.parent
DEFAULT_RUNTIME_ROOT = Path.home() / ".dsh" / "publish-studio" / "runtime"
PINNED_PLAYWRIGHT = "1.52.0"


def runtime_root() -> Path:
    override = os.environ.get("PUBLISH_STUDIO_RUNTIME_ROOT", "").strip()
    return Path(override).expanduser() if override else DEFAULT_RUNTIME_ROOT


def status_path() -> Path:
    return runtime_root() / "status.json"


def venv_python() -> Path:
    root = runtime_root()
    if sys.platform == "win32":
        return root / "venv" / "Scripts" / "python.exe"
    return root / "venv" / "bin" / "python"


def browsers_path() -> Path:
    return runtime_root() / "ms-playwright"


def load_status() -> dict:
    p = status_path()
    if not p.exists():
        return {"ready": False, "phase": "missing", "message": "运行时尚未安装", "missing": ["runtime"]}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {"ready": False, "phase": "corrupt", "message": "运行时状态文件损坏", "missing": ["status"]}


def write_status(payload: dict) -> dict:
    root = runtime_root()
    root.mkdir(parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    data = dict(payload)
    data.setdefault("runtimeRoot", str(root))
    data.setdefault("browsersPath", str(browsers_path()))
    data.setdefault("python", str(venv_python()) if venv_python().exists() else None)
    data.setdefault("pinnedPlaywright", PINNED_PLAYWRIGHT)
    tmp = status_path().with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(status_path())
    return data


def public_status() -> dict:
    st = load_status()
    # Never leak home noise beyond needed fields
    return {
        "ready": bool(st.get("ready")),
        "phase": st.get("phase") or ("ready" if st.get("ready") else "missing"),
        "message": st.get("message") or "",
        "missing": list(st.get("missing") or []),
        "pinnedPlaywright": st.get("pinnedPlaywright") or PINNED_PLAYWRIGHT,
        "pythonExists": bool(st.get("python") and Path(str(st["python"])).exists()),
        "browsersReady": bool(st.get("browsersReady")),
        "probeOk": bool(st.get("probeOk")),
        "updatedAt": st.get("updatedAt"),
    }
