#!/usr/bin/env python3
"""Idempotent install of isolated Python venv + pinned Playwright Chromium for publish-studio.

Does not touch system/user site-packages or other plugins.
Never uses sudo. Writes status.json honestly.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from runtime_env import (
    PINNED_PLAYWRIGHT,
    browsers_path,
    load_status,
    public_status,
    runtime_root,
    status_path,
    venv_python,
    write_status,
)

REQ = Path(__file__).resolve().parent / "requirements-runtime.txt"
PYPI_MIRRORS = [
    ("清华源", "https://pypi.tuna.tsinghua.edu.cn/simple"),
    ("阿里云源", "https://mirrors.aliyun.com/pypi/simple/"),
]
PROXY_ENV_KEYS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")


def env_without_proxy(base: dict[str, str] | None = None) -> dict[str, str]:
    env = dict(base if base is not None else os.environ)
    for key in PROXY_ENV_KEYS:
        env.pop(key, None)
    return env


def pip_install_requirements(py: Path, req: Path) -> None:
    """国内优先走镜像源，遇到代理导致 SSL UNEXPECTED_EOF 时自动去代理直连重试，最后兜底官方源。"""
    base_cmd = [str(py), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(req)]
    attempts: list[tuple[str, list[str], dict[str, str] | None]] = []
    for label, mirror in PYPI_MIRRORS:
        attempts.append((label, [*base_cmd, "-i", mirror], None))
    # 若机器开了代理/VPN 导致 TLS 握手被截断（SSLEOFError），尝试去代理直连国内镜像
    if any(os.environ.get(k) for k in PROXY_ENV_KEYS):
        no_proxy = env_without_proxy()
        for label, mirror in PYPI_MIRRORS:
            attempts.append((f"{label}(直连无代理)", [*base_cmd, "-i", mirror], no_proxy))
    attempts.append(("官方 PyPI", base_cmd, None))

    last_err: Exception | None = None
    for label, cmd, env in attempts:
        try:
            log("pip", f"trying {label}")
            run(cmd, env=env, stage="pip")
            return
        except Exception as exc:
            last_err = exc
            log("pip", f"{label} failed: {str(exc)[:240]}")
    assert last_err is not None
    raise last_err


def install_chromium_with_fallback(py: Path, browsers: Path) -> None:
    """安装 Playwright Chromium：优先尊重自定义镜像，默认先走国内镜像再兜底官方源。"""
    base_env = os.environ.copy()
    base_env["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers)
    base_env["PYTHONPATH"] = ""
    cmd = [str(py), "-m", "playwright", "install", "chromium"]

    attempts: list[tuple[str, dict[str, str]]] = []
    if base_env.get("PLAYWRIGHT_DOWNLOAD_HOST"):
        attempts.append(("自定义下载源", base_env))
    else:
        mirror_env = {**base_env, "PLAYWRIGHT_DOWNLOAD_HOST": "https://npmmirror.com/mirrors/playwright"}
        attempts.append(("国内镜像(npmmirror)", mirror_env))
        if any(os.environ.get(k) for k in PROXY_ENV_KEYS):
            attempts.append(("国内镜像(直连无代理)", env_without_proxy(mirror_env)))
        attempts.append(("官方下载源", base_env))

    last_err: Exception | None = None
    for label, env in attempts:
        try:
            log("chromium", f"trying {label}")
            run(cmd, env=env, stage="chromium")
            return
        except Exception as exc:
            last_err = exc
            log("chromium", f"{label} failed: {str(exc)[:240]}")
    assert last_err is not None
    raise last_err


def log(stage: str, msg: str):
    print(f"[publish-studio-runtime][{stage}] {msg}", flush=True)


def pick_bootstrap_python() -> str:
    override = os.environ.get("PUBLISH_STUDIO_BOOTSTRAP_PYTHON", "").strip()
    if override:
        return override
    candidates = [
        str(Path.home() / ".local/bin/python3.12"),
        str(Path.home() / ".local/bin/python3.11"),
        shutil.which("python3.12") or "",
        shutil.which("python3.11") or "",
        sys.executable,
    ]
    for c in candidates:
        if c and Path(c).exists():
            return c
    raise SystemExit("找不到可用的 Python 解释器（需要 3.9+），无法创建隔离运行时。未使用 sudo。")


def run(cmd, env=None, stage="exec"):
    log(stage, " ".join(cmd))
    p = subprocess.run(cmd, env=env, text=True, capture_output=True)
    if p.returncode != 0:
        err = (p.stderr or p.stdout or "").strip()[-800:]
        raise RuntimeError(f"命令失败({p.returncode}): {err}")
    return p


def probe(python: Path, browsers: Path) -> None:
    env = os.environ.copy()
    env["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers)
    env["PYTHONPATH"] = ""
    code = r"""
import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("about:blank")
    title = page.title()
    browser.close()
print("probe_ok", title)
"""
    p = subprocess.run([str(python), "-c", code], env=env, text=True, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout or "probe failed")[-800:])
    if "probe_ok" not in (p.stdout or ""):
        raise RuntimeError("探针未返回 probe_ok")


def already_ready() -> bool:
    st = load_status()
    py = venv_python()
    if not (st.get("ready") and py.exists() and st.get("browsersReady") and st.get("probeOk")):
        return False
    if st.get("pinnedPlaywright") != PINNED_PLAYWRIGHT:
        return False
    try:
        probe(py, browsers_path())
        return True
    except Exception:
        return False


def ensure(force: bool = False) -> dict:
    root = runtime_root()
    root.mkdir(parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    py = venv_python()
    browsers = browsers_path()

    if not force and already_ready():
        st = write_status({
            **load_status(),
            "ready": True,
            "phase": "ready",
            "message": "隔离运行时已就绪（幂等跳过）",
            "missing": [],
            "browsersReady": True,
            "probeOk": True,
            "updatedAt": int(time.time() * 1000),
        })
        log("skip", "already ready")
        return public_status()

    write_status({
        "ready": False,
        "phase": "installing",
        "message": "正在准备隔离 Python 与 Playwright Chromium…",
        "missing": [],
        "updatedAt": int(time.time() * 1000),
    })

    try:
        bootstrap = pick_bootstrap_python()
        log("python", f"bootstrap={bootstrap}")
        if force and (root / "venv").exists():
            log("venv", "force recreate")
            shutil.rmtree(root / "venv")
        if not py.exists():
            log("venv", f"create {root / 'venv'}")
            def create_venv(clear: bool):
                cmd = [bootstrap, "-m", "venv", str(root / "venv")]
                if clear:
                    cmd.append("--clear")
                run(cmd, stage="venv")
            try:
                create_venv(clear=False)
            except Exception as first:
                log("venv", f"retry with --clear after: {first}")
                if (root / "venv").exists():
                    shutil.rmtree(root / "venv", ignore_errors=True)
                create_venv(clear=True)
        if not py.exists():
            raise RuntimeError("venv 创建后仍找不到 python")

        log("pip", f"install -r {REQ.name} (pinned playwright=={PINNED_PLAYWRIGHT})")
        pip_install_requirements(py, REQ)

        # Verify pin
        chk = subprocess.run([str(py), "-c", "import importlib.metadata as m; print(m.version('playwright'))"], text=True, capture_output=True)
        ver = (chk.stdout or "").strip()
        if ver != PINNED_PLAYWRIGHT:
            raise RuntimeError(f"playwright 版本不符: got {ver}, want {PINNED_PLAYWRIGHT}")

        browsers.mkdir(parents=True, exist_ok=True)
        # Only chromium — not firefox/webkit
        log("chromium", f"PLAYWRIGHT_BROWSERS_PATH={browsers}")
        install_chromium_with_fallback(py, browsers)

        log("probe", "about:blank headless")
        probe(py, browsers)

        st = write_status({
            "ready": True,
            "phase": "ready",
            "message": "隔离运行时与 Chromium 探针通过",
            "missing": [],
            "browsersReady": True,
            "probeOk": True,
            "playwrightVersion": ver,
            "bootstrapPython": bootstrap,
            "updatedAt": int(time.time() * 1000),
        })
        log("done", st["message"])
        return public_status()
    except Exception as e:
        missing = []
        msg = str(e)
        low = msg.lower()
        if "playwright" in low and "pip" in low:
            missing.append("playwright")
        if "chromium" in low or "browser" in low or "executable doesn't exist" in low:
            missing.append("chromium")
        if "python" in low and "找不到" in msg:
            missing.append("python")
        if not missing:
            missing.append("runtime")
        st = write_status({
            "ready": False,
            "phase": "failed",
            "message": f"运行时安装失败：{msg[:500]}。未伪装成功，不会回退原GEO。",
            "missing": missing,
            "browsersReady": False,
            "probeOk": False,
            "updatedAt": int(time.time() * 1000),
        })
        log("failed", st["message"])
        print(json_public(st), flush=True)
        raise SystemExit(2)


def json_public(st):
    import json
    return json.dumps(public_status() if "ready" in st else st, ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--probe-only", action="store_true")
    args = ap.parse_args()
    if args.status:
        import json
        print(json.dumps(public_status(), ensure_ascii=False, indent=2))
        return 0 if public_status().get("ready") else 1
    if args.probe_only:
        py = venv_python()
        if not py.exists():
            print("missing venv python", file=sys.stderr)
            return 1
        probe(py, browsers_path())
        print("probe_ok")
        return 0
    ensure(force=args.force)
    import json
    print(json.dumps(public_status(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
