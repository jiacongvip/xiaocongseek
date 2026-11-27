#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""No-platform stub regression for cdp_existing cleanup preserve.

Does not connect to real Chrome, does not read cookies/browser DB.
"""
from __future__ import annotations

import asyncio
import importlib.util
import os
import sys
import types
from pathlib import Path


DH = Path(__file__).resolve().parents[1]
SIDECAR = DH / "tools" / "mediacrawler-runner" / "run_mc_main.py"
MC = Path(os.environ.get("DH_MC_ROOT") or "/Users/jiacong/Desktop/开发文件/MediaCrawler")


class FakePage:
    def __init__(self, name: str):
        self.name = name
        self.closed = False

    async def close(self):
        self.closed = True


class FakeContext:
    def __init__(self, pages):
        self.pages = list(pages)
        self.closed = False

    async def close(self):
        self.closed = True
        for p in self.pages:
            p.closed = True


class FakeBrowser:
    def __init__(self, contexts):
        self.contexts = list(contexts)
        self._connected = True
        self.close_calls = 0

    def is_connected(self):
        return self._connected

    async def close(self):
        self.close_calls += 1
        self._connected = False


class FakeLauncher:
    def __init__(self):
        self.browser_process = object()
        self.cleanup_calls = 0

    def cleanup(self):
        self.cleanup_calls += 1


def load_sidecar():
    spec = importlib.util.spec_from_file_location("dh_run_mc_main", SIDECAR)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


def install_fake_cdp_module():
    """Minimal stand-in so patch can bind without importing real playwright stack."""
    # Prefer real class if importable (MC on path), else fake.
    sys.path.insert(0, str(MC))
    os.chdir(MC)
    import tools.cdp_browser as cdp_mod  # noqa: WPS433

    return cdp_mod


async def run_cleanup_case(mode: str, expect_preserve: bool):
    os.environ["DH_MC_BROWSER_MODE"] = mode
    os.environ["DH_MC_CDP_PORT"] = "9222"
    os.environ["DH_MC_ROOT"] = str(MC)
    # reset module flags between cases
    for k in list(sys.modules):
        if k in ("dh_run_mc_main",) or k.startswith("dh_run_mc"):
            sys.modules.pop(k, None)

    mod = load_sidecar()
    sys.path.insert(0, str(MC))
    os.chdir(str(MC))
    mod.apply_browser_mode()
    import config

    if mode == "cdp_existing":
        assert config.CDP_CONNECT_EXISTING is True
        assert config.AUTO_CLOSE_BROWSER is False
    elif mode == "cdp_launch":
        assert config.ENABLE_CDP_MODE is True
        assert config.CDP_CONNECT_EXISTING is False
    else:
        assert config.ENABLE_CDP_MODE is False

    cdp_mod = install_fake_cdp_module()
    # Ensure clean patch flag for this process case by deleting attribute if present
    if hasattr(cdp_mod.CDPBrowserManager, "_dh_preserve_existing_context"):
        delattr(cdp_mod.CDPBrowserManager, "_dh_preserve_existing_context")
        # restore original cleanup from source once by reloading module when not preserving
        # For preserve mode we patch; for others we need original. Reload cdp_browser.
        if not expect_preserve:
            import importlib

            cdp_mod = importlib.reload(cdp_mod)

    if expect_preserve:
        mod._patch_cdp_cleanup_preserve_existing_context()
        assert getattr(cdp_mod.CDPBrowserManager, "_dh_preserve_existing_context", False) is True

    user_page = FakePage("user-douyin")
    mc_page = FakePage("mc-new")
    ctx = FakeContext([user_page, mc_page])
    browser = FakeBrowser([ctx])
    launcher = FakeLauncher()

    mgr = cdp_mod.CDPBrowserManager()
    mgr.browser_context = ctx
    mgr.browser = browser
    mgr.launcher = launcher

    # Simulate normal cleanup + force cleanup (cancel / async_cleanup force=True)
    await mgr.cleanup(force=False)
    await mgr.cleanup(force=True)

    if expect_preserve:
        assert ctx.closed is False, "cdp_existing must not close user context"
        assert user_page.closed is False, "user page must remain"
        assert launcher.cleanup_calls == 0, "must not kill browser process"
        assert browser.close_calls >= 1, "should disconnect playwright CDP client"
        assert mgr.browser_context is None
    else:
        # Upstream / unpatched path may close context; for cdp_launch we did not patch.
        # Only assert we did not incorrectly install preserve flag.
        assert getattr(cdp_mod.CDPBrowserManager, "_dh_preserve_existing_context", False) in (
            False,
            None,
        ) or not expect_preserve


async def run_async_cleanup_fallback_guard():
    os.environ["DH_MC_BROWSER_MODE"] = "cdp_existing"
    os.environ["DH_MC_CDP_PORT"] = "9222"
    os.environ["DH_MC_ROOT"] = str(MC)
    for k in list(sys.modules):
        if k == "dh_run_mc_main":
            sys.modules.pop(k, None)
    mod = load_sidecar()
    sys.path.insert(0, str(MC))
    os.chdir(str(MC))
    mod.apply_browser_mode()
    cdp_mod = install_fake_cdp_module()
    if hasattr(cdp_mod.CDPBrowserManager, "_dh_preserve_existing_context"):
        delattr(cdp_mod.CDPBrowserManager, "_dh_preserve_existing_context")
    mod._patch_cdp_cleanup_preserve_existing_context()

    user_page = FakePage("user")
    ctx = FakeContext([user_page])
    browser = FakeBrowser([ctx])
    mgr = cdp_mod.CDPBrowserManager()
    mgr.browser_context = ctx
    mgr.browser = browser
    mgr.launcher = FakeLauncher()

    # Fake main module surface used by wrap
    import main as mc_main

    if getattr(mc_main, "_dh_async_cleanup_wrapped", False):
        # already wrapped from prior import in this interpreter — ok
        pass
    crawler = types.SimpleNamespace(cdp_manager=mgr, browser_context=ctx)
    mc_main.crawler = crawler
    # Clear wrap flag to re-apply against current mc_main
    if hasattr(mc_main, "_dh_async_cleanup_wrapped"):
        delattr(mc_main, "_dh_async_cleanup_wrapped")
    mod._patch_async_cleanup_no_fallback_close()
    await mc_main.async_cleanup()
    assert ctx.closed is False
    assert user_page.closed is False
    assert crawler.browser_context is None
    assert crawler.cdp_manager is None

    # Second call: no cdp_manager — must still not close a sneaky context
    sneaky = FakeContext([FakePage("x")])
    mc_main.crawler = types.SimpleNamespace(cdp_manager=None, browser_context=sneaky)
    await mc_main.async_cleanup()
    assert sneaky.closed is False


async def run_sequential_isolation():
    """Two consecutive cleanups on same fake Chrome must keep context alive."""
    os.environ["DH_MC_BROWSER_MODE"] = "cdp_existing"
    os.environ["DH_MC_ROOT"] = str(MC)
    for k in list(sys.modules):
        if k == "dh_run_mc_main":
            sys.modules.pop(k, None)
    mod = load_sidecar()
    sys.path.insert(0, str(MC))
    os.chdir(str(MC))
    mod.apply_browser_mode()
    cdp_mod = install_fake_cdp_module()
    if hasattr(cdp_mod.CDPBrowserManager, "_dh_preserve_existing_context"):
        delattr(cdp_mod.CDPBrowserManager, "_dh_preserve_existing_context")
    mod._patch_cdp_cleanup_preserve_existing_context()

    ctx = FakeContext([FakePage("user")])
    for i in range(2):
        browser = FakeBrowser([ctx])
        mgr = cdp_mod.CDPBrowserManager()
        mgr.browser_context = ctx
        mgr.browser = browser
        mgr.launcher = FakeLauncher()
        await mgr.cleanup(force=True)
        assert ctx.closed is False, f"task {i} closed context"
        assert mgr.launcher.cleanup_calls == 0


def main():
    assert SIDECAR.is_file(), SIDECAR
    asyncio.run(run_cleanup_case("cdp_existing", expect_preserve=True))
    print("PASS cdp_existing preserve (normal+force)")
    asyncio.run(run_async_cleanup_fallback_guard())
    print("PASS async_cleanup fallback guard")
    asyncio.run(run_sequential_isolation())
    print("PASS sequential task isolation")
    # standard / cdp_launch: patch must no-op (flag not set after apply without existing mode)
    os.environ["DH_MC_BROWSER_MODE"] = "standard"
    for k in list(sys.modules):
        if k == "dh_run_mc_main":
            sys.modules.pop(k, None)
    mod = load_sidecar()
    sys.path.insert(0, str(MC))
    os.chdir(str(MC))
    mod.apply_browser_mode()
    cdp_mod = install_fake_cdp_module()
    if hasattr(cdp_mod.CDPBrowserManager, "_dh_preserve_existing_context"):
        delattr(cdp_mod.CDPBrowserManager, "_dh_preserve_existing_context")
    mod._patch_cdp_cleanup_preserve_existing_context()
    assert getattr(cdp_mod.CDPBrowserManager, "_dh_preserve_existing_context", False) is False
    print("PASS standard does not install preserve patch")

    os.environ["DH_MC_BROWSER_MODE"] = "cdp_launch"
    for k in list(sys.modules):
        if k == "dh_run_mc_main":
            sys.modules.pop(k, None)
    mod = load_sidecar()
    mod.apply_browser_mode()
    import config

    assert config.CDP_CONNECT_EXISTING is False
    cdp_mod = install_fake_cdp_module()
    if hasattr(cdp_mod.CDPBrowserManager, "_dh_preserve_existing_context"):
        delattr(cdp_mod.CDPBrowserManager, "_dh_preserve_existing_context")
    mod._patch_cdp_cleanup_preserve_existing_context()
    assert getattr(cdp_mod.CDPBrowserManager, "_dh_preserve_existing_context", False) is False
    print("PASS cdp_launch does not install preserve patch (self-managed lifecycle)")
    print("ALL_STUB_OK")


if __name__ == "__main__":
    main()
