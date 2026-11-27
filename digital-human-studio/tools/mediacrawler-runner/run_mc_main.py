#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Plugin-controlled MediaCrawler entry (sidecar).

Runs official MC main entry after applying *process-scoped* overrides via `config`.
Does NOT edit MediaCrawler config/base_config.py, does NOT expand CDP ports,
does NOT read publish-studio cookies, does NOT put cookie values on argv.

Original MC login reuse (same as main.py --lt cookie):
  process-scoped config.COOKIES from MediaCrawler/.douyin_cookies.txt when platform=dy.
  Playwright still uses browser_data/<platform>_user_data_dir (SAVE_LOGIN_STATE).

Env (set by digital-human-studio adapter):
  DH_MC_BROWSER_MODE=standard|cdp_existing|cdp_launch
  DH_MC_CDP_PORT=9222   (only used when CDP mode; must match already-open debug port)
  DH_MC_ROOT=<mc root>  (optional; default=cwd)

Argv after this script are forwarded as MediaCrawler CLI args (same as main.py).
"""
from __future__ import annotations

import os
import sys


def _mc_root() -> str:
    root = (os.environ.get("DH_MC_ROOT") or "").strip() or os.getcwd()
    return os.path.abspath(root)


def _mode_is_cdp_existing() -> bool:
    mode = (os.environ.get("DH_MC_BROWSER_MODE") or "standard").strip().lower()
    return mode in ("cdp_existing", "cdp", "connect_existing", "existing")


# Original MC cookie files live in the project root. Never read publish-studio cookie dirs.
SAVED_COOKIE_FILES = {"dy": ".douyin_cookies.txt"}
SAVED_COOKIE_MAX_BYTES = 100_000


def saved_cookie_path(mc_root: str, platform: str) -> str | None:
    name = SAVED_COOKIE_FILES.get(str(platform or "").strip().lower())
    if not name:
        return None
    root = os.path.abspath(mc_root)
    path = os.path.abspath(os.path.join(root, name))
    if os.path.dirname(path) != root or not os.path.isfile(path):
        return None
    return path


def read_saved_cookie_header(path: str, max_bytes: int = SAVED_COOKIE_MAX_BYTES) -> str:
    size = os.path.getsize(path)
    if size <= 0 or size > max_bytes:
        return ""
    with open(path, encoding="utf-8") as fh:
        text = fh.read().strip()
    if "=" not in text:
        return ""
    return text


def apply_saved_platform_login() -> str:
    """Match original `--lt cookie`: inject MC's own saved cookies, never argv.

    Chrome-exported Douyin cookies often have sessionid/sid_tt without LOGIN_STATUS.
    Original login_by_cookies injects them and sets HasUserLogin. QR is not required.
    """
    import config

    platform = str(getattr(config, "PLATFORM", "") or "").strip().lower()
    path = saved_cookie_path(_mc_root(), platform)
    if not path:
        return "none"
    raw = read_saved_cookie_header(path)
    if not raw:
        print("[dh-mc-runner] saved cookie file present but empty/invalid; leaving login type unchanged", flush=True)
        return "none"
    config.LOGIN_TYPE = "cookie"
    config.COOKIES = raw
    # Cookie login skips the QR panel (original warns that panel hangs headless).
    # Keep Playwright for a_bogus signing, but do not open a visible window.
    config.HEADLESS = True
    config.CDP_HEADLESS = True
    print(
        "[dh-mc-runner] using original MediaCrawler saved cookie login (%s); headless; cookie values not printed"
        % os.path.basename(path),
        flush=True,
    )
    return "cookie"


def apply_browser_mode() -> str:
    import config  # MediaCrawler config package (cwd / DH_MC_ROOT on sys.path)

    mode = (os.environ.get("DH_MC_BROWSER_MODE") or "standard").strip().lower()
    port_raw = (os.environ.get("DH_MC_CDP_PORT") or "9222").strip()
    try:
        port = int(port_raw)
    except ValueError:
        port = 9222
    # Never invent a new debug port; only use the configured/existing one.
    if port <= 0 or port > 65535:
        port = 9222

    if mode in ("cdp_existing", "cdp", "connect_existing", "existing"):
        config.ENABLE_CDP_MODE = True
        config.CDP_CONNECT_EXISTING = True
        config.CDP_DEBUG_PORT = port
        config.CDP_HEADLESS = False
        # Existing browser: MC cleanup already skips killing the process when
        # CDP_CONNECT_EXISTING; keep AUTO_CLOSE_BROWSER False as extra safety.
        config.AUTO_CLOSE_BROWSER = False
        mode_norm = "cdp_existing"
    elif mode in ("cdp_launch", "cdp_new", "launch"):
        config.ENABLE_CDP_MODE = True
        config.CDP_CONNECT_EXISTING = False
        config.CDP_DEBUG_PORT = port
        config.CDP_HEADLESS = False
        mode_norm = "cdp_launch"
    else:
        # standard / playwright persistent — force CDP off for this process.
        # Original WebUI passes --headless true on this Mac (no DISPLAY).
        # Workbench refresh must not open a visible Playwright window.
        config.ENABLE_CDP_MODE = False
        config.CDP_CONNECT_EXISTING = False
        config.HEADLESS = True
        config.CDP_HEADLESS = True
        mode_norm = "standard"

    print(
        "[dh-mc-runner] browser_mode=%s ENABLE_CDP_MODE=%s CDP_CONNECT_EXISTING=%s "
        "CDP_DEBUG_PORT=%s AUTO_CLOSE_BROWSER=%s HEADLESS=%s"
        % (
            mode_norm,
            getattr(config, "ENABLE_CDP_MODE", None),
            getattr(config, "CDP_CONNECT_EXISTING", None),
            getattr(config, "CDP_DEBUG_PORT", None),
            getattr(config, "AUTO_CLOSE_BROWSER", None),
            getattr(config, "HEADLESS", None),
        ),
        flush=True,
    )
    return mode_norm


def _patch_cdp_cleanup_preserve_existing_context() -> None:
    """Process-scoped: do not close the user's BrowserContext when attached to an
    already-open Chrome (CDP_CONNECT_EXISTING / browserMode=cdp_existing).

    Upstream close paths (read-only inventory; MC sources untouched):
      1) tools/cdp_browser.py CDPBrowserManager.cleanup → browser_context.close()
         + browser.close() + skip process kill when CONNECT_EXISTING
      2) media_platform/*/core.py close() → cdp_manager.cleanup() if set,
         else browser_context.close()
      3) main.async_cleanup → cdp_manager.cleanup(force=True) if set,
         else browser_context.close()
      4) main._force_stop → launcher.cleanup() kill process — NOT wired by this
         sidecar (on_first_interrupt=None)
    Patching (1) covers (2)(3) while cdp_manager remains set. We also wrap
    async_cleanup so after cdp_manager is cleared we never fall through to (3)'s
    else browser_context.close() on the shared user context.
    """
    if not _mode_is_cdp_existing():
        return
    try:
        import tools.cdp_browser as cdp_mod
    except Exception as e:
        print(
            "[dh-mc-runner] skip context-preserve patch (import tools.cdp_browser failed: %s)"
            % e,
            flush=True,
        )
        return

    mgr_cls = getattr(cdp_mod, "CDPBrowserManager", None)
    if mgr_cls is None or getattr(mgr_cls, "_dh_preserve_existing_context", False):
        return

    async def cleanup(self, force: bool = False):  # noqa: ARG001 — match MC signature
        import config
        from tools import utils

        # Drop local reference only — do NOT close the shared user context/pages.
        self.browser_context = None
        if self.browser:
            try:
                if self.browser.is_connected():
                    await self.browser.close()
                    utils.logger.info(
                        "[CDPBrowserManager] Browser connection disconnected"
                    )
            except Exception as browser_error:
                error_msg = str(browser_error).lower()
                if "closed" not in error_msg and "disconnected" not in error_msg:
                    utils.logger.warning(
                        "[CDPBrowserManager] Failed to close browser connection: %s"
                        % browser_error
                    )
            finally:
                self.browser = None
        # Existing Chrome: never kill the process (same as upstream branch).
        if getattr(config, "CDP_CONNECT_EXISTING", False):
            utils.logger.info(
                "[CDPBrowserManager] Connected to existing browser, skipping process cleanup"
            )
            print(
                "[dh-mc-runner] preserved existing Chrome context/pages "
                "(skipped browser_context.close on cdp_existing)",
                flush=True,
            )
            # Defense: never call launcher.cleanup even if force=True.
            return
        if force or getattr(config, "AUTO_CLOSE_BROWSER", False):
            if self.launcher and getattr(self.launcher, "browser_process", None):
                self.launcher.cleanup()

    mgr_cls.cleanup = cleanup  # type: ignore[method-assign]
    mgr_cls._dh_preserve_existing_context = True  # type: ignore[attr-defined]
    print(
        "[dh-mc-runner] patched CDPBrowserManager.cleanup to preserve existing context",
        flush=True,
    )


def _patch_async_cleanup_no_fallback_close() -> None:
    """Prevent main.async_cleanup else-branch from closing user context after
    cdp_manager was nulled by DouYinCrawler.close / prior cleanup."""
    if not _mode_is_cdp_existing():
        return
    try:
        import main as mc_main
    except Exception as e:
        print(
            "[dh-mc-runner] skip async_cleanup wrap (import main failed: %s)" % e,
            flush=True,
        )
        return
    if getattr(mc_main, "_dh_async_cleanup_wrapped", False):
        return
    orig = mc_main.async_cleanup

    async def async_cleanup() -> None:
        crawler = getattr(mc_main, "crawler", None)
        if crawler is not None and getattr(crawler, "cdp_manager", None):
            try:
                await crawler.cdp_manager.cleanup(force=True)
            except Exception as e:
                error_msg = str(e).lower()
                if "closed" not in error_msg and "disconnected" not in error_msg:
                    print("[Main] Error cleaning up CDP browser: %s" % e)
            # Clear refs so we never browser_context.close() the shared profile.
            try:
                crawler.cdp_manager = None
            except Exception:
                pass
            try:
                crawler.browser_context = None
            except Exception:
                pass
            print(
                "[dh-mc-runner] async_cleanup preserved existing Chrome "
                "(no fallback browser_context.close)",
                flush=True,
            )
            return
        # No cdp_manager: still avoid closing a lingering shared context in this mode.
        if crawler is not None:
            try:
                crawler.browser_context = None
            except Exception:
                pass
            print(
                "[dh-mc-runner] async_cleanup cdp_existing with no cdp_manager; "
                "skipped browser_context.close",
                flush=True,
            )
            return
        await orig()

    mc_main.async_cleanup = async_cleanup  # type: ignore[assignment]
    mc_main._dh_async_cleanup_wrapped = True  # type: ignore[attr-defined]
    print(
        "[dh-mc-runner] wrapped main.async_cleanup for cdp_existing preserve",
        flush=True,
    )


def main() -> int:
    root = _mc_root()
    if root not in sys.path:
        sys.path.insert(0, root)
    os.chdir(root)

    main_py = os.path.join(root, "main.py")
    if not os.path.isfile(main_py):
        print("[dh-mc-runner] main.py missing under %s" % root, file=sys.stderr, flush=True)
        return 32

    apply_browser_mode()
    _patch_cdp_cleanup_preserve_existing_context()

    import cmd_arg

    _orig_parse = cmd_arg.parse_cmd

    async def _parse_then_reapply(*args, **kwargs):
        result = await _orig_parse(*args, **kwargs)
        # CLI parse overwrites HEADLESS from base_config False; re-apply so
        # standard mode stays headless and CDP flags stay process-scoped.
        apply_browser_mode()
        # After --lt qrcode parse: original cookie login if MC saved a cookie file.
        apply_saved_platform_login()
        return result

    cmd_arg.parse_cmd = _parse_then_reapply  # type: ignore

    # Forward remaining argv as if invoking main.py
    sys.argv = [main_py, *sys.argv[1:]]

    import main as mc_main
    from tools.app_runner import run

    # Wrap after main is importable (needs config/cmd already on path).
    _patch_async_cleanup_no_fallback_close()

    run(
        mc_main.main,
        mc_main.async_cleanup,
        cleanup_timeout_seconds=15.0,
        # Do NOT wire MC's _force_stop (launcher.cleanup kills process).
        on_first_interrupt=None,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit as e:
        raise
