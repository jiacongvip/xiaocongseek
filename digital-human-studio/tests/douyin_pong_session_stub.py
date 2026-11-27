#!/usr/bin/env python3
"""Saved-cookie login helpers: original MC file only, never print cookie values."""
from __future__ import annotations

import importlib.util
import os
import tempfile
from pathlib import Path

DH = Path(__file__).resolve().parents[1]
SIDECAR = DH / "tools" / "mediacrawler-runner" / "run_mc_main.py"


def load_sidecar():
    spec = importlib.util.spec_from_file_location("dh_run_mc_main", SIDECAR)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    mod = load_sidecar()
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        assert mod.saved_cookie_path(str(root), "dy") is None
        assert mod.saved_cookie_path(str(root), "xhs") is None
        (root / ".douyin_cookies.txt").write_text("sessionid=abc; sid_tt=def\n", encoding="utf-8")
        (root / "evil.txt").write_text("sessionid=nope\n", encoding="utf-8")
        path = mod.saved_cookie_path(str(root), "dy")
        assert path == str(root / ".douyin_cookies.txt")
        assert mod.saved_cookie_path(str(root), "xhs") is None
        # Refuse path escape: only the exact filename in MC root.
        assert os.path.dirname(path) == str(root)
        header = mod.read_saved_cookie_header(path)
        assert "sessionid=" in header
        assert "sid_tt=" in header
        # Empty / non-cookie files are ignored
        (root / ".douyin_cookies.txt").write_text("not-a-cookie-header\n", encoding="utf-8")
        assert mod.read_saved_cookie_header(str(root / ".douyin_cookies.txt")) == ""

        (root / ".douyin_cookies.txt").write_text("sessionid=abc; sid_tt=def\n", encoding="utf-8")
        import sys
        import types
        fake = types.ModuleType("config")
        fake.PLATFORM = "dy"
        fake.LOGIN_TYPE = "qrcode"
        fake.COOKIES = ""
        fake.HEADLESS = False
        fake.CDP_HEADLESS = False
        sys.modules["config"] = fake
        os.environ["DH_MC_ROOT"] = str(root)
        assert mod.apply_saved_platform_login() == "cookie"
        assert fake.LOGIN_TYPE == "cookie"
        assert fake.HEADLESS is True
        assert fake.CDP_HEADLESS is True
        assert bool(fake.COOKIES)
        fake.COOKIES = ""

        headed = types.ModuleType("config")
        headed.ENABLE_CDP_MODE = True
        headed.CDP_CONNECT_EXISTING = True
        headed.CDP_DEBUG_PORT = 1
        headed.HEADLESS = False
        headed.CDP_HEADLESS = False
        headed.AUTO_CLOSE_BROWSER = True
        sys.modules["config"] = headed
        os.environ["DH_MC_BROWSER_MODE"] = "standard"
        assert mod.apply_browser_mode() == "standard"
        assert headed.HEADLESS is True
        assert headed.CDP_HEADLESS is True
        assert headed.ENABLE_CDP_MODE is False
        os.environ.pop("DH_MC_BROWSER_MODE", None)
    print("PASS saved cookie path is original MC .douyin_cookies.txt only")


if __name__ == "__main__":
    main()
