import asyncio
import configparser
import os
import shutil
import tempfile
from datetime import datetime

from playwright.async_api import async_playwright
from conf import BASE_DIR, LOCAL_CHROME_PATH
from utils.account_runtime import build_playwright_proxy, get_account_runtime_by_file_path
from utils.base_social_media import set_init_script
from utils.log import create_logger
from utils.wechat_official import is_wechat_official_api_account_file, validate_wechat_official_credentials
from pathlib import Path
from newFileUpload.platform_configs import PLATFORM_CONFIGS

async def check_cookie(type, file_path):
    """
    根据平台类型验证Cookie有效性
    Args:
        type: 平台类型 (1:小红书, 2:腾讯视频号, 3:抖音, 4:快手, 5:TikTok, 6:Instagram, 7:Facebook, 8:Bilibili, 9:Baijiahao)
        file_path: Cookie文件路径
    Returns:
        bool: Cookie是否有效
    """
    result = await check_cookie_status(type, file_path)
    return bool(result.get("valid"))


async def check_cookie_status(type, file_path):
    return await check_cookie_generic_detailed(type, file_path)


def build_account_check_result(valid, reason="ok", detail=""):
    return {
        "valid": bool(valid),
        "reason": str(reason or ("ok" if valid else "unknown_error")),
        "detail": str(detail or "").strip(),
        "checked_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def classify_account_check_exception(error):
    message = str(error or "").strip()
    lowered = message.lower()

    if not message:
        return "unknown_error", "账号校验失败，请稍后重试"

    if any(keyword in lowered for keyword in [
        "timeout",
        "timed out",
        "err_",
        "econn",
        "dns",
        "proxy",
        "tunnel",
        "certificate",
        "ssl",
        "network",
        "connection",
        "closed",
        "refused",
    ]):
        return "network_error", f"网络或代理异常：{message[:180]}"

    if any(keyword in lowered for keyword in [
        "no such file",
        "not found",
        "does not exist",
        "json",
        "decode",
        "storage state",
        "cookie",
    ]):
        return "config_error", f"账号配置异常：{message[:180]}"

    return "unknown_error", f"账号校验失败：{message[:180]}"


def resolve_cookie_storage_path(file_path):
    path = Path(file_path)
    if path.is_absolute():
        return path
    return Path(BASE_DIR / "cookiesFile" / file_path)


def clone_profile_for_validation(profile_path):
    temp_dir = Path(tempfile.mkdtemp(prefix=f"{profile_path.name}_auth_", dir="/tmp"))
    ignore = shutil.ignore_patterns(
        "SingletonLock",
        "SingletonSocket",
        "SingletonCookie",
        "DevToolsActivePort",
        "RunningChromeVersion",
        "lockfile",
        ".org.chromium.Chromium.*",
    )
    shutil.copytree(profile_path, temp_dir, dirs_exist_ok=True, ignore=ignore)
    return temp_dir


async def has_visible_selector(page, selectors):
    for selector in selectors:
        locator = page.locator(selector).first
        try:
            if await locator.count() > 0 and await locator.is_visible():
                return True
        except Exception:
            continue
    return False


def get_platform_auth_cookie_names(platform_config):
    return {
        str(name or "").strip()
        for name in (platform_config.get("auth_cookie_names") or [])
        if str(name or "").strip()
    }


def has_platform_auth_cookies(cookies, platform_config):
    auth_cookie_names = get_platform_auth_cookie_names(platform_config)
    if not auth_cookie_names:
        return False
    cookie_names = {str(item.get("name") or "").strip() for item in cookies}
    return bool(cookie_names & auth_cookie_names)


async def has_qianwen_user_state(page):
    try:
        return await page.evaluate(
            """() => {
                const user = window._USER_ || {};
                return Boolean(
                    (user.userId && String(user.userId).trim()) ||
                    (user.aliyunUid && String(user.aliyunUid).trim()) ||
                    (user.showName && String(user.showName).trim())
                );
            }"""
        )
    except Exception:
        return False


async def has_yuanbao_user_state(page):
    try:
        return await page.evaluate(
            """() => {
                const currentUrl = location.href || '';
                const currentPath = location.pathname || '';
                const bodyText = document.body?.innerText || '';
                const clickableNodes = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                const hasLoginButton = clickableNodes.some((node) => {
                    const text = (node.innerText || node.textContent || '').trim();
                    return /^(Log In|登录)$/.test(text);
                });
                const isScanPage = /^\\/scan(?:\\/|$)/i.test(currentPath) || /\\/scan(?:\\?|$)/i.test(currentUrl);
                const hasNotLoggedText = /Not logged in|未登录/i.test(bodyText);
                const hasLoginDialog = /Login with WeChat QR Code|微信扫码登录|Create Now/.test(bodyText);
                return !isScanPage && !hasLoginButton && !hasNotLoggedText && !hasLoginDialog;
            }"""
        )
    except Exception:
        return False


async def has_yiyan_user_state(page):
    try:
        return await page.evaluate(
            """() => {
                const isVisible = (node) => {
                    if (!node) return false;
                    const style = window.getComputedStyle(node);
                    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
                    const rect = node.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                };
                const currentUrl = location.href || '';
                const bodyText = document.body?.innerText || '';
                const hasInput = Array.from(
                    document.querySelectorAll('textarea, div[role="textbox"][contenteditable="true"], div[contenteditable="true"]')
                ).some(isVisible);
                const clickableNodes = Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(isVisible);
                const hasLoginButton = clickableNodes.some((node) => {
                    const text = (node.innerText || node.textContent || '').trim();
                    return /^(登录|请登录|立即登录)$/.test(text);
                });
                const isLoginRoute = /passport\\.baidu\\.com/i.test(currentUrl) || /\\/login(?:\\/|\\?|$)/i.test(currentUrl);
                const hasLoginDialog = /请登录|登录同步历史对话|扫码登录|百度账号登录|短信登录|密码登录/i.test(bodyText);
                return hasInput && !hasLoginButton && !isLoginRoute && !hasLoginDialog;
            }"""
        )
    except Exception:
        return False


async def has_kimi_user_state(page):
    try:
        return await page.evaluate(
            """() => {
                const isVisible = (node) => {
                    if (!node) return false;
                    const style = window.getComputedStyle(node);
                    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
                    const rect = node.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                };
                const currentUrl = location.href || '';
                const bodyText = document.body?.innerText || '';
                const hasInput = Array.from(
                    document.querySelectorAll('textarea, div[role="textbox"][contenteditable="true"], div[contenteditable="true"]')
                ).some(isVisible);
                const clickableNodes = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                const hasLoginButton = clickableNodes.some((node) => {
                    const text = (node.innerText || node.textContent || '').trim();
                    return /^(登录|立即登录|扫码登录|微信扫码登录|手机号登录|手机号快捷登录|验证码登录|发送验证码|Continue|Sign in|Log in)$/i.test(text);
                });
                const isLoginRoute = /\\/login(?:\\/|\\?|$)/i.test(currentUrl) || /auth/i.test(currentUrl);
                const hasLoginDialog = /扫码登录|微信扫码登录|手机号登录|手机号快捷登录|验证码登录|发送验证码|继续使用手机号|登录后继续|登录以同步历史会话|已阅读同意|模型服务协议|用户隐私协议/i.test(bodyText);
                return hasInput && !hasLoginButton && !isLoginRoute && !hasLoginDialog;
            }"""
        )
    except Exception:
        return False


async def has_deepseek_user_state(page):
    try:
        return await page.evaluate(
            """() => {
                const isVisible = (node) => {
                    if (!node) return false;
                    const style = window.getComputedStyle(node);
                    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
                    const rect = node.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                };
                const currentUrl = location.href || '';
                const bodyText = document.body?.innerText || '';
                const hasInput = Array.from(
                    document.querySelectorAll('textarea, div[role="textbox"][contenteditable="true"], div[contenteditable="true"]')
                ).some(isVisible);
                const clickableNodes = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                const hasLoginButton = clickableNodes.some((node) => {
                    const text = (node.innerText || node.textContent || '').trim();
                    return /^(登录|立即登录|扫码登录|微信扫码登录|手机号登录|手机号快捷登录|验证码登录|发送验证码|Continue|Sign in|Log in)$/i.test(text);
                });
                const isLoginRoute = /\\/login(?:\\/|\\?|$)/i.test(currentUrl) || /auth/i.test(currentUrl);
                const hasLoginDialog = /扫码登录|微信扫码登录|手机号登录|手机号快捷登录|验证码登录|发送验证码|登录后继续|登录后使用更多功能|模型服务协议|用户协议|隐私政策/i.test(bodyText);
                return hasInput && !hasLoginButton && !isLoginRoute && !hasLoginDialog;
            }"""
        )
    except Exception:
        return False


async def has_zhipu_user_state(page):
    try:
        return await page.evaluate(
            """() => {
                const isVisible = (node) => {
                    if (!node) return false;
                    const style = window.getComputedStyle(node);
                    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
                    const rect = node.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                };
                const currentUrl = location.href || '';
                const hasInput = Array.from(
                    document.querySelectorAll('textarea, div[role="textbox"][contenteditable="true"], div[contenteditable="true"]')
                ).some(isVisible);
                const isLoginRoute = /\\/login(?:\\/|\\?|$)/i.test(currentUrl) || /auth|passport|signin/i.test(currentUrl);
                return hasInput && !isLoginRoute;
            }"""
        )
    except Exception:
        return False


async def has_platform_user_state(page, platform_name):
    if platform_name == "qianwen":
        return await has_qianwen_user_state(page)
    if platform_name == "yuanbao":
        return await has_yuanbao_user_state(page)
    if platform_name == "yiyan":
        return await has_yiyan_user_state(page)
    if platform_name == "kimi":
        return await has_kimi_user_state(page)
    if platform_name == "deepseek":
        return await has_deepseek_user_state(page)
    if platform_name == "zhipu":
        return await has_zhipu_user_state(page)
    return False


async def check_cookie_generic_detailed(type, file_path):
    """
    通用的Cookie有效性验证方法
    Args:
        type: 平台类型 (1:小红书, 2:腾讯视频号, 3:抖音, 4:快手, 5:TikTok, 6:Instagram, 7:Facebook, 8:Bilibili, 9:Baijiahao)
        file_path: Cookie文件路径
    Returns:
        bool: Cookie是否有效
    """
    # 根据类型获取平台配置
    platform_config = None
    for config in PLATFORM_CONFIGS.values():
        if config.get("type") == type:
            platform_config = config
            break

    if not platform_config:
        return build_account_check_result(False, "config_error", "平台配置不存在")

    platform_name = platform_config.get("platform_name", "unknown")
    personal_url = platform_config.get("personal_url", "")
    logger = create_logger (platform_name, f'logs/{platform_name}.log')
    #logger.info(f"开始检测平台 {platform_name} 的账号有效性")
    if not personal_url:
        logger.error(f"平台 {platform_name} 未配置 personal_url")
        return build_account_check_result(False, "config_error", f"{platform_name} 未配置个人中心地址")

    resolved_storage_path = resolve_cookie_storage_path(file_path)
    runtime = get_account_runtime_by_file_path(file_path)
    proxy_config = build_playwright_proxy(runtime.get("proxy")) if runtime else None

    if platform_name == "wechat_official" and is_wechat_official_api_account_file(resolved_storage_path):
        is_valid, result = validate_wechat_official_credentials(file_path)
        if is_valid:
            logger.success(f"[{platform_name}] API 账号有效")
            return build_account_check_result(True, "ok", "API 授权状态正常")
        logger.error(f"[{platform_name}] API 账号无效: {result.get('errmsg', '未知错误')}")
        return build_account_check_result(False, "token_invalid", result.get("errmsg", "API 授权信息失效"))

    # 使用Playwright检测账号有效性
    temp_profile_dir = None
    browser = None
    context = None
    try:
        async def close_runtime():
            nonlocal browser, context
            if context:
                try:
                    await context.close()
                except Exception:
                    pass
                context = None
            if browser:
                try:
                    await browser.close()
                except Exception:
                    pass
                browser = None

        async with async_playwright() as playwright:
            if resolved_storage_path.is_dir():
                temp_profile_dir = clone_profile_for_validation(resolved_storage_path)
                context = await playwright.chromium.launch_persistent_context(
                    str(temp_profile_dir),
                    headless=True,
                    executable_path=LOCAL_CHROME_PATH,
                    args=[
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--ignore-certificate-errors",
                    ],
                    locale=platform_config.get("features", {}).get("browser_lang", "en-US"),
                    no_viewport=True,
                    proxy=proxy_config,
                )
            else:
                browser = await playwright.chromium.launch(
                    headless=True,
                    executable_path=LOCAL_CHROME_PATH,
                    args=[
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--ignore-certificate-errors",
                    ],
                    proxy=proxy_config,
                )
                context = await browser.new_context(
                    storage_state=str(resolved_storage_path),
                    ignore_https_errors=True,
                    locale=platform_config.get("features", {}).get("browser_lang", "en-US"),
                )

            if platform_config.get("features", {}).get("stealth", True):
                context = await set_init_script(context)

            # 创建一个新的页面
            page = context.pages[0] if context.pages else await context.new_page()

            # 访问个人中心页面
            await page.goto(personal_url, wait_until='domcontentloaded', timeout=60000)
            await asyncio.sleep(2)

            # 检查是否跳转到登录页面
            current_url = page.url
            #logger.info(f"[+]Current URL: {current_url}")

            # 1.检查url是否包含登录相关的关键词
            login_keywords = ["login", "signin", "sign_in", "sign-in", "auth", "登录", "登录页", "登录页面", "foryou"]
            is_login_page = any(keyword in current_url.lower() for keyword in login_keywords)

            if is_login_page:
                logger.error(f"[{platform_name}] 账号未登录，URL跳转到了登录页面")
                await close_runtime()
                return build_account_check_result(False, "login_expired", "登录态已过期，请重新登录")

            # 根据不同平台的特征元素进行检查
            # 2.检查页面内容是否包含登录相关的文本（douyin特征，就算没登录也可以到个人中心url）
            if platform_name in ["douyin", "jianshu"]:
                try:
                    content = await page.content()
                    login_texts = ["登录", "Sign in", "Log in", "登录/注册", "扫码登录"]
                    if platform_name == "jianshu":
                        login_texts.extend(["登录 · 注册", "社交帐号登录", "登录遇到问题?", "记住我"])
                    for text in login_texts:
                        if text in content:
                            logger.error(f"[{platform_name}] 页面包含登录文本: {text}")
                            await close_runtime()
                            return build_account_check_result(False, "login_expired", "页面出现登录提示，账号登录态已失效")
                except Exception as e:
                    logger.warning(f"[{platform_name}] 读取页面内容失败: {str(e)}")

            auth_cookie_names = get_platform_auth_cookie_names(platform_config)
            if auth_cookie_names:
                cookies = await context.cookies()
                platform_user_state = await has_platform_user_state(page, platform_name)
                if not has_platform_auth_cookies(cookies, platform_config) and not platform_user_state:
                    logger.error(f"[{platform_name}] 缺少授权Cookie，视为账号无效")
                    await close_runtime()
                    return build_account_check_result(False, "token_invalid", "授权 Cookie / Token 已失效，请重新登录")

                login_required_selectors = platform_config.get("selectors", {}).get("login_required", [])
                if login_required_selectors and await has_visible_selector(page, login_required_selectors):
                    logger.error(f"[{platform_name}] 页面仍显示登录入口，视为账号无效")
                    await close_runtime()
                    return build_account_check_result(False, "login_expired", "页面仍显示登录入口，请重新登录")
            elif platform_name in {"yuanbao", "kimi", "deepseek", "zhipu"}:
                if not await has_platform_user_state(page, platform_name):
                    logger.error(f"[{platform_name}] 页面仍处于未登录态，视为账号无效")
                    await close_runtime()
                    return build_account_check_result(False, "login_expired", "页面处于未登录状态，请重新登录")

            if platform_config.get("features", {}).get("strict_login_check", False):
                success_selectors = (
                    platform_config.get("selectors", {}).get("login_success", [])
                    or platform_config.get("selectors", {}).get("account_name", [])
                )
                if success_selectors and not await has_visible_selector(page, success_selectors):
                    logger.error(f"[{platform_name}] 未检测到登录成功标记，视为账号无效")
                    await close_runtime()
                    return build_account_check_result(False, "token_invalid", "未检测到有效授权标记，请重新登录")

            # 检查是否成功加载个人中心页面的特征元素

            # 暂时使用通用的检查方法
            logger.success(f"[{platform_name}] 账号有效")
            await close_runtime()
            return build_account_check_result(True, "ok", "账号状态正常")
    except Exception as e:
        logger.error(f"[{platform_name}] 检测账号有效性时出错: {str(e)}")
        reason, detail = classify_account_check_exception(e)
        return build_account_check_result(False, reason, detail)
    finally:
        if temp_profile_dir:
            shutil.rmtree(temp_profile_dir, ignore_errors=True)


async def check_cookie_generic(type, file_path):
    result = await check_cookie_generic_detailed(type, file_path)
    return bool(result.get("valid"))
