# -*- coding: utf-8 -*-
"""
通用多平台视频上传核心实现
"""
import os
import asyncio
import inspect
import json
import time
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from playwright.async_api import Playwright, async_playwright
from conf import LOCAL_CHROME_PATH, LOCAL_CHROME_HEADLESS, BASE_DIR
from utils.account_runtime import build_playwright_proxy, get_account_runtime_by_file_path
from utils.base_social_media import set_init_script
from utils.files_times import get_absolute_path
from utils.log import create_logger
# 从platform_configs.py导入平台配置字典
from .platform_configs import PLATFORM_CONFIGS, get_type_by_platform_key
from myUtils.auth import check_cookie_generic


class BaseFileUploader(object):
    """
    单个视频上传器通用基类参数说明：
    account_file: 账号cookie文件路径
    file_type: 文件类型，1为图文，2为视频
    file_path: 文件路径
    title: 文件标题
    text: 文件正文描述
    tags: 文件标签，多个标签用逗号隔开
    publish_date: 发布时间，格式为YYYY-MM-DD HH:MM:SS
    """
    
    def __init__(self, platform, account_file, file_type, file_path, title, text, tags, thumbnail_path, location, publish_date, content_mode=None, is_draft=False, forum_name=None, article_doc=None, headless_override=None, progress_callback=None, snapshot_callback=None, desktop_runner_id=None):
        self.platform = platform
        self.account_file = account_file
        self.file_type = file_type
        self.file_paths = self.normalize_input_file_paths(file_path)
        self.file_path = self.file_paths[0] if self.file_paths else None
        self.title = title
        self.text = text
        self.tags = tags
        self.thumbnail_path = thumbnail_path
        self.location = location
        self.publish_date = publish_date
        self.content_mode = content_mode
        self.is_draft = bool(is_draft)
        self.forum_name = (forum_name or "").strip()
        self.article_doc = article_doc if isinstance(article_doc, dict) else None
        self.progress_callback = progress_callback
        self.snapshot_callback = snapshot_callback
        self.desktop_runner_id = (desktop_runner_id or "").strip()
        self.desktop_cdp_url = f"http://127.0.0.1:{os.getenv('ELECTRON_REMOTE_DEBUGGING_PORT', '9223')}"
        self._normalized_article_blocks = None
        self.local_executable_path = LOCAL_CHROME_PATH
        self.headless = LOCAL_CHROME_HEADLESS if headless_override is None else bool(headless_override)
        self.locator_base = None
        
        # 获取平台配置
        self.config = PLATFORM_CONFIGS.get(self.platform)
        if not self.config:
            raise ValueError(f"不支持的平台: {self.platform}")

        # URL constants
        # 平台名称
        self.platform_name = self.config["platform_name"]
        # 个人中心页面URL
        self.personal_url = self.config["personal_url"]
        # 登录页面URL
        self.login_url = self.config["login_url"]
        # 视频上传页面URL
        self.creator_video_url = self.config["creator_video_url"]
        # 图文上传页面URL
        self.creator_image_url = self.config["creator_image_url"]
        # 文章/长文编辑页面URL（如果平台支持）
        self.creator_article_url = self.config.get("creator_article_url")
        # 微头条等文本内容页面URL（如果平台支持）
        self.creator_weitoutiao_url = self.config.get("creator_weitoutiao_url")

        # Selector lists
        # 上传按钮选择器
        self.upload_button_selectors = self.config["selectors"]["upload_button"]
        self.draft_button_selectors = self.config["selectors"].get("draft_button", [])
        # 发布按钮选择器
        self.publish_button_selectors = self.config["selectors"]["publish_button"]
        self.article_publish_button_selectors = self.config["selectors"].get("article_publish_button", self.publish_button_selectors)
        self.weitoutiao_publish_button_selectors = self.config["selectors"].get("weitoutiao_publish_button", self.publish_button_selectors)
        self.video_publish_button_selectors = self.config["selectors"].get("video_publish_button", self.publish_button_selectors)
        # 标题编辑器输入框选择器
        self.editor_button_locators = self.config["selectors"]["title_editor"]
        self.article_title_locators = self.config["selectors"].get("article_title_editor", self.editor_button_locators)
        self.article_lead_locators = self.config["selectors"].get("article_lead_editor", [])
        self.video_title_locators = self.config["selectors"].get("video_title_editor", self.editor_button_locators)
        # 正文编辑器输入框选择器
        self.textbox_selectors = self.config["selectors"]["textbox_selectors"]
        self.article_textbox_selectors = self.config["selectors"].get("article_textbox_selectors", self.textbox_selectors)
        self.weitoutiao_textbox_selectors = self.config["selectors"].get("weitoutiao_textbox_selectors", self.textbox_selectors)
        self.video_textbox_selectors = self.config["selectors"].get("video_textbox_selectors", self.textbox_selectors)
        self.topic_input_selectors = self.config["selectors"].get("topic_input", [])
        # 封面上传选择器
        self.thumbnail_button_selectors = self.config["selectors"]["thumbnail_button"]
        # 封面完成确认选择器
        self.thumbnail_finish_selectors = self.config["selectors"]["thumbnail_finish"]
        # 发布时间选择器
        self.schedule_button_selectors = self.config["selectors"]["schedule_button"]
        
        
        # constants
        # 错误信息选择器
        self.error_selectors = [
            'div:has-text("error"):visible',
            'div:has-text("Error"):visible',
            'div[class*="error"]:visible'
        ]
        # 日志记录器
        self.logger = create_logger (self.platform_name, f'logs/{self.platform_name}.log')
        # 是否跳过验证cookie有效性
        self.skip_cookie_verify = self.config["features"]["skip_cookie_verify"]
        # 是否支持标题
        self.title_supported = self.config["features"]["title"]
        # 是否支持正文
        self.textbox_supported = self.config["features"]["textbox"]
        # 是否支持图文
        self.image_publish_supported = self.config["features"]["image_publish"]
        # 是否支持标签
        self.tags_supported = self.config["features"]["tags"]
        # 是否支持封面
        self.thumbnail_supported = self.config["features"]["thumbnail"]
        # 是否支持地点
        self.location_supported = self.config["features"]["location"]
        # 是否支持定时发布
        self.schedule_supported = self.config["features"]["schedule"]
        # 是否启用通用 stealth 注入脚本
        self.stealth_enabled = self.config["features"].get("stealth", True)
        # 视频/图文发布状态
        self.publish_status = False
        self.result_url = ""
        self.result_url_type = ""
        self.result_url_label = ""
        #按钮等待可见超时时间
        self.button_visible_timeout = 30000
        #网页加载超时时间
        self.page_load_timeout = 60000
        # 检查间隔时间
        self.check_interval = 2
        # 500ms等待超时时间
        self.wait_timeout_500ms = 500
        # 登录等待超时时间
        self.login_wait_timeout = 10000
        # 最大发布尝试次数
        self.max_publish_attempts = 3
        # 最大重试延迟时间
        self.max_retry_delay = 10
        # 最近一次发布阶段捕获到的页面错误
        self.last_publish_error = ""
        # 日期格式
        self.date_format = '%Y-%m-%d'
        # 时间格式
        self.time_format = '%H:%M'
        # 系统文件输入选择器
        self.direct_file_input_selectors = self.config["selectors"].get("direct_file_input", [])
        self.file_input_selector = self.direct_file_input_selectors + ['input[type="file"]']

        # Browser launch options
        default_browser_args = [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--ignore-certificate-errors',
            '--start-maximized',
            '--disable-blink-features=AutomationControlled'
        ]
        # 浏览器语言
        self.browser_lang = self.config["features"].get("browser_lang", 'en-US')
        # 慢速模式，模拟人类操作，增加稳定性
        self.slow_mo = 50
        self.browser_args = self.config["features"].get("browser_args", default_browser_args)
        self.login_browser_args = self.config["features"].get("login_browser_args", self.browser_args)
        self.manual_verification_enabled = self.config["features"].get("manual_verification", False)
        self.runtime = get_account_runtime_by_file_path(account_file)
        self.proxy_config = build_playwright_proxy(self.runtime.get("proxy")) if self.runtime else None

    def report_progress(self, message, level="info"):
        if callable(self.progress_callback):
            try:
                self.progress_callback(message, level)
            except Exception:
                pass

    def normalize_input_file_paths(self, file_path):
        if isinstance(file_path, (list, tuple, set)):
            candidates = list(file_path)
        elif file_path in (None, ""):
            candidates = []
        else:
            candidates = [file_path]

        normalized = []
        for candidate in candidates:
            if candidate in (None, ""):
                continue
            normalized.append(candidate if isinstance(candidate, Path) else Path(candidate))
        return normalized

    def get_file_log_path(self):
        if not self.file_paths:
            return "文本内容"
        if len(self.file_paths) == 1:
            return str(self.file_path)
        return f"{self.file_path} 等{len(self.file_paths)}个文件"

    def get_file_display_name(self):
        if not self.file_paths:
            return self.title or self.content_mode or "文本内容"
        if len(self.file_paths) == 1:
            return self.file_path.name
        return f"{self.file_path.name} 等{len(self.file_paths)}个文件"

    def get_upload_file_payload(self):
        if not self.file_paths:
            return None
        if self.file_type == 1 and len(self.file_paths) > 1 and (
            self.is_douyin_platform() or self.is_xiaohongshu_platform() or self.platform_name == "tencent"
        ):
            return [str(path) for path in self.file_paths]
        return self.file_path

    async def hold_debug_window_on_failure(self, page, timeout_ms=180000):
        if self.headless or not self.is_xiaohongshu_platform():
            return

        self.logger.warning("小红书发布失败，浏览器窗口将暂时保留，方便人工查看页面卡点")
        self.report_progress(f"{self.platform_name}：发布失败，浏览器窗口将保留 3 分钟供排查", "warning")
        try:
            await self.capture_progress_snapshot(page, "发布失败，保留浏览器供排查")
        except Exception:
            pass

        deadline = time.monotonic() + timeout_ms / 1000
        while time.monotonic() < deadline:
            try:
                if page.is_closed():
                    break
                await page.wait_for_timeout(1000)
            except Exception:
                break

    async def capture_progress_snapshot(self, page, stage):
        if not callable(self.snapshot_callback):
            return
        try:
            result = self.snapshot_callback(page, stage)
            if inspect.isawaitable(result):
                await result
        except Exception:
            pass

    def normalize_external_url(self, url):
        normalized = str(url or "").strip()
        if normalized.startswith("//"):
            normalized = f"https:{normalized}"
        if normalized.startswith(("http://", "https://")):
            return normalized
        return ""

    def normalize_match_text(self, text):
        return " ".join(str(text or "").replace("\xa0", " ").split())

    def build_text_match_markers(self, expected_text, prefix_lengths=None):
        normalized = self.normalize_match_text(expected_text)
        if not normalized:
            return []

        markers = []
        candidates = [normalized]
        for length in prefix_lengths or [48, 36, 24, 16]:
            if len(normalized) > length:
                candidates.append(normalized[:length].strip())

        for candidate in candidates:
            if candidate and candidate not in markers:
                markers.append(candidate)
        return markers

    def text_matches_markers(self, candidate_text, markers):
        normalized = self.normalize_match_text(candidate_text)
        if not normalized or not markers:
            return False

        for marker in markers:
            if not marker:
                continue
            if marker in normalized or normalized in marker:
                return True
        return False

    def get_result_url_priority(self, url_type):
        return {
            "manage": 1,
            "draft": 2,
            "published": 3,
        }.get(str(url_type or "").strip().lower(), 0)

    def infer_result_url_meta(self, url):
        normalized = self.normalize_external_url(url)
        if not normalized:
            return "", ""

        lower = normalized.lower()
        if self.is_draft or "/draft/" in lower or "action=list_card" in lower:
            return "draft", "查看草稿"

        manage_keywords = [
            "/creator",
            "/publish",
            "/write",
            "/writer",
            "/manage",
            "/article-publish",
            "/content-manage",
            "/contentmanagement",
            "/profile_v4/",
            "/main/creation/article",
            "/builder/rc/edit",
            "card.weibo.com/article/v5/editor",
            "mp.weixin.qq.com/cgi-bin/",
            "mp.toutiao.com/",
            "mp.163.com/",
            "om.qq.com/",
            "creator.xiaohongshu.com/",
            "cp.kuaishou.com/",
        ]
        if any(keyword in lower for keyword in manage_keywords):
            return "manage", "查看后台"

        return "published", "查看文章"

    def set_result_url(self, url, url_type=None, label=None, force=False):
        normalized = self.normalize_external_url(url)
        if not normalized:
            return ""

        inferred_type, inferred_label = self.infer_result_url_meta(normalized)
        next_type = url_type or inferred_type or "manage"
        next_label = label or inferred_label or "查看链接"

        current_priority = self.get_result_url_priority(self.result_url_type)
        next_priority = self.get_result_url_priority(next_type)
        if force or not self.result_url or next_priority >= current_priority:
            self.result_url = normalized
            self.result_url_type = next_type
            self.result_url_label = next_label
        return self.result_url

    def capture_result_url_from_page(self, page, url_type=None, label=None, force=False):
        current_url = ""
        try:
            current_url = page.url or ""
        except Exception:
            current_url = ""
        return self.set_result_url(current_url, url_type=url_type, label=label, force=force)

    async def attach_to_desktop_runner_page(self, playwright: Playwright):
        if not self.desktop_runner_id:
            raise Exception("缺少桌面发布标签标识")

        self.report_progress(f"{self.platform_name}：正在连接桌面发布标签")
        browser = await playwright.chromium.connect_over_cdp(self.desktop_cdp_url)
        deadline = time.monotonic() + 30
        last_error = None

        while time.monotonic() < deadline:
            for context in browser.contexts:
                for page in context.pages:
                    try:
                        marker = await page.evaluate("window.__MEDIA_HUB_RUNNER_ID || null")
                    except Exception as error:
                        last_error = error
                        continue
                    if marker == self.desktop_runner_id:
                        self.report_progress(f"{self.platform_name}：已附着到桌面发布标签")
                        return browser, context, page
            await asyncio.sleep(0.5)

        raise Exception(f"桌面发布标签未就绪: {last_error or '未找到目标标签'}")

    async def main(self):
        """
        主入口函数
        """
        self.report_progress(f"{self.platform_name}：正在校验发布参数")
        #1.打印本次发布的文件信息
        self.logger.info(f"{self.platform_name}将上传文件：{self.get_file_log_path()}")
        self.logger.info(f"{self.platform_name} 文件数量：{len(self.file_paths)}")
        if self.file_path:
            # 根据文件名后缀判断文件类型
            # .jpg,.jpeg,.png,.webp 为图片文件
            if self.file_path.suffix in ['.jpg', '.jpeg', '.png', '.webp']:
                self.file_type = 1
            # .mp4,.mov,.flv,.f4v,.mkv,.rm,.rmvb,.m4v,.mpg,.mpeg,.ts 为视频文件
            elif self.file_path.suffix in ['.mp4', '.mov', '.flv', '.f4v', '.mkv','.rm', '.rmvb', '.m4v', '.mpg', '.mpeg', '.ts']:
                self.file_type = 2
            else:
                self.logger.error(f"{self.platform_name}该文件类型暂不支持：{self.get_file_display_name()}")
        elif self.platform_name == "sohu" and self.content_mode == "article":
            self.file_type = 1
        elif self.is_toutiao_text_mode():
            self.file_type = 1
        elif self.is_toutiao_video_mode():
            self.file_type = 2
        elif self.is_csdn_platform() or self.is_jianshu_platform() or self.is_zhihu_platform() or self.is_x_platform() or self.is_weibo_platform() or self.is_douban_platform() or self.is_tieba_platform() or self.is_omqq_platform() or self.is_wangyi_platform():
            self.file_type = 1
        else:
            raise Exception(f"{self.platform_name}缺少待发布文件")
        self.logger.info(f"{self.platform_name} 文件类型：{self.file_type}")
        self.logger.info(f"{self.platform_name} 标题：{self.title}")
        #self.logger.info(f"{self.platform_name} 正文描述：{self.text}")
        self.logger.info(f"{self.platform_name} 标签：{self.tags}")

        if self.file_type == 1 and not self.image_publish_supported:
            raise Exception(f"{self.platform_name}暂不支持图文发布")

        # 2.验证平台cookie是否有效(可选：如果已登录，可跳过验证)
        if not self.skip_cookie_verify:
            self.report_progress(f"{self.platform_name}：正在校验账号登录态")
            if not await self.platform_setup(handle=True):
                raise Exception(f"{self.platform_name} Cookie验证失败")
            self.report_progress(f"{self.platform_name}：账号登录态校验通过", "success")

        # 3.执行平台上传视频
        async with async_playwright() as playwright:
            upload_result = await self.upload(playwright)
            if not upload_result:
                self.logger.error(f"{self.platform_name}{self.get_content_label()}上传失败: {self.title}")
                return False
            else:
                self.logger.info(f"{self.platform_name}{self.get_content_label()}上传成功: {self.title}")
                return True

    async def upload(self, playwright: Playwright) -> None:
        """
        作用：执行单个视频上传到某个平台
        """
        try:
            self.logger.info(f'开始上传{self.get_content_label()}: {self.title}')
            self.report_progress(f"{self.platform_name}：正在启动浏览器环境")
            browser = None
            attached_browser = None
            attached_mode = bool(self.desktop_runner_id and not self.headless)
            account_path = Path(self.account_file)
            if attached_mode:
                attached_browser, context, page = await self.attach_to_desktop_runner_page(playwright)
                self.logger.info(f"step1: {self.platform_name}已附着到桌面发布标签")
            elif account_path.is_dir():
                context = await playwright.chromium.launch_persistent_context(
                    str(account_path),
                    headless=self.headless,
                    executable_path=self.local_executable_path,
                    args=self.browser_args,
                    slow_mo=self.slow_mo,
                    no_viewport=True,
                    locale=self.browser_lang,
                    proxy=self.proxy_config,
                )
                if self.stealth_enabled:
                    context = await set_init_script(context)
                self.logger.info(f"step1: {self.platform_name}持久化浏览器上下文创建成功")
                self.report_progress(f"{self.platform_name}：持久化浏览器环境已就绪")
            else:
                # step1.创建浏览器实例
                browser = await playwright.chromium.launch(
                    headless=self.headless,
                    executable_path=self.local_executable_path,
                    args=self.browser_args,
                    slow_mo=self.slow_mo,
                    proxy=self.proxy_config,
                )
                self.logger.info(f"step1: {self.platform_name}浏览器实例创建成功")

                # step2.创建上下文并加载cookie
                context_kwargs = {
                    "storage_state": f"{self.account_file}",
                    "locale": "zh-CN" if self.is_jianshu_platform() else self.browser_lang,
                }
                if self.is_jianshu_platform():
                    context_kwargs["viewport"] = {"width": 1440, "height": 900}
                context = await browser.new_context(**context_kwargs)
                if self.stealth_enabled:
                    context = await set_init_script(context)
                self.logger.info(f"step2: {self.platform_name}浏览器上下文创建成功")
                self.report_progress(f"{self.platform_name}：浏览器上下文已就绪")


            # step3.创建新页面，导航到上传页面，明确指定等待domcontentloaded状态
            if not attached_mode:
                page = context.pages[0] if context.pages else await context.new_page()
            #tiktok平台需要先切换到英文
            if self.platform_name == "tiktok":
                await self.change_language(page)
            target_url = self.get_target_url()
            await page.goto(target_url, wait_until='domcontentloaded', timeout=self.page_load_timeout)
            await asyncio.sleep(2)
            if self.is_wechat_official_platform():
                await self.prepare_wechat_official_article_page(page)
            if self.platform_name == "tencent":
                await self.prepare_tencent_page(page)
            if self.platform_name == "sohu":
                if self.file_type == 1:
                    await page.wait_for_selector('input[placeholder="请输入标题（5-72字）"]', timeout=self.page_load_timeout)
                    await page.wait_for_selector('.ql-editor', timeout=self.page_load_timeout)
                else:
                    await page.wait_for_selector('div.upload-area', timeout=self.page_load_timeout)
                    await page.wait_for_selector('input.titleErrorInput', timeout=self.page_load_timeout)
            if self.platform_name == "toutiao_mp":
                await self.prepare_toutiao_page(page)
            if self.is_csdn_platform():
                await self.prepare_csdn_page(page)
            if self.is_jianshu_platform():
                await self.prepare_jianshu_page(page)
            if self.is_zhihu_platform():
                await self.prepare_zhihu_page(page)
            if self.is_x_platform():
                await self.prepare_x_page(page)
            if self.is_douban_platform():
                await self.prepare_douban_page(page)
            if self.is_weibo_platform():
                await self.prepare_weibo_page(page)
            if self.is_tieba_platform():
                await self.prepare_tieba_page(page)
            if self.is_omqq_platform():
                await self.prepare_omqq_page(page)
            if self.is_wangyi_platform():
                await self.prepare_wangyi_page(page)
            self.logger.info(f"step3: {self.platform_name}页面加载完成")
            self.report_progress(f"{self.platform_name}：已进入平台发布页面")
            await self.capture_progress_snapshot(page, "已进入平台发布页面")
            # instagram平台需要先点击ins登录按钮
            if self.platform_name == "instagram":
                await self.handle_instagram_login(page)

            
            # step4.选择基础定位器
            await self.choose_base_locator(page)
            self.logger.info(f"step4: {self.platform_name}基础定位器选择完成")
            self.report_progress(f"{self.platform_name}：页面编辑区域已识别")
            await self.capture_progress_snapshot(page, "页面编辑区域已识别")

            if self.has_article_doc():
                self.report_progress(f"{self.platform_name}：正在写入文章内容")
                add_title_tags_result = await self.render_structured_article(page)
                if not add_title_tags_result:
                    raise Exception(f"{self.platform_name} 结构化文章内容填写失败")
                if self.is_toutiao_platform() and (self.content_mode or "article") == "article":
                    toutiao_cover_ready = await self.ensure_toutiao_article_cover_mode(page)
                    if not toutiao_cover_ready:
                        raise Exception(self.last_publish_error or "头条文章封面未准备完成")
                self.logger.info(f"step5: {self.platform_name}结构化文章内容填写完成")
                self.report_progress(f"{self.platform_name}：文章内容填写完成")
                await self.capture_progress_snapshot(page, "文章内容填写完成")
            elif self.is_toutiao_text_mode():
                self.report_progress(f"{self.platform_name}：正在填写文本内容")
                add_title_tags_result = await self.add_title_tags(page)
                if not add_title_tags_result:
                    raise Exception(f"{self.platform_name} 文本内容填写失败")
                self.logger.info(f"step5: {self.platform_name}文本内容填写完成")
                self.report_progress(f"{self.platform_name}：文本内容填写完成")
                await self.capture_progress_snapshot(page, "文本内容填写完成")
            elif self.is_wechat_official_platform() and self.file_type == 1:
                self.report_progress(f"{self.platform_name}：正在填写标题和正文")
                add_title_tags_result = await self.add_title_tags(page)
                if not add_title_tags_result:
                    raise Exception(f"{self.platform_name} 标题和正文填写失败")
                self.logger.info(f"step5: {self.platform_name}标题和正文填写完成")

                self.report_progress(f"{self.platform_name}：正在上传正文图片")
                upload_video_file_result = await self.upload_video_file(page)
                if not upload_video_file_result:
                    raise Exception(f"{self.platform_name} 正文图片上传失败")
                self.logger.info(f"step6: {self.platform_name}正文图片上传完成")

                detect_upload_status_result = await self.detect_upload_status(page)
                if not detect_upload_status_result:
                    raise Exception(f"{self.platform_name} 正文图片上传状态检测失败")
                self.logger.info(f"step7: {self.platform_name}正文图片上传状态检测完成")
                self.report_progress(f"{self.platform_name}：正文图片上传完成")
                await self.capture_progress_snapshot(page, "正文图片上传完成")
            elif self.platform_name == "sohu" and self.file_type == 1:
                # 搜狐文章页需要先填写标题/正文，再通过编辑器弹窗插入正文图片
                self.report_progress(f"{self.platform_name}：正在填写标题和正文")
                add_title_tags_result = await self.add_title_tags(page)
                if not add_title_tags_result:
                    raise Exception(f"{self.platform_name} 标题和标签添加失败")
                self.logger.info(f"step5: {self.platform_name}标题和标签添加完成")

                self.report_progress(f"{self.platform_name}：正在上传图文素材")
                upload_video_file_result = await self.upload_video_file(page)
                if not upload_video_file_result:
                    raise Exception(f"{self.platform_name} 图文文件上传失败")
                self.logger.info(f"step6: {self.platform_name}图文文件上传完成")

                detect_upload_status_result = await self.detect_upload_status(page)
                if not detect_upload_status_result:
                    raise Exception(f"{self.platform_name} 上传状态检测失败")
                self.logger.info(f"step7: {self.platform_name}上传状态检测完成")
                self.report_progress(f"{self.platform_name}：图文素材上传完成")
                await self.capture_progress_snapshot(page, "图文素材上传完成")
            elif self.is_csdn_platform():
                self.report_progress(f"{self.platform_name}：正在填写标题和正文")
                add_title_tags_result = await self.add_title_tags(page)
                if not add_title_tags_result:
                    raise Exception(f"{self.platform_name} 标题和正文填写失败")
                self.logger.info(f"step5: {self.platform_name}标题和正文填写完成")

                if self.file_path:
                    self.report_progress(f"{self.platform_name}：正在上传正文图片")
                    upload_video_file_result = await self.upload_video_file(page)
                    if not upload_video_file_result:
                        raise Exception(f"{self.platform_name} 正文图片上传失败")
                    self.logger.info(f"step6: {self.platform_name}正文图片上传完成")

                    detect_upload_status_result = await self.detect_upload_status(page)
                    if not detect_upload_status_result:
                        raise Exception(f"{self.platform_name} 正文图片上传状态检测失败")
                    self.logger.info(f"step7: {self.platform_name}正文图片上传状态检测完成")
                    self.report_progress(f"{self.platform_name}：正文图片上传完成")
                    await self.capture_progress_snapshot(page, "正文图片上传完成")
                else:
                    self.logger.info(f"step6: {self.platform_name}本次为纯文本文章，跳过图片上传")
                    self.report_progress(f"{self.platform_name}：正文填写完成，当前为纯文本文章")
                    await self.capture_progress_snapshot(page, "正文填写完成")
            elif self.is_jianshu_platform():
                self.report_progress(f"{self.platform_name}：正在填写标题和正文")
                add_title_tags_result = await self.add_title_tags(page)
                if not add_title_tags_result:
                    raise Exception(f"{self.platform_name} 标题和正文填写失败")
                self.logger.info(f"step5: {self.platform_name}标题和正文填写完成")

                if self.file_path:
                    self.report_progress(f"{self.platform_name}：正在上传正文图片")
                    upload_video_file_result = await self.upload_video_file(page)
                    if not upload_video_file_result:
                        raise Exception(f"{self.platform_name} 正文图片上传失败")
                    self.logger.info(f"step6: {self.platform_name}正文图片上传完成")

                    detect_upload_status_result = await self.detect_upload_status(page)
                    if not detect_upload_status_result:
                        raise Exception(f"{self.platform_name} 正文图片上传状态检测失败")
                    self.logger.info(f"step7: {self.platform_name}正文图片上传状态检测完成")
                    self.report_progress(f"{self.platform_name}：正文图片上传完成")
                    await self.capture_progress_snapshot(page, "正文图片上传完成")
                else:
                    self.logger.info(f"step6: {self.platform_name}本次为纯文本文章，跳过图片上传")
                    self.report_progress(f"{self.platform_name}：正文填写完成，当前为纯文本文章")
                    await self.capture_progress_snapshot(page, "正文填写完成")
            elif self.is_zhihu_platform():
                self.report_progress(f"{self.platform_name}：正在填写标题和正文")
                add_title_tags_result = await self.add_title_tags(page)
                if not add_title_tags_result:
                    raise Exception(f"{self.platform_name} 标题和正文填写失败")
                self.logger.info(f"step5: {self.platform_name}标题和正文填写完成")

                if self.file_path:
                    self.report_progress(f"{self.platform_name}：正在上传正文图片")
                    upload_video_file_result = await self.upload_video_file(page)
                    if not upload_video_file_result:
                        raise Exception(f"{self.platform_name} 正文图片上传失败")
                    self.logger.info(f"step6: {self.platform_name}正文图片上传完成")

                    detect_upload_status_result = await self.detect_upload_status(page)
                    if not detect_upload_status_result:
                        raise Exception(f"{self.platform_name} 正文图片上传状态检测失败")
                    self.logger.info(f"step7: {self.platform_name}正文图片上传状态检测完成")
                    self.report_progress(f"{self.platform_name}：正文图片上传完成")
                    await self.capture_progress_snapshot(page, "正文图片上传完成")
                else:
                    self.logger.info(f"step6: {self.platform_name}本次为纯文本文章，跳过图片上传")
                    self.report_progress(f"{self.platform_name}：正文填写完成，当前为纯文本文章")
                    await self.capture_progress_snapshot(page, "正文填写完成")
            elif self.is_weibo_article_mode():
                self.report_progress(f"{self.platform_name}：正在填写文章标题和正文")
                add_title_tags_result = await self.add_title_tags(page)
                if not add_title_tags_result:
                    raise Exception(f"{self.platform_name} 文章标题和正文填写失败")
                self.logger.info(f"step5: {self.platform_name}文章标题和正文填写完成")

                if self.file_path:
                    self.logger.info(f"step6: {self.platform_name}文章模式当前先按纯文本处理，已忽略上传文件 {self.get_file_display_name()}")
                else:
                    self.logger.info(f"step6: {self.platform_name}本次为纯文本文章，跳过媒体上传")
                self.report_progress(f"{self.platform_name}：文章正文填写完成")
                await self.capture_progress_snapshot(page, "文章正文填写完成")
            elif self.is_douban_platform():
                self.report_progress(f"{self.platform_name}：正在填写内容")
                add_title_tags_result = await self.add_title_tags(page)
                if not add_title_tags_result:
                    raise Exception(f"{self.platform_name} 内容填写失败")
                self.logger.info(f"step5: {self.platform_name}内容填写完成")

                if self.file_path:
                    self.report_progress(f"{self.platform_name}：正在上传图片")
                    upload_video_file_result = await self.upload_video_file(page)
                    if not upload_video_file_result:
                        raise Exception(f"{self.platform_name} 图片上传失败")
                    self.logger.info(f"step6: {self.platform_name}图片上传完成")

                    detect_upload_status_result = await self.detect_upload_status(page)
                    if not detect_upload_status_result:
                        raise Exception(f"{self.platform_name} 图片上传状态检测失败")
                    self.logger.info(f"step7: {self.platform_name}图片上传状态检测完成")
                    self.report_progress(f"{self.platform_name}：图片上传完成")
                    await self.capture_progress_snapshot(page, "图片上传完成")
                else:
                    self.logger.info(f"step6: {self.platform_name}本次为纯文本内容，跳过图片上传")
                    self.report_progress(f"{self.platform_name}：正文填写完成，当前为纯文本内容")
                    await self.capture_progress_snapshot(page, "正文填写完成")
            elif self.is_tieba_platform():
                self.report_progress(f"{self.platform_name}：正在填写帖子内容")
                add_title_tags_result = await self.add_title_tags(page)
                if not add_title_tags_result:
                    raise Exception(f"{self.platform_name} 内容填写失败")
                self.logger.info(f"step5: {self.platform_name}内容填写完成")

                if self.file_path:
                    self.report_progress(f"{self.platform_name}：正在上传图片")
                    upload_video_file_result = await self.upload_video_file(page)
                    if not upload_video_file_result:
                        raise Exception(f"{self.platform_name} 图片上传失败")
                    self.logger.info(f"step6: {self.platform_name}图片上传完成")

                    detect_upload_status_result = await self.detect_upload_status(page)
                    if not detect_upload_status_result:
                        raise Exception(f"{self.platform_name} 图片上传状态检测失败")
                    self.logger.info(f"step7: {self.platform_name}图片上传状态检测完成")
                    self.report_progress(f"{self.platform_name}：图片上传完成")
                    await self.capture_progress_snapshot(page, "图片上传完成")
                else:
                    self.logger.info(f"step6: {self.platform_name}本次为纯文本帖子，跳过图片上传")
                    self.report_progress(f"{self.platform_name}：帖子正文填写完成")
                    await self.capture_progress_snapshot(page, "帖子正文填写完成")
            elif self.is_omqq_platform():
                self.report_progress(f"{self.platform_name}：正在填写标题和正文")
                add_title_tags_result = await self.add_title_tags(page)
                if not add_title_tags_result:
                    raise Exception(f"{self.platform_name} 标题和正文填写失败")
                self.logger.info(f"step5: {self.platform_name}标题和正文填写完成")

                if self.file_path:
                    self.report_progress(f"{self.platform_name}：正在上传正文图片")
                    upload_video_file_result = await self.upload_video_file(page)
                    if not upload_video_file_result:
                        raise Exception(f"{self.platform_name} 正文图片上传失败")
                    self.logger.info(f"step6: {self.platform_name}正文图片上传完成")

                    detect_upload_status_result = await self.detect_upload_status(page)
                    if not detect_upload_status_result:
                        raise Exception(f"{self.platform_name} 正文图片上传状态检测失败")
                    self.logger.info(f"step7: {self.platform_name}正文图片上传状态检测完成")
                    self.report_progress(f"{self.platform_name}：正文图片上传完成")
                    await self.capture_progress_snapshot(page, "正文图片上传完成")
                else:
                    self.logger.info(f"step6: {self.platform_name}本次为纯文本文章，跳过图片上传")
                    self.report_progress(f"{self.platform_name}：正文填写完成，当前为纯文本文章")
                    await self.capture_progress_snapshot(page, "正文填写完成")
            elif self.is_wangyi_platform():
                self.report_progress(f"{self.platform_name}：正在填写标题和正文")
                add_title_tags_result = await self.add_title_tags(page)
                if not add_title_tags_result:
                    raise Exception(f"{self.platform_name} 标题和正文填写失败")
                self.logger.info(f"step5: {self.platform_name}标题和正文填写完成")

                if self.file_path:
                    self.report_progress(f"{self.platform_name}：正在上传正文图片")
                    upload_video_file_result = await self.upload_video_file(page)
                    if not upload_video_file_result:
                        raise Exception(f"{self.platform_name} 正文图片上传失败")
                    self.logger.info(f"step6: {self.platform_name}正文图片上传完成")

                    detect_upload_status_result = await self.detect_upload_status(page)
                    if not detect_upload_status_result:
                        raise Exception(f"{self.platform_name} 正文图片上传状态检测失败")
                    self.logger.info(f"step7: {self.platform_name}正文图片上传状态检测完成")
                    self.report_progress(f"{self.platform_name}：正文图片上传完成")
                    await self.capture_progress_snapshot(page, "正文图片上传完成")
                else:
                    self.logger.info(f"step6: {self.platform_name}本次为纯文本文章，跳过图片上传")
                    self.report_progress(f"{self.platform_name}：正文填写完成，当前为纯文本文章")
                    await self.capture_progress_snapshot(page, "正文填写完成")
            elif self.is_x_platform() or self.is_weibo_platform():
                if self.file_path:
                    self.report_progress(f"{self.platform_name}：正在上传媒体素材")
                    upload_video_file_result = await self.upload_video_file(page)
                    if not upload_video_file_result:
                        raise Exception(f"{self.platform_name} 媒体文件上传失败")
                    self.logger.info(f"step5: {self.platform_name}媒体文件上传完成")

                    detect_upload_status_result = await self.detect_upload_status(page)
                    if not detect_upload_status_result:
                        raise Exception(f"{self.platform_name} 媒体上传状态检测失败")
                    self.logger.info(f"step6: {self.platform_name}媒体上传状态检测完成")
                    self.report_progress(f"{self.platform_name}：媒体素材上传完成")
                    await self.capture_progress_snapshot(page, "媒体素材上传完成")
                else:
                    self.logger.info(f"step5: {self.platform_name}本次为纯文本动态，跳过媒体上传")
                    self.report_progress(f"{self.platform_name}：当前为纯文本模式，跳过媒体上传")
                    await self.capture_progress_snapshot(page, "纯文本模式已就绪")

                self.report_progress(f"{self.platform_name}：正在填写动态内容")
                add_title_tags_result = await self.add_title_tags(page)
                if not add_title_tags_result:
                    raise Exception(f"{self.platform_name} 动态内容填写失败")
                self.logger.info(f"step7: {self.platform_name}动态内容填写完成")
                self.report_progress(f"{self.platform_name}：动态内容填写完成")
                await self.capture_progress_snapshot(page, "动态内容填写完成")
            else:
                # step5.上传视频文件
                self.report_progress(f"{self.platform_name}：正在上传素材文件")
                upload_video_file_result = await self.upload_video_file(page)
                if not upload_video_file_result:
                    raise Exception(f"{self.platform_name} 视频文件上传失败")
                self.logger.info(f"step5: {self.platform_name}视频文件上传完成")

                # step6.检测上传状态
                detect_upload_status_result = await self.detect_upload_status(page)
                if not detect_upload_status_result:
                    raise Exception(f"{self.platform_name} 上传状态检测失败")
                self.logger.info(f"step6: {self.platform_name}上传状态检测完成")
                self.report_progress(f"{self.platform_name}：素材上传完成")
                await self.capture_progress_snapshot(page, "素材上传完成")
                
                # step7.添加标题和标签
                self.report_progress(f"{self.platform_name}：正在填写标题和标签")
                add_title_tags_result = await self.add_title_tags(page)
                if not add_title_tags_result:
                    raise Exception(f"{self.platform_name} 标题和标签添加失败")
                self.logger.info(f"step7: {self.platform_name}标题和标签添加完成")
                self.report_progress(f"{self.platform_name}：标题和标签填写完成")
                await self.capture_progress_snapshot(page, "标题和标签填写完成")

            # step8.上传视频封面
            if self.thumbnail_supported:
                self.report_progress(f"{self.platform_name}：正在处理封面")
                await self.set_thumbnail(page)
                self.logger.info(f"step8: {self.platform_name}视频封面上传完成")
                self.report_progress(f"{self.platform_name}：封面处理完成")
                await self.capture_progress_snapshot(page, "封面处理完成")
            else:
                self.logger.info(f"step8: {self.platform_name}跳过设置缩略图")

            if self.platform_name == "baijiahao" and self.file_type == 2:
                ensure_baijiahao_video_category_result = await self.ensure_baijiahao_video_category(page)
                if not ensure_baijiahao_video_category_result:
                    raise Exception(f"{self.platform_name} 内容分类设置失败")
                self.logger.info(f"step8.1: {self.platform_name}内容分类设置完成")

            # step9.添加地点
            if self.location_supported and self.location:
                self.report_progress(f"{self.platform_name}：正在填写位置信息")
                await self.set_location(page)
                self.logger.info(f"step9: {self.platform_name}地点添加完成")
                self.report_progress(f"{self.platform_name}：位置信息填写完成")
                await self.capture_progress_snapshot(page, "位置信息填写完成")
            else:
                self.logger.info(f"step9: {self.platform_name}跳过添加地点")
            
            # step10.设置定时发布（如果需要）
            if self.schedule_supported and self.publish_date != 0:
                self.report_progress(f"{self.platform_name}：正在设置定时发布时间")
                await self.set_schedule_time(page, self.publish_date)
                self.logger.info(f"step10: {self.platform_name}定时发布设置完成")
                self.report_progress(f"{self.platform_name}：定时发布时间设置完成")
                await self.capture_progress_snapshot(page, "定时发布时间设置完成")
            else:
                self.logger.info(f"step10: {self.platform_name}跳过定时发布")

            if self.platform_name == "sohu" and self.file_type == 2:
                ensure_sohu_video_category_result = await self.ensure_sohu_video_category(page)
                if not ensure_sohu_video_category_result:
                    raise Exception(f"{self.platform_name} 频道分类设置失败")
                self.logger.info(f"step10.1: {self.platform_name}频道分类设置完成")

            if self.is_wechat_official_platform() and self.file_type == 1:
                ensure_wechat_official_cover_result = await self.ensure_wechat_official_cover(page)
                if not ensure_wechat_official_cover_result:
                    raise Exception(f"{self.platform_name} 封面设置失败")
                self.logger.info(f"step10.2: {self.platform_name}封面设置完成")
            if self.is_zhihu_platform() and self.file_type == 1 and self.file_path:
                ensure_zhihu_cover_result = await self.ensure_zhihu_cover(page)
                if not ensure_zhihu_cover_result:
                    raise Exception(f"{self.platform_name} 封面设置失败")
                self.logger.info(f"step10.2: {self.platform_name}封面设置完成")
            
            # step11.点击发布
            self.report_progress(f"{self.platform_name}：正在提交{ '草稿' if self.is_draft else '发布' }")
            await self.capture_progress_snapshot(page, "提交前页面状态")
            await self.click_publish(page)
            self.logger.info(f"step11：{self.platform_name}视频已点击发布按钮")
            self.report_progress(f"{self.platform_name}：提交动作已完成，正在等待结果")
            await self.capture_progress_snapshot(page, "提交动作已完成，正在等待结果")

            # step12.重新保存最新cookie
            if account_path.is_file():
                if await self.should_persist_login_state(page):
                    await context.storage_state(path=f"{self.account_file}")
                    self.logger.info(f"step12：{self.platform_name}cookie已更新")
                else:
                    self.logger.warning(f"step12：{self.platform_name}当前不是有效登录态，跳过覆盖 cookie，避免把账号登出")
            else:
                self.logger.info(f"step12：{self.platform_name}使用持久化profile，跳过cookie导出")

            # 等待视频发布状态更新，方便看发布状态
            await asyncio.sleep(self.check_interval)  # close delay for look the video status
            await asyncio.sleep(5)

            if not self.publish_status and not attached_mode:
                await self.hold_debug_window_on_failure(page)

            # step13.关闭所有页面和浏览器上下文
            if attached_mode:
                self.logger.info(f"step13：{self.platform_name}桌面发布标签保留打开")
            else:
                await context.close()
                if browser:
                    await browser.close()
                self.logger.info(f"step13：{self.platform_name}浏览器窗口已关闭")
            self.report_progress(f"{self.platform_name}：发布流程已结束", "success")

            return self.publish_status
        except Exception as e:
            if not self.last_publish_error:
                if self.is_page_or_context_closed_error(e):
                    self.last_publish_error = "简书浏览器窗口已关闭，请不要手动关掉发布窗口" if self.is_jianshu_platform() else "浏览器窗口已关闭，请不要手动关掉发布窗口"
                else:
                    self.last_publish_error = str(e)
            self.logger.error(f"{self.platform_name}{self.get_content_label()}上传失败: {str(e)}")
            self.report_progress(f"{self.platform_name}：发布失败 - {str(e)}", "error")
            return False

    async def choose_base_locator(self, page):
        """
        选择基础定位器
        """
        # 通用平台不需要处理iframe，直接使用page即可
        self.locator_base = page

    async def prepare_wechat_official_article_page(self, page):
        """
        公众号文章编辑页依赖登录态里的动态 token，需要先进入后台首页再跳文章页。
        """
        if not self.is_wechat_official_platform():
            return

        title_ready = page.locator('#title')
        editor_ready = page.locator('div.ProseMirror[contenteditable="true"]')
        if await title_ready.count() > 0 and await editor_ready.count() > 0:
            return

        await page.goto(self.personal_url, wait_until='domcontentloaded', timeout=self.page_load_timeout)
        await page.wait_for_timeout(2000)
        token = self.extract_token_from_url(page.url)
        if not token:
            raise Exception("未能从公众号后台首页地址中获取 token")

        await page.goto(self.build_wechat_official_article_url(token), wait_until='domcontentloaded', timeout=self.page_load_timeout)
        await page.wait_for_selector('#title', timeout=self.page_load_timeout)
        await page.wait_for_selector('div.ProseMirror[contenteditable="true"]', timeout=self.page_load_timeout)
        await page.wait_for_timeout(1000)

    def is_toutiao_platform(self):
        return self.platform_name == "toutiao_mp"

    def is_xiaohongshu_platform(self):
        return self.platform_name == "xiaohongshu"

    def is_douyin_platform(self):
        return self.platform_name == "douyin"

    def is_wechat_official_platform(self):
        return self.platform_name == "wechat_official"

    def is_csdn_platform(self):
        return self.platform_name == "csdn"

    def is_jianshu_platform(self):
        return self.platform_name == "jianshu"

    def extract_jianshu_note_id(self, url):
        match = re.search(r"/notes/(\d+)", str(url or ""))
        return match.group(1) if match else ""

    async def should_persist_login_state(self, page):
        try:
            current_url = (page.url or "").lower()
        except Exception:
            return False
        if any(token in current_url for token in ("sign_in", "signin", "/login", "passport")):
            return False
        if not self.is_jianshu_platform():
            return True
        try:
            editor_alive = await page.locator('input._24i7u, a[data-action="publicize"], a[data-action="privatize"]').count()
            return editor_alive > 0
        except Exception:
            return False

    def is_zhihu_platform(self):
        return self.platform_name == "zhihu"

    def is_x_platform(self):
        return self.platform_name == "x"

    def is_weibo_platform(self):
        return self.platform_name == "weibo"

    def is_douban_platform(self):
        return self.platform_name == "douban"

    def is_tieba_platform(self):
        return self.platform_name == "tieba"

    def is_omqq_platform(self):
        return self.platform_name == "omqq"

    def is_wangyi_platform(self):
        return self.platform_name == "wangyi_mp"

    def is_weibo_article_mode(self):
        return self.is_weibo_platform() and (self.content_mode or "post") == "article"

    def is_weibo_post_mode(self):
        return self.is_weibo_platform() and (self.content_mode or "post") == "post"

    def is_douban_article_mode(self):
        return self.is_douban_platform() and (self.content_mode or "post") == "article"

    def is_douban_post_mode(self):
        return self.is_douban_platform() and (self.content_mode or "post") == "post"

    def is_toutiao_video_mode(self):
        return self.is_toutiao_platform() and (self.content_mode or "video") == "video"

    def is_toutiao_text_mode(self):
        return self.is_toutiao_platform() and (self.content_mode or "video") in {"article", "weitoutiao"}

    def get_content_label(self):
        return "图文" if int(self.file_type or 0) == 1 else "视频"

    def get_target_url(self):
        if self.is_wechat_official_platform():
            return self.personal_url

        if self.is_toutiao_platform():
            if self.content_mode == "article":
                return self.creator_image_url
            if self.content_mode == "weitoutiao" and self.creator_weitoutiao_url:
                return self.creator_weitoutiao_url
            return self.creator_video_url

        if self.is_weibo_article_mode() and self.creator_article_url:
            return self.creator_article_url
        if self.is_douban_article_mode() and self.creator_article_url:
            return self.creator_article_url
        if self.is_tieba_platform():
            return self.build_tieba_bar_url()
        if self.is_omqq_platform() and self.creator_article_url:
            return self.creator_article_url
        if self.is_wangyi_platform() and self.creator_article_url:
            return self.creator_article_url

        if self.file_type == 1:
            return self.creator_image_url
        return self.creator_video_url

    def extract_token_from_url(self, url):
        try:
            return parse_qs(urlparse(url).query).get("token", [""])[0]
        except Exception:
            return ""

    def build_wechat_official_article_url(self, token):
        return (
            "https://mp.weixin.qq.com/cgi-bin/appmsg?"
            f"t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=0&token={token}&lang=zh_CN"
        )

    def build_wechat_official_draft_url(self, token):
        return (
            "https://mp.weixin.qq.com/cgi-bin/appmsg?"
            f"begin=0&count=10&type=77&action=list_card&token={token}&lang=zh_CN"
        )

    def build_tieba_bar_url(self):
        if not self.forum_name:
            raise Exception("贴吧缺少目标吧名称")
        return f"https://tieba.baidu.com/f?kw={quote(self.forum_name)}"

    def build_text_with_tags(self, base_text):
        clean_text = (base_text or "").strip()
        tag_text = " ".join(f"#{tag}" for tag in self.get_tags_list())

        parts = [part for part in [clean_text, tag_text] if part]
        return "\n\n".join(parts)

    def build_toutiao_body_text(self, include_title=False):
        if self.has_article_doc():
            article_text = self.build_article_doc_plain_text()
            if include_title and self.title:
                article_text = "\n\n".join([part for part in [self.title.strip(), article_text] if part]).strip()
            return self.build_text_with_tags(article_text)
        content_parts = []
        if include_title and self.title:
            content_parts.append(self.title.strip())
        if self.text:
            content_parts.append(self.text.strip())
        return self.build_text_with_tags("\n\n".join([part for part in content_parts if part]))

    def build_toutiao_weitoutiao_text(self):
        if self.has_article_doc():
            article_text = self.build_article_doc_plain_text()
            return self.build_text_with_tags(
                "\n\n".join([part for part in [self.title.strip() if self.title else "", article_text] if part])
            )

        title_text = (self.title or "").strip()
        body_text = (self.text or "").strip()
        content_parts = []

        if title_text and body_text:
            if body_text.startswith(title_text):
                content_parts.append(body_text)
            else:
                content_parts.extend([title_text, body_text])
        elif title_text:
            content_parts.append(title_text)
        elif body_text:
            content_parts.append(body_text)

        return self.build_text_with_tags("\n\n".join([part for part in content_parts if part]))

    def build_x_post_text(self):
        if self.has_article_doc():
            article_text = self.build_article_doc_plain_text()
            return self.build_text_with_tags("\n\n".join([part for part in [self.title.strip() if self.title else "", article_text] if part]))
        content_parts = []
        if self.title:
            content_parts.append(self.title.strip())
        if self.text:
            content_parts.append(self.text.strip())
        return self.build_text_with_tags("\n\n".join([part for part in content_parts if part]))

    def build_weibo_post_text(self):
        if self.has_article_doc():
            article_text = self.build_article_doc_plain_text()
            return self.build_text_with_tags("\n\n".join([part for part in [self.title.strip() if self.title else "", article_text] if part]))
        content_parts = []
        if self.title:
            content_parts.append(self.title.strip())
        if self.text:
            content_parts.append(self.text.strip())
        return self.build_text_with_tags("\n\n".join([part for part in content_parts if part]))

    def build_weibo_article_body(self):
        if self.has_article_doc():
            return self.build_text_with_tags(self.build_article_doc_plain_text())
        return self.build_text_with_tags((self.text or "").strip())

    def build_weibo_article_lead(self):
        lead_source = " ".join((self.text or "").replace("\n", " ").split())
        if not lead_source:
            return ""
        return lead_source[:44]

    def build_douban_post_text(self):
        if self.has_article_doc():
            article_text = self.build_article_doc_plain_text()
            return self.build_text_with_tags("\n\n".join([part for part in [self.title.strip() if self.title else "", article_text] if part]))
        content_parts = []
        if self.title:
            content_parts.append(self.title.strip())
        if self.text:
            content_parts.append(self.text.strip())
        return self.build_text_with_tags("\n\n".join([part for part in content_parts if part]))

    def build_douban_article_body(self):
        if self.has_article_doc():
            return self.build_text_with_tags(self.build_article_doc_plain_text())
        return self.build_text_with_tags((self.text or "").strip())

    def build_tieba_body(self):
        if self.has_article_doc():
            return self.build_text_with_tags(self.build_article_doc_plain_text())
        return self.build_text_with_tags((self.text or "").strip())

    def build_omqq_article_body(self):
        if self.has_article_doc():
            return self.build_text_with_tags(self.build_article_doc_plain_text())
        return self.build_text_with_tags((self.text or "").strip())

    def build_wangyi_article_body(self):
        if self.has_article_doc():
            return self.build_text_with_tags(self.build_article_doc_plain_text())
        return self.build_text_with_tags((self.text or "").strip())

    def get_article_blocks(self):
        if self._normalized_article_blocks is not None:
            return self._normalized_article_blocks

        blocks = []
        raw_blocks = []
        if isinstance(self.article_doc, dict):
            raw_blocks = self.article_doc.get("blocks", [])

        if isinstance(raw_blocks, list):
            for item in raw_blocks:
                if not isinstance(item, dict):
                    continue
                block_type = str(item.get("type") or "").strip().lower()
                if block_type not in {"paragraph", "heading", "quote", "image", "divider"}:
                    continue
                block = {"type": block_type}
                if block_type == "heading":
                    try:
                        block["level"] = int(item.get("level") or 2)
                    except Exception:
                        block["level"] = 2
                if block_type in {"paragraph", "heading", "quote"}:
                    block["text"] = str(item.get("text") or "").strip()
                elif block_type == "image":
                    block["assetPath"] = str(item.get("assetPath") or "").strip()
                    block["caption"] = str(item.get("caption") or "").strip()
                    block["externalUrl"] = str(item.get("externalUrl") or "").strip()
                blocks.append(block)

        self._normalized_article_blocks = blocks
        return blocks

    def has_article_doc(self):
        return len(self.get_article_blocks()) > 0

    def article_doc_supports_image_upload(self):
        return (
            self.platform_name in {"sohu", "wechat_official", "csdn", "jianshu", "zhihu", "tieba", "omqq", "wangyi_mp"}
            and (self.content_mode or "article") in {"article", "thread"}
        )

    def resolve_article_asset_path(self, asset_path):
        if not asset_path:
            return None
        path = Path(asset_path)
        if path.is_absolute():
            return path
        return Path(BASE_DIR / "videoFile" / asset_path)

    def build_article_doc_plain_text(self):
        content_parts = []
        for block in self.get_article_blocks():
            block_type = block.get("type")
            if block_type == "divider":
                content_parts.append("────────")
                continue
            if block_type == "image":
                caption = (block.get("caption") or "").strip()
                if caption:
                    content_parts.append(caption)
                continue
            text = (block.get("text") or "").strip()
            if text:
                content_parts.append(text)
        return "\n\n".join(content_parts).strip()

    def get_article_doc_image_blocks(self):
        return [block for block in self.get_article_blocks() if block.get("type") == "image"]

    def get_tags_list(self):
        if isinstance(self.tags, (list, tuple)):
            return [str(tag).strip().lstrip("#") for tag in self.tags if str(tag).strip()]
        if isinstance(self.tags, str):
            return [tag.strip().lstrip("#") for tag in self.tags.split(",") if tag.strip()]
        return []

    async def prepare_toutiao_page(self, page):
        await page.wait_for_timeout(1000)
        blocker_error = await self.get_toutiao_account_blocker_error(page)
        if blocker_error:
            self.last_publish_error = blocker_error
            raise Exception(blocker_error)
        await self.dismiss_toutiao_tip(page)
        blocker_error = await self.get_toutiao_account_blocker_error(page)
        if blocker_error:
            self.last_publish_error = blocker_error
            raise Exception(blocker_error)

    async def wait_for_visible_locator(self, page, selector_list, timeout=None):
        timeout_ms = self.page_load_timeout if timeout is None else max(int(timeout), 0)
        deadline = time.monotonic() + (timeout_ms / 1000 if timeout_ms else 0)

        while True:
            for selector in selector_list:
                locator = page.locator(selector)
                try:
                    count = await locator.count()
                except Exception:
                    continue

                for index in range(count):
                    candidate = locator.nth(index)
                    try:
                        if await candidate.is_visible():
                            return candidate
                    except Exception:
                        continue

            if timeout_ms <= 0 or time.monotonic() >= deadline:
                break
            await page.wait_for_timeout(500)

        return None

    async def prepare_csdn_page(self, page):
        current_url = (page.url or "").lower()
        if "passport.csdn.net" in current_url or "/login" in current_url:
            raise Exception("CSDN 账号登录态已过期，请到账号管理重新授权")

        await self.dismiss_csdn_tip(page)
        title_trigger = await self.wait_for_visible_locator(
            page,
            ['div.article-bar__title-display', 'input.article-bar__title--input'],
            timeout=self.page_load_timeout,
        )
        if not title_trigger:
            raise Exception("未找到 CSDN 标题区域")

        try:
            tag_name = await title_trigger.evaluate("el => el.tagName.toLowerCase()")
        except Exception:
            tag_name = ""

        if tag_name != "input":
            await title_trigger.click(force=True)
            await page.wait_for_timeout(self.wait_timeout_500ms)

        title_input = await self.wait_for_visible_locator(
            page,
            ['input.article-bar__title--input'],
            timeout=self.page_load_timeout,
        )
        if not title_input:
            raise Exception("未找到可用的 CSDN 标题输入框")

        editor = await self.wait_for_visible_locator(
            page,
            ['pre.editor__inner[contenteditable="true"]'],
            timeout=self.page_load_timeout,
        )
        if not editor:
            raise Exception("未找到可用的 CSDN 正文编辑器")
        await page.wait_for_timeout(1000)

    async def prepare_jianshu_page(self, page):
        current_url = (page.url or "").lower()
        if "jianshu.com/sign_in" in current_url or "signin" in current_url or "/login" in current_url:
            raise Exception("简书账号登录态已过期，请到账号管理重新授权")

        if "/writer" not in current_url:
            await page.goto("https://www.jianshu.com/writer", wait_until="domcontentloaded", timeout=self.page_load_timeout)
            await page.wait_for_timeout(1500)
            current_url = (page.url or "").lower()
            if "jianshu.com/sign_in" in current_url or "signin" in current_url or "/login" in current_url:
                raise Exception("简书账号登录态已过期，请到账号管理重新授权")

        title_selectors = self.article_title_locators or ['input._24i7u', 'input[placeholder*="标题"]']
        body_selectors = self.article_textbox_selectors or ['div.kalamu-area[contenteditable="true"]']

        # 简书打开 writer 时常停留在旧笔记上，“发布”按钮会变成“更新”或直接消失。
        # 先强制新建一篇，再填标题正文。不要点「新建文集」左侧的 fa-plus。
        new_article_selectors = [
            'div._1GsW5',
            'i.fa-plus-circle',
            'span:has-text("新建文章")',
            'a:has-text("新建文章")',
            'button:has-text("新建文章")',
            '[role="button"]:has-text("新建文章")',
        ]
        note_id_before = self.extract_jianshu_note_id(page.url)
        new_article_trigger = await self.wait_for_visible_locator(page, new_article_selectors, timeout=5000)
        if new_article_trigger:
            await new_article_trigger.click(force=True)
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                note_id_after = self.extract_jianshu_note_id(page.url)
                if note_id_after and note_id_after != note_id_before:
                    self.logger.info(f"简书已新建文章: {note_id_before or '-'} -> {note_id_after}")
                    break
                await page.wait_for_timeout(300)
            else:
                raise Exception("简书未能新建文章，已停止发布以免覆盖已有笔记")
            await page.wait_for_timeout(800)
        else:
            raise Exception("未找到简书新建文章入口，已停止发布以免覆盖已有笔记")

        current_url = (page.url or "").lower()
        if "jianshu.com/sign_in" in current_url or "signin" in current_url or "/login" in current_url:
            raise Exception("简书账号登录态已过期，请到账号管理重新授权")

        title_input = await self.wait_for_visible_locator(page, title_selectors, timeout=self.page_load_timeout)
        if not title_input:
            raise Exception("未找到简书标题输入框")

        body_input = await self.wait_for_visible_locator(page, body_selectors, timeout=self.page_load_timeout)
        if not body_input:
            raise Exception("未找到简书正文编辑器")
        try:
            await page.wait_for_selector('a[data-action="publicize"]', state="attached", timeout=8000)
        except Exception:
            self.logger.warning("简书发布按钮尚未出现在 DOM，发布时会再尝试点击")
        await page.wait_for_timeout(1000)

    async def prepare_zhihu_page(self, page):
        verification_ready = await self.handle_zhihu_security_verification(page)
        if not verification_ready:
            raise Exception(self.last_publish_error or "知乎安全验证未完成")
        await page.wait_for_selector('textarea[placeholder*="请输入标题"]', timeout=self.page_load_timeout)
        await page.wait_for_selector('div.public-DraftEditor-content[contenteditable="true"]', timeout=self.page_load_timeout)
        await page.wait_for_timeout(1000)

    async def prepare_x_page(self, page):
        await page.wait_for_selector('[data-testid="tweetTextarea_0"]', timeout=self.page_load_timeout)
        await page.wait_for_timeout(1000)

    async def wait_douban_editor_ready(self, page, article_mode=False):
        if article_mode:
            await page.wait_for_selector('textarea[placeholder="请输入标题"]', timeout=self.page_load_timeout)

        open_trigger = page.locator('text=此刻你想要分享...').first
        try:
            if await open_trigger.count() > 0 and await open_trigger.is_visible():
                await open_trigger.click(force=True)
                await page.wait_for_timeout(1000)
        except Exception:
            pass

        await page.wait_for_selector('div.DRE-inputor.DRE-root[contenteditable="true"]', timeout=self.page_load_timeout)
        await page.wait_for_selector('button:has-text("发布")', timeout=self.page_load_timeout)
        await page.wait_for_timeout(1000)

    async def prepare_douban_page(self, page):
        await self.wait_douban_editor_ready(page, article_mode=self.is_douban_article_mode())

    async def prepare_tieba_page(self, page):
        if not self.forum_name:
            raise Exception("贴吧缺少目标吧名称")

        try:
            open_button = page.locator('text=发表新贴').first
            if await open_button.count() > 0 and await open_button.is_visible():
                await open_button.click(force=True)
                await page.wait_for_timeout(1000)
        except Exception:
            pass

        await page.wait_for_selector('input.j_title', timeout=self.page_load_timeout)
        await page.wait_for_selector('div.edui-body-container[contenteditable="true"]', timeout=self.page_load_timeout)
        await page.wait_for_selector('.j_submit', timeout=self.page_load_timeout)
        await page.wait_for_timeout(1000)

    async def prepare_omqq_page(self, page):
        await page.wait_for_selector('.omui-articletitle__input1 .omui-inputautogrowing__inner', timeout=self.page_load_timeout)
        await page.wait_for_selector('div.ProseMirror.ExEditor-basic[contenteditable="true"]', timeout=self.page_load_timeout)
        await page.wait_for_timeout(1000)

    async def prepare_wangyi_page(self, page):
        await page.wait_for_selector('textarea[placeholder="请输入标题 (5~30个字)"]', timeout=self.page_load_timeout)
        await page.wait_for_selector('div.public-DraftEditor-content[contenteditable="true"]', timeout=self.page_load_timeout)
        await page.wait_for_selector('button.primary_button:has-text("发布")', timeout=self.page_load_timeout)
        await page.wait_for_timeout(1000)

    async def wait_weibo_article_editor_ready(self, page):
        try:
            await page.wait_for_selector('.editor-spin', state='hidden', timeout=15000)
        except Exception:
            pass

        await page.wait_for_selector('textarea[placeholder="请输入标题"]', timeout=self.page_load_timeout)
        await page.wait_for_selector('div.ProseMirror[contenteditable="true"]', timeout=self.page_load_timeout)
        await page.wait_for_timeout(1000)

    async def prepare_weibo_page(self, page):
        if self.is_weibo_article_mode():
            await self.wait_weibo_article_editor_ready(page)

            write_article_button = page.locator('button:has-text("写文章")').first
            try:
                if await write_article_button.count() > 0 and await write_article_button.is_visible():
                    await write_article_button.click(force=True)
                    await page.wait_for_timeout(2000)
                    await self.wait_weibo_article_editor_ready(page)
                    self.logger.info("微博文章页已切到新的草稿编辑态")
            except Exception as e:
                self.logger.warning(f"微博文章页切换新草稿失败，继续沿用当前编辑页: {str(e)}")
                await self.wait_weibo_article_editor_ready(page)
            return

        await page.wait_for_selector('textarea[placeholder*="新鲜事"]', timeout=self.page_load_timeout)
        await page.wait_for_timeout(1000)

    async def get_x_publish_button(self):
        fallback_button = None
        for selector in ['[data-testid="tweetButton"]', '[data-testid="tweetButtonInline"]']:
            locator = self.locator_base.locator(selector)
            try:
                count = await locator.count()
            except Exception:
                continue

            for index in range(count):
                candidate = locator.nth(index)
                try:
                    await candidate.wait_for(state="visible", timeout=2000)
                    if not await candidate.is_visible():
                        continue

                    if fallback_button is None:
                        fallback_button = candidate

                    disabled_attr = await candidate.get_attribute("disabled")
                    aria_disabled = await candidate.get_attribute("aria-disabled")
                    if disabled_attr is None and aria_disabled not in {"true", "True"}:
                        self.logger.info(f"找到 X 可用发布按钮: {selector}")
                        return candidate
                except Exception:
                    continue

        if fallback_button:
            self.logger.info("未找到可用的 X 发布按钮，返回首个可见按钮作为兜底")
        return fallback_button

    async def get_douban_publish_button(self):
        fallback_button = None
        locator = self.locator_base.locator('button:has-text("发布")')
        try:
            count = await locator.count()
        except Exception:
            count = 0

        for index in range(count):
            candidate = locator.nth(index)
            try:
                await candidate.wait_for(state="visible", timeout=2000)
                if not await candidate.is_visible():
                    continue

                if fallback_button is None:
                    fallback_button = candidate

                disabled_attr = await candidate.get_attribute("disabled")
                aria_disabled = await candidate.get_attribute("aria-disabled")
                if disabled_attr is None and aria_disabled not in {"true", "True"}:
                    self.logger.info("找到豆瓣可用发布按钮")
                    return candidate
            except Exception:
                continue

        return fallback_button

    async def get_weibo_publish_button(self):
        if self.is_weibo_article_mode():
            fallback_button = None
            for selector in ['button:has-text("发布")', 'button:has-text("发表")', 'button:has-text("下一步")']:
                locator = self.locator_base.locator(selector)
                try:
                    count = await locator.count()
                except Exception:
                    count = 0

                for index in range(count):
                    candidate = locator.nth(index)
                    try:
                        await candidate.wait_for(state="visible", timeout=2000)
                        if not await candidate.is_visible():
                            continue

                        if fallback_button is None:
                            fallback_button = candidate

                        disabled_attr = await candidate.get_attribute("disabled")
                        aria_disabled = await candidate.get_attribute("aria-disabled")
                        if disabled_attr is None and aria_disabled not in {"true", "True"}:
                            self.logger.info(f"找到微博文章可用按钮: {selector}")
                            return candidate
                    except Exception:
                        continue

            return fallback_button

        fallback_button = None
        locator = self.locator_base.locator('button:has-text("发送")')
        try:
            count = await locator.count()
        except Exception:
            count = 0

        for index in range(count):
            candidate = locator.nth(index)
            try:
                await candidate.wait_for(state="visible", timeout=2000)
                if not await candidate.is_visible():
                    continue

                if fallback_button is None:
                    fallback_button = candidate

                disabled_attr = await candidate.get_attribute("disabled")
                aria_disabled = await candidate.get_attribute("aria-disabled")
                if disabled_attr is None and aria_disabled not in {"true", "True"}:
                    self.logger.info("找到微博可用发送按钮")
                    return candidate
            except Exception:
                continue

        if fallback_button:
            self.logger.info("未找到可用微博发送按钮，返回首个可见按钮作为兜底")
        return fallback_button

    async def is_weibo_security_page(self, page):
        verification_markers = [
            'text=请先验证身份',
            'text=向右拖动滑块填充拼图',
            'text=刷新'
        ]

        current_url = page.url or ""
        if "security.weibo.com/captcha" in current_url:
            return True

        for selector in verification_markers:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    return True
            except Exception:
                continue
        return False

    async def handle_weibo_security_verification(self, page):
        if not self.is_weibo_platform() or not self.manual_verification_enabled:
            return True

        try:
            if not await self.is_weibo_security_page(page):
                return True

            if self.headless:
                self.last_publish_error = "微博触发身份验证，需要在可视化浏览器中手动完成验证后再继续"
                return False

            self.logger.warning("微博触发身份验证，请在浏览器中手动完成滑块或身份验证，完成后流程会自动继续")
            waited_ms = 0
            max_wait_ms = 300000

            while waited_ms < max_wait_ms:
                if not await self.is_weibo_security_page(page):
                    await page.wait_for_timeout(1500)
                    return True
                await page.wait_for_timeout(1500)
                waited_ms += 1500

            self.last_publish_error = "微博身份验证等待超时，请完成验证后重新发起发布"
            return False
        except Exception as e:
            self.last_publish_error = f"微博身份验证处理失败: {str(e)}"
            return False

    async def get_weibo_profile_url(self, page):
        selectors = [
            'a[href^="/u/"]',
            'a[href*="//weibo.com/u/"]',
            'a[href*="/u/"]'
        ]

        for selector in selectors:
            locator = page.locator(selector)
            try:
                count = await locator.count()
            except Exception:
                count = 0

            for index in range(count):
                candidate = locator.nth(index)
                try:
                    href = (await candidate.get_attribute("href") or "").strip()
                    if not href:
                        continue
                    if href.startswith("//"):
                        return f"https:{href}"
                    if href.startswith("/"):
                        return f"https://weibo.com{href}"
                    if href.startswith("http"):
                        return href
                except Exception:
                    continue

        return ""

    async def verify_weibo_profile_contains(self, page, marker):
        profile_url = await self.get_weibo_profile_url(page)
        if not profile_url or not marker:
            return False

        verify_page = None
        try:
            verify_page = await page.context.new_page()
            await verify_page.goto(profile_url, wait_until='domcontentloaded', timeout=self.page_load_timeout)

            normalized_marker = " ".join(marker.replace("\xa0", " ").split())
            for _ in range(4):
                await verify_page.wait_for_timeout(2500)
                body_text = " ".join((await verify_page.locator('body').inner_text()).replace("\xa0", " ").split())
                if normalized_marker in body_text:
                    self.logger.info("微博个人主页已检索到刚发布的内容")
                    self.set_result_url(profile_url, url_type="manage", label="查看主页")
                    return True
                await verify_page.reload(wait_until='domcontentloaded', timeout=self.page_load_timeout)
            return False
        except Exception as e:
            self.logger.warning(f"微博个人主页核验失败: {str(e)}")
            return False
        finally:
            if verify_page:
                await verify_page.close()

    async def verify_douban_home_contains(self, page, marker):
        if not marker:
            return False

        verify_page = None
        try:
            verify_page = await page.context.new_page()
            await verify_page.goto("https://www.douban.com/", wait_until='domcontentloaded', timeout=self.page_load_timeout)

            normalized_marker = " ".join(marker.replace("\xa0", " ").split())
            for _ in range(4):
                await verify_page.wait_for_timeout(2500)
                body_text = " ".join((await verify_page.locator('body').inner_text()).replace("\xa0", " ").split())
                if normalized_marker in body_text:
                    self.logger.info("豆瓣首页已检索到刚发布的内容")
                    self.set_result_url("https://www.douban.com/", url_type="manage", label="查看主页")
                    return True
                await verify_page.reload(wait_until='domcontentloaded', timeout=self.page_load_timeout)
            return False
        except Exception as e:
            self.logger.warning(f"豆瓣首页核验失败: {str(e)}")
            return False
        finally:
            if verify_page:
                await verify_page.close()

    async def verify_tieba_bar_contains(self, page, marker):
        if not marker or not self.forum_name:
            return False

        verify_page = None
        try:
            verify_page = await page.context.new_page()
            await verify_page.goto(self.build_tieba_bar_url(), wait_until='domcontentloaded', timeout=self.page_load_timeout)

            normalized_marker = " ".join(marker.replace("\xa0", " ").split())
            for _ in range(4):
                await verify_page.wait_for_timeout(2500)
                body_text = " ".join((await verify_page.locator('body').inner_text()).replace("\xa0", " ").split())
                if normalized_marker in body_text:
                    self.logger.info("贴吧列表页已检索到刚发布的帖子")
                    self.set_result_url(self.build_tieba_bar_url(), url_type="manage", label="查看贴吧")
                    return True
                await verify_page.reload(wait_until='domcontentloaded', timeout=self.page_load_timeout)
            return False
        except Exception as e:
            self.logger.warning(f"贴吧列表页核验失败: {str(e)}")
            return False
        finally:
            if verify_page:
                await verify_page.close()

    async def get_tieba_publish_error(self, page):
        try:
            body_text = (await page.locator('body').inner_text()).replace("\xa0", " ")
        except Exception:
            body_text = ""

        if "验证码" in body_text or "开始验证" in body_text:
            return "贴吧触发了验证码或安全验证，请先在浏览器里完成验证"

        messages = [
            "标题不能为空",
            "内容不能为空",
            "发贴频繁",
            "发帖频繁",
            "请稍后再试",
            "系统繁忙",
            "帖子含有敏感内容",
            "请输入标题",
            "请输入内容",
        ]
        for message in messages:
            if message in body_text:
                return message
        return ""

    async def is_zhihu_security_page(self, page):
        verification_markers = [
            'text=进入知乎',
            'text=开始验证',
            'text=网络环境存在异常',
            'text=请稍后重试'
        ]
        for selector in verification_markers:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    return True
            except Exception:
                continue
        return False

    async def handle_zhihu_security_verification(self, page):
        if not self.is_zhihu_platform() or not self.manual_verification_enabled:
            return True

        try:
            if not await self.is_zhihu_security_page(page):
                return True

            if self.headless:
                self.last_publish_error = "知乎触发安全验证，需要在可视化浏览器中人工完成验证后再继续"
                return False

            self.logger.warning("知乎触发安全验证，请在浏览器中手动完成验证，完成后流程会自动继续")
            reloaded_once = False
            max_wait_ms = 300000
            waited_ms = 0

            while waited_ms < max_wait_ms:
                title_ready = page.locator('textarea[placeholder*="请输入标题"]').first
                body_ready = page.locator('div.public-DraftEditor-content[contenteditable="true"]').first
                try:
                    if await title_ready.count() > 0 and await title_ready.is_visible():
                        return True
                    if await body_ready.count() > 0 and await body_ready.is_visible():
                        return True
                except Exception:
                    pass

                body_text = ""
                try:
                    body_text = (await page.locator('body').inner_text()).replace("\xa0", " ")
                except Exception:
                    body_text = ""

                if "正在加载，请稍后重试" in body_text and not reloaded_once:
                    self.logger.info("知乎验证组件加载异常，自动刷新一次页面后继续等待人工验证")
                    await page.reload(wait_until='domcontentloaded', timeout=self.page_load_timeout)
                    reloaded_once = True
                    await page.wait_for_timeout(1500)
                    waited_ms += 1500
                    continue

                await page.wait_for_timeout(1500)
                waited_ms += 1500

            self.last_publish_error = "知乎安全验证未在 5 分钟内完成，请先在浏览器中完成验证后重试"
            return False
        except Exception as e:
            self.last_publish_error = f"知乎安全验证处理失败: {str(e)}"
            return False

    async def dismiss_toutiao_tip(self, page):
        blocker_error = await self.get_toutiao_account_blocker_error(page)
        if blocker_error:
            self.last_publish_error = blocker_error
            self.logger.warning(f"头条账号不可发布，跳过关闭提示弹层: {blocker_error}")
            return

        await self.dismiss_toutiao_ai_assistant(page)
        try:
            tip_button = page.locator('button:has-text("我知道了")').first
            if await tip_button.count() > 0 and await tip_button.is_visible():
                nearby_text = ""
                try:
                    nearby_text = await tip_button.evaluate(
                        """(el) => {
                            const root = el.closest('.byte-modal, .byte-dialog, .byte-message, .byte-toast, [class*="modal"], [class*="dialog"]') || el.parentElement;
                            return ((root && (root.innerText || root.textContent)) || '').replace(/\\s+/g, ' ').trim();
                        }"""
                    )
                except Exception:
                    nearby_text = ""
                if self.match_toutiao_account_restriction(nearby_text):
                    self.last_publish_error = self.match_toutiao_account_restriction(nearby_text)
                    self.logger.warning(f"头条禁言/封禁提示未关闭，终止发布: {self.last_publish_error}")
                    return
                await tip_button.click()
                await page.wait_for_timeout(self.wait_timeout_500ms)
                self.logger.info("头条提示弹层已关闭")
        except Exception as e:
            self.logger.warning(f"关闭头条提示弹层失败，继续后续流程: {str(e)}")

    async def dismiss_toutiao_ai_assistant(self, page):
        """
        头条文章页会默认展开 AI 发文助手抽屉，遮挡编辑区和发布按钮。
        """
        close_selectors = [
            '.ai-assistant-drawer .close-btn',
            '.publish-assistant-old-drawer .container-close',
            '.container-close.btn.hide.empty',
            '.container-close-wrapper'
        ]
        for selector in close_selectors:
            try:
                close_button = page.locator(selector).first
                if await close_button.count() > 0:
                    await close_button.click(force=True)
                    await page.wait_for_timeout(self.wait_timeout_500ms)
                    self.logger.info(f"头条 AI 发文助手抽屉已关闭: {selector}")
                    return
            except Exception as e:
                self.logger.warning(f"关闭头条 AI 发文助手抽屉失败，继续尝试其他选择器: {str(e)}")
        try:
            drawer_mask = page.locator('.byte-drawer-mask')
            if await drawer_mask.count() > 0:
                await page.evaluate(
                    """() => {
                        document.querySelectorAll('.byte-drawer-mask').forEach((node) => node.remove());
                        document.querySelectorAll('.publish-assistant-old-drawer, .ai-assistant-drawer').forEach((node) => {
                            node.style.pointerEvents = 'none';
                        });
                    }"""
                )
                await page.wait_for_timeout(self.wait_timeout_500ms)
                self.logger.info("头条 AI 发文助手蒙层已移除")
        except Exception as e:
            self.logger.warning(f"移除头条 AI 发文助手蒙层失败，继续后续流程: {str(e)}")

    def is_toutiao_account_completion_message(self, text):
        normalized = " ".join(str(text or "").replace("\xa0", " ").split())
        if not normalized:
            return False
        required_phrases = [
            "请完善账号信息",
            "解锁发文文章、视频等权益功能",
        ]
        return all(phrase in normalized for phrase in required_phrases)

    def match_toutiao_account_restriction(self, text):
        normalized = " ".join(str(text or "").replace("\xa0", " ").split())
        if not normalized:
            return ""
        if self.is_toutiao_account_completion_message(normalized) or "头条号当前账号未完成资料完善" in normalized:
            return "头条号当前账号未完成资料完善，平台暂未开放文章/视频发文权限，请先在头条号后台点击“立即完善”补齐资料后再重试"

        restriction_rules = [
            (("已被禁言", "账号已被禁言", "账号禁言", "禁言中", "处于禁言", "禁言，无法"), "头条号当前账号已被禁言，无法继续发布，已跳过该账号"),
            (("已被封禁", "账号已封禁", "账号被封禁", "账号封禁"), "头条号当前账号已被封禁，无法继续发布，已跳过该账号"),
            (("已被封号", "账号已封号", "账号被封号"), "头条号当前账号已被封号，无法继续发布，已跳过该账号"),
            (("限制发布", "限制发文", "暂无发文权限", "没有发文权限", "无发文权限"), "头条号当前账号被限制发布，无法继续发布，已跳过该账号"),
            (("账号异常，无法", "功能受限", "停止使用"), "头条号当前账号异常，无法继续发布，已跳过该账号"),
        ]
        for phrases, message in restriction_rules:
            if any(phrase in normalized for phrase in phrases):
                return message
        return ""

    def is_toutiao_fatal_publish_error(self, message):
        return bool(self.match_toutiao_account_restriction(message))

    async def collect_toutiao_visible_notice_text(self, page):
        try:
            notices = await page.evaluate(
                """() => {
                    const isVisible = (el) => {
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        return style.display !== 'none'
                            && style.visibility !== 'hidden'
                            && style.opacity !== '0'
                            && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
                    };
                    const selectors = [
                        '.byte-modal',
                        '.byte-dialog',
                        '.byte-message',
                        '.byte-toast',
                        '.byte-notification',
                        '[class*="modal"]',
                        '[class*="toast"]',
                        '[class*="message"]',
                        '[class*="notification"]',
                        '[role="dialog"]',
                        '[role="alert"]'
                    ];
                    const result = [];
                    for (const selector of selectors) {
                        for (const el of Array.from(document.querySelectorAll(selector))) {
                            if (!isVisible(el)) continue;
                            const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
                            if (!text || text.length > 200) continue;
                            if (!result.includes(text)) result.push(text);
                            if (result.length >= 12) return result;
                        }
                    }
                    return result;
                }"""
            )
            return notices or []
        except Exception:
            return []

    async def get_toutiao_account_blocker_error(self, page):
        if not self.is_toutiao_platform():
            return ""

        for notice in await self.collect_toutiao_visible_notice_text(page):
            matched = self.match_toutiao_account_restriction(notice)
            if matched:
                return matched

        try:
            body_text = await page.locator('body').inner_text()
        except Exception:
            return ""
        return self.match_toutiao_account_restriction(body_text)

    async def get_toutiao_account_completion_error(self, page):
        return await self.get_toutiao_account_blocker_error(page)
    
    async def handle_instagram_login(self, page):
        """
        处理Instagram登录页面
        Args:
            page: Playwright页面对象
        """
        # 检查是否需要登录
        current_url = page.url
        self.logger.info(f"[+]Current URL: {current_url}")
        
        # 如果跳转到登录页面，尝试点击Instagram登录按钮
        if "loginpage" in current_url or "login" in current_url:
            self.logger.info("[+]检测到登录页面，尝试点击Instagram登录按钮")
            try:
                # 尝试查找并点击Instagram登录按钮
                # 支持中英文两种文本
                login_buttons = [
                    'div[role="button"]:has-text("使用 Instagram 登录")',
                    'div[role="button"]:has-text("Log in with Instagram")',
                    'button:has-text("使用 Instagram 登录")',
                    'button:has-text("Log in with Instagram")'
                ]
                
                login_button = None
                found_selector = ""
                for selector in login_buttons:
                    count = await page.locator(selector).count()
                    if count > 0:
                        login_button = page.locator(selector)
                        found_selector = selector
                        break
                
                if login_button:
                    self.logger.info(f"[+]找到Instagram登录按钮，选择器: {found_selector}")
                    await login_button.wait_for(state='visible', timeout=5000)
                    
                    # 监听新打开的页面
                    new_page = None
                    async with page.context.expect_page() as new_page_info:
                        await login_button.click()
                        self.logger.info("[+]已点击Instagram登录按钮，等待新页面打开")
                    # 等待新页面加载完成
                    new_page = await new_page_info.value
                    # await new_page.wait_for_load_state('domcontentloaded')
                    self.logger.info(f"[+]新页面已打开: {new_page.url}")
                    # 关闭新页面，回到原页面
                    await new_page.close()
                    # 重新加载原页面
                    await page.reload()
                    await asyncio.sleep(2)
            except Exception as e:
                self.logger.error(f"[+]点击Instagram登录按钮失败: {str(e)}")

    def is_headless_runtime(self):
        """当前是否无头执行（无窗口时不能等人工操作）。"""
        try:
            import sys as _sys
            conf = _sys.modules.get("conf")
            return bool(getattr(conf, "LOCAL_CHROME_HEADLESS", False)) if conf else False
        except Exception:
            return False

    @staticmethod
    def is_human_action_blocker(message):
        """短信/扫码/滑块这类必须本人在窗口里完成的验证。"""
        if not message:
            return False
        keywords = ("短信验证", "扫" + "码", "安全验证", "滑块", "登录")
        return any(k in message for k in keywords)

    async def wait_human_verification(self, page, blocker, timeout=None):
        """保留浏览器窗口，等用户在窗口里完成验证；通过后返回 True。

        默认最多等 5 分钟（可用环境变量 PUBLISH_STUDIO_HUMAN_WAIT 调整秒数）。
        """
        timeout = timeout or int(os.environ.get("PUBLISH_STUDIO_HUMAN_WAIT", "300"))
        self.logger.warning(f"需要本人操作：{blocker}")
        self.logger.warning(f"浏览器窗口会保持打开，请在窗口里完成验证；最长等待 {timeout} 秒，完成后自动继续发布")
        waited = 0
        while waited < timeout:
            await asyncio.sleep(3)
            waited += 3
            if waited % 15 == 0:
                self.logger.info(f"仍在等待人工验证…已等待 {waited}/{timeout} 秒")
            try:
                if await self.detect_common_blocker(page) is None:
                    return True
            except Exception:
                continue
        self.logger.warning("等待人工验证超时，本次未发出")
        return False

    async def detect_common_blocker(self, page):
        """识别平台拦截页/弹窗，返回客户能看懂的原因；没有拦截返回 None。

        覆盖：短信/扫码等本人验证、登录失效、实名、账号限发、限流、内容违规、滑块、封面缺失。
        """
        try:
            text = await page.inner_text("body")
        except Exception:
            return None
        if not text:
            return None
        rules = [
            (("为确保是本人操作", "接收短信验证码", "短信验证码"), "平台要求本人短信验证：请先在浏览器里登录该平台完成一次短信验证，再重新发送"),
            (("扫码登录", "登录已失效", "登录状态已失效", "请重新登录", "登录后继续"), "账号登录状态已失效：请到「平台账号」重新授权该账号后再发"),
            (("实名认证",), "账号未完成实名认证：请先在平台完成实名认证"),
            (("账号异常", "封禁", "禁止发布", "限制发布"), "账号被平台限制发布：请到平台查看账号状态与处罚通知"),
            (("操作频繁", "发布过于频繁", "请求频繁", "频率限制"), "平台限流：发布过于频繁，请间隔一段时间后再发"),
            (("内容违规", "审核未通过", "作品未通过", "违反社区"), "内容未通过平台审核：请修改文案或视频后重试"),
            (("拖动滑块", "滑块验证", "安全验证"), "平台触发了安全验证：请在浏览器里完成一次验证后再发"),
            (("请设置封面", "封面不能为空", "请上传封面"), "平台要求设置封面：请先在发布包里选好封面再发"),
        ]
        for keywords, message in rules:
            for kw in keywords:
                if kw in text:
                    return message
        return None

    async def confirm_douyin_detail_page(self, page):
        """抖音发布两步走：第一步进详情页，第二步点底部固定「发布」才真正提交。"""
        clicked = 0
        for _ in range(6):
            # 出现短信验证/登录失效等拦截时别再盲点「发布」
            blocker = await self.detect_common_blocker(page)
            if blocker:
                self.last_publish_error = blocker
                self.logger.error(blocker)
                return False
            if clicked >= 2:
                return True
            url = page.url or ""
            if "/content/post/" in url:
                try:
                    btn = page.locator("button.primary-cECiOJ").last
                    if await btn.count() and await btn.is_visible():
                        self.logger.info("  [-] 抖音详情页二次确认：点击底部「发布」")
                        clicked += 1
                        await btn.click(force=True)
                        await asyncio.sleep(5)
                        continue
                except Exception as e:
                    self.logger.warning(f"  [-] 抖音二次确认点击失败: {e}")
                    await asyncio.sleep(2)
                    continue
            break
        return True

    async def find_button(self, selector_list):
        """
        通用的按钮查找方法
        Args:
            selector_list: 所有可能的按钮选择器列表
        Returns:
            找到的按钮定位器对象，如果没找到则返回None
        """
        for selector in selector_list:
            locator = self.locator_base.locator(selector)
            try:
                count = await locator.count()
            except Exception:
                continue

            if count == 0:
                continue

            for index in range(count):
                candidate = locator.nth(index)
                try:
                    await candidate.wait_for(state="visible", timeout=2000)
                    if await candidate.is_visible():
                        self.logger.info(f"找到按钮定位器: {selector}, 是否可见: True")
                        return candidate
                except Exception:
                    continue

        # 如果所有选择器都没找到，返回None
        self.logger.info("未找到任何按钮定位器")
        return None

    async def prepare_tencent_page(self, page):
        """
        视频号助手直接打开 /platform/post/create 时偶发重定向回首页 /platform，
        这里统一等待登录态稳定并点击「发表视频」确保真正进入发表页。
        """
        for _ in range(8):
            cur = page.url or ""
            if "/login" in cur:
                raise Exception("视频号账号登录状态已失效，请到「平台账号」重新扫码登录")
            if self.file_type == 2 and "/post/create" in cur:
                # 等 wujie-app 渲染出上传输入框或上传区域
                try:
                    await page.locator('input[type="file"][accept*="video"], div.upload-content').first.wait_for(state="attached", timeout=10000)
                    return
                except Exception:
                    pass
            elif self.file_type == 1 and "/finderNewLifeCreate" in cur:
                return
            if self.file_type == 2 and "/post/create" not in cur:
                btn = page.locator('button:has-text("发表视频")').first
                try:
                    if await btn.count() > 0 and await btn.is_visible():
                        self.logger.info("视频号当前在首页，自动点击「发表视频」进入发表页")
                        await btn.click()
                        await asyncio.sleep(3)
                        continue
                except Exception:
                    pass
            await asyncio.sleep(1.5)

    async def inspect_tencent_upload_state(self, page):
        """
        穿透视频号 wujie-app Shadow DOM 检查真实的上传与「发表」按钮状态。
        """
        try:
            return await page.evaluate("""() => {
              const roots = [document];
              document.querySelectorAll('wujie-app').forEach(w => {
                if (w && w.shadowRoot) roots.push(w.shadowRoot);
              });
              let text = '';
              let hasVideoTag = false;
              let dropzoneVisible = false;
              let progressVisible = false;
              let publishFound = false;
              let publishDisabled = true;
              let publishCls = '';
              for (const root of roots) {
                try {
                  const t = (root.body ? root.body.innerText : root.textContent) || '';
                  if (t) text += '\\n' + t;
                } catch {}
                try {
                  if (root.querySelector('video')) hasVideoTag = true;
                } catch {}
                try {
                  const dz = root.querySelector('.ant-upload-drag, div.upload-content');
                  if (dz) {
                    const r = dz.getBoundingClientRect();
                    if (r.width > 40 && r.height > 40) dropzoneVisible = true;
                  }
                } catch {}
                try {
                  const prog = root.querySelector('.ant-progress, [class*="progress-bar"], [class*="upload-progress"]');
                  if (prog) {
                    const r = prog.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) progressVisible = true;
                  }
                } catch {}
                try {
                  root.querySelectorAll('button').forEach(btn => {
                    const label = (btn.innerText || '').trim();
                    if (label === '发表' && !publishFound) {
                      const cls = String(btn.className || '');
                      if (cls.includes('weui-desktop-btn_primary')) {
                        publishFound = true;
                        publishCls = cls;
                        publishDisabled = Boolean(
                          btn.disabled
                          || btn.getAttribute('disabled') !== null
                          || cls.includes('disabled')
                          || btn.getAttribute('aria-disabled') === 'true'
                        );
                      }
                    }
                  });
                } catch {}
              }
              const flat = text.replace(/\\s+/g, ' ');
              const isUploading = progressVisible || /上传中|正在上传|转码中|处理中|取消上传|校验中/.test(flat);
              const hasUploadError = /上传失败|格式不支持|不支持此视频格式|建议上传H\.264|视频时长|超过限制|文件过大/.test(flat);
              const hasVideoControl = hasVideoTag || /更换视频|重新上传|编辑封面|视频预览|裁剪封面|删除/.test(flat);
              const dropzoneEmpty = dropzoneVisible && !isUploading && !hasVideoControl;
              const publishSuccess = /发表成功|发布成功/.test(flat);
              return {
                url: location.href,
                publishFound,
                publishDisabled,
                publishCls,
                isUploading,
                hasUploadError,
                hasVideo: hasVideoControl,
                dropzoneVisible,
                dropzoneEmpty,
                publishSuccess,
              };
            }""")
        except Exception as e:
            self.logger.warning(f"检测视频号上传状态异常: {str(e)}")
            return {}

    async def upload_tencent_video(self, page, upload_payload):
        """
        视频号视频上传专用：优先直接向 wujie-app 里的 video input[type=file] 注入文件，
        并核实上传区确实开始上传；若未触发再回退点击 .upload-content 走文件选择器。
        """
        await asyncio.sleep(2)
        input_selectors = [
            'input[type="file"][accept*="video"]',
            '.ant-upload-btn input[type="file"]',
            'input[type="file"]',
        ]
        # 方式 1：直接 set_input_files（Playwright 自动穿透 wujie-app open Shadow DOM）
        for sel in input_selectors:
            loc = self.locator_base.locator(sel)
            try:
                if await loc.count() > 0:
                    await loc.first.set_input_files(upload_payload)
                    self.logger.info(f"视频号通过文件输入框({sel})注入视频: {self.get_file_log_path()}")
                    await asyncio.sleep(3)
                    st = await self.inspect_tencent_upload_state(page)
                    self.logger.info(f"视频号注入后状态: {st}")
                    if st and not st.get("dropzoneEmpty"):
                        return True
                    break
            except Exception as e:
                self.logger.warning(f"视频号直接注入({sel})异常，将尝试文件选择器: {str(e)}")

        # 方式 2：点击上传区触发系统文件选择器
        for btn_sel in ['div.upload-content', 'span.add-icon.weui-icon-outlined-add']:
            loc = self.locator_base.locator(btn_sel)
            try:
                if await loc.count() > 0 and await loc.first.is_visible():
                    self.logger.info(f"视频号尝试点击({btn_sel})触发文件选择器")
                    async with page.expect_file_chooser(timeout=15000) as fc_info:
                        await loc.first.click()
                    fc = await fc_info.value
                    await fc.set_files(upload_payload)
                    self.logger.info(f"视频号通过文件选择器注入视频: {self.get_file_log_path()}")
                    await asyncio.sleep(3)
                    st = await self.inspect_tencent_upload_state(page)
                    self.logger.info(f"视频号文件选择器注入后状态: {st}")
                    if st and not st.get("dropzoneEmpty"):
                        return True
            except Exception as e:
                self.logger.warning(f"视频号文件选择器({btn_sel})异常: {str(e)}")

        # 方式 3：检查子 frame 里的 input[type=file]
        for frame in page.frames:
            if frame == page.main_frame:
                continue
            try:
                floc = frame.locator('input[type="file"][accept*="video"], input[type="file"]')
                if await floc.count() > 0:
                    await floc.first.set_input_files(upload_payload)
                    self.logger.info(f"视频号通过子frame注入视频: {self.get_file_log_path()}")
                    await asyncio.sleep(3)
                    st = await self.inspect_tencent_upload_state(page)
                    self.logger.info(f"视频号子frame注入后状态: {st}")
                    if st and not st.get("dropzoneEmpty"):
                        return True
            except Exception:
                continue

        self.logger.error("视频号视频未能触发上传（上传区仍为空），停止继续发布")
        return False

    async def upload_video_file(self, page):
        """
        作用：上传视频文件
        网页中相关按钮：上传视频文件的按钮元素为（）
        返回：是否上传成功
        """
        try:
            if self.platform_name == "tencent" and self.file_type == 2:
                upload_payload = self.get_upload_file_payload()
                if not upload_payload:
                    raise Exception("缺少待上传文件")
                return await self.upload_tencent_video(page, upload_payload)
            if self.platform_name == "sohu" and self.file_type == 1:
                return await self.upload_sohu_article_image(page)
            if self.is_wechat_official_platform() and self.file_type == 1:
                return await self.upload_wechat_official_article_image(page)
            if self.is_csdn_platform() and self.file_type == 1 and self.file_path:
                return await self.upload_csdn_article_image(page)
            if self.is_jianshu_platform() and self.file_type == 1 and self.file_path:
                return await self.upload_jianshu_article_image(page)
            if self.is_zhihu_platform() and self.file_type == 1 and self.file_path:
                return await self.upload_zhihu_article_image(page)
            if self.is_tieba_platform() and self.file_type == 1 and self.file_path:
                return await self.upload_tieba_image(page)
            if self.is_omqq_platform() and self.file_type == 1 and self.file_path:
                return await self.upload_omqq_article_image(page)
            if self.is_wangyi_platform() and self.file_type == 1 and self.file_path:
                return await self.upload_wangyi_article_image(page)

            upload_payload = self.get_upload_file_payload()
            if not upload_payload:
                raise Exception("缺少待上传文件")

            # 使用find_button方法查找上传按钮，支持中文和英文界面
            await asyncio.sleep(self.check_interval)
            await asyncio.sleep(5)
            direct_file_input = await self.find_file_input(self.direct_file_input_selectors)
            if direct_file_input:
                await direct_file_input.set_input_files(upload_payload)
                self.logger.info(f"通过页面文件输入框上传文件: {self.get_file_log_path()}")
                return True

            upload_button = await self.find_button(self.upload_button_selectors)
            if not upload_button:
                file_input_button = await self.find_file_input(self.file_input_selector)
                if file_input_button:
                    await file_input_button.set_input_files(upload_payload)
                    self.logger.info(f"通过兜底文件输入框上传文件: {self.get_file_log_path()}")
                    return True
                raise Exception("未找到上传图文/视频按钮")
            self.logger.info("  [-] 将点击上传图文/视频按钮")
            await upload_button.wait_for(state='visible', timeout=self.button_visible_timeout)
            
            # 上传按钮，需要点击触发系统文件选择器
            try:
                async with page.expect_file_chooser() as fc_info:
                    await upload_button.click()
                file_chooser = await fc_info.value
                await file_chooser.set_files(upload_payload)
                self.logger.info(f"通过系统文件选择器上传文件: {self.get_file_log_path()}")
                return True
            except Exception:
                file_input_button = await self.find_file_input(self.file_input_selector)
                if file_input_button:
                    await file_input_button.set_input_files(upload_payload)
                    self.logger.info(f"通过点击失败后的文件输入框上传文件: {self.get_file_log_path()}")
                    return True
                raise
        except Exception as e:
            self.logger.error(f"选择图文/视频文件失败: {str(e)}")
            return False

    async def find_file_input(self, selector_list):
        """
        查找文件输入框，允许匹配隐藏的 input[type=file]
        """
        if not selector_list:
            return None

        for selector in selector_list:
            locator = self.locator_base.locator(selector)
            count = await locator.count()
            if count > 0:
                await locator.first.wait_for(state="attached", timeout=self.button_visible_timeout)
                self.logger.info(f"找到文件输入框定位器: {selector}")
                return locator.first

        self.logger.info("未找到任何文件输入框定位器")
        return None

    async def detect_upload_status(self, page):
        """
        作用：检测上传状态
        网页中相关按钮：发布按钮选择器（）
        返回：是否上传成功
        """
        while True:
            try:
                #快手平台比较特殊，没传完也可以点击发布按钮，需要等编辑画布按钮出现，才算是上传完毕
                if self.platform_name == "kuaishou":
                    number = await page.locator("text=上传中").count()
                    if number == 0:
                        self.logger.success("图文/视频上传完毕")
                        break
                    else:
                        self.logger.info("正在上传图文/视频中...")
                        await asyncio.sleep(self.check_interval)
                elif self.platform_name == "sohu" and self.file_type == 1:
                    article_image_uploaded = await page.locator('.ql-editor img, .ql-image-container img').count() > 0
                    if article_image_uploaded:
                        self.logger.info("搜狐图文图片上传完毕")
                        break
                    else:
                        self.logger.info("搜狐图文图片仍在插入中...")
                        await asyncio.sleep(self.check_interval)
                elif self.is_wechat_official_platform() and self.file_type == 1:
                    article_image_uploaded = (
                        await page.locator('div.ProseMirror img.js_insertlocalimg, div.ProseMirror img[data-upload="1"]').count()
                    ) > 0
                    if article_image_uploaded:
                        self.logger.info("公众号正文图片上传完毕")
                        break
                    else:
                        self.logger.info("公众号正文图片仍在插入中...")
                        await asyncio.sleep(self.check_interval)
                elif self.is_csdn_platform() and self.file_type == 1 and self.file_path:
                    editor_text = await self.get_csdn_editor_text(page)
                    image_uploaded = (
                        "![在这里插入图片描述](" in editor_text and "i-blog.csdnimg.cn" in editor_text
                    ) or await page.locator('img[src*="i-blog.csdnimg.cn"]').count() > 0
                    if image_uploaded:
                        self.logger.info("CSDN 正文图片上传完毕")
                        break
                    else:
                        self.logger.info("CSDN 正文图片仍在插入中...")
                        await asyncio.sleep(self.check_interval)
                elif self.is_jianshu_platform() and self.file_type == 1 and self.file_path:
                    image_uploaded = await page.locator('#editor img.uploaded-img, div.kalamu-area img.uploaded-img, #editor img').count() > 0
                    if image_uploaded:
                        self.logger.info("简书正文图片上传完毕")
                        break
                    else:
                        self.logger.info("简书正文图片仍在插入中...")
                        await asyncio.sleep(self.check_interval)
                elif self.is_zhihu_platform() and self.file_type == 1 and self.file_path:
                    image_uploaded = (
                        await page.locator(
                            'img.Editable-imageUploader-image, '
                            'img.Image[alt="图片"], '
                            'div.public-DraftEditor-content img'
                        ).count()
                    ) > 0
                    if image_uploaded:
                        self.logger.info("知乎正文图片上传完毕")
                        break
                    else:
                        self.logger.info("知乎正文图片仍在插入中...")
                        await asyncio.sleep(self.check_interval)
                elif self.is_x_platform() and self.file_path:
                    body_text = " ".join((await page.locator('body').inner_text()).replace("\xa0", " ").split())
                    attachments_visible = await page.locator('[data-testid="attachments"]').count() > 0
                    uploading = any(keyword in body_text for keyword in ["Uploading", "Processing", "Transcoding"])
                    if self.file_type == 2:
                        upload_success = attachments_visible and not uploading and (
                            "Uploaded (100%)" in body_text or await page.locator('video').count() > 0
                        )
                    else:
                        upload_success = attachments_visible and not uploading

                    if upload_success:
                        self.logger.info("X 媒体上传完毕")
                        break
                    else:
                        self.logger.info("X 媒体仍在上传处理中...")
                        await asyncio.sleep(self.check_interval)
                elif self.is_weibo_platform() and self.file_path:
                    body_text = " ".join((await page.locator('body').inner_text()).replace("\xa0", " ").split())
                    publish_button = await self.get_weibo_publish_button()
                    upload_blocked = any(keyword in body_text for keyword in ["上传中", "处理中", "转码中", "校验中"])

                    if publish_button and not await publish_button.is_disabled() and not upload_blocked:
                        self.logger.info("微博媒体上传完毕")
                        break
                    else:
                        self.logger.info("微博媒体仍在上传处理中...")
                        await asyncio.sleep(self.check_interval)
                elif self.is_douban_platform() and self.file_path:
                    body_text = " ".join((await page.locator('body').inner_text()).replace("\xa0", " ").split())
                    publish_button = await self.get_douban_publish_button()
                    preview_count = await page.locator('.DRE-upload-pad img, .DRE-media-editor img').count()
                    upload_blocked = any(keyword in body_text for keyword in ["上传中", "处理中"])

                    if publish_button and not await publish_button.is_disabled() and preview_count > 0 and not upload_blocked:
                        self.logger.info("豆瓣图片上传完毕")
                        break
                    else:
                        self.logger.info("豆瓣图片仍在上传处理中...")
                        await asyncio.sleep(self.check_interval)
                elif self.is_tieba_platform() and self.file_path:
                    image_uploaded = await page.locator(
                        'div.edui-body-container img, .poster_editor img, .poster_preview img'
                    ).count() > 0
                    if image_uploaded:
                        self.logger.info("贴吧图片上传完毕")
                        break
                    else:
                        self.logger.info("贴吧图片仍在上传处理中...")
                        await asyncio.sleep(self.check_interval)
                elif self.is_omqq_platform() and self.file_path:
                    body_text = " ".join((await page.locator('body').inner_text()).replace("\xa0", " ").split())
                    image_uploaded = await page.locator('div.ProseMirror.ExEditor-basic img').count() > 0
                    upload_blocked = any(keyword in body_text for keyword in ["上传中", "处理中", "请稍候"])
                    if image_uploaded and not upload_blocked:
                        self.logger.info("企鹅号正文图片上传完毕")
                        break
                    else:
                        self.logger.info("企鹅号正文图片仍在上传处理中...")
                        await asyncio.sleep(self.check_interval)
                elif self.is_wangyi_platform() and self.file_path:
                    body_text = " ".join((await page.locator('body').inner_text()).replace("\xa0", " ").split())
                    image_uploaded = await page.locator('div.public-DraftEditor-content img').count() > 0
                    dialog_visible = await page.locator('.ne-modal.picture-adder').count() > 0
                    upload_blocked = any(keyword in body_text for keyword in ["上传中", "处理中", "继续上传"])
                    if image_uploaded and not dialog_visible and not upload_blocked:
                        self.logger.info("网易号正文图片上传完毕")
                        break
                    else:
                        self.logger.info("网易号正文图片仍在上传处理中...")
                        await asyncio.sleep(self.check_interval)
                elif self.platform_name == "sohu":
                    upload_success = (
                        await page.locator("text=视频上传成功").count() > 0 or
                        await page.locator("text=上传成功").count() > 0 or
                        await page.locator("text=重新上传").count() > 0
                    )
                    if upload_success:
                        self.logger.info("图文/视频上传完毕")
                        break
                    else:
                        self.logger.info("正在上传图文/视频中...")
                        await asyncio.sleep(self.check_interval)
                elif self.is_toutiao_video_mode():
                    upload_success = await page.locator("text=上传成功").count() > 0
                    if upload_success:
                        self.logger.info("图文/视频上传完毕")
                        break
                    else:
                        self.logger.info("正在上传图文/视频中...")
                        await asyncio.sleep(self.check_interval)
                elif self.platform_name == "tencent" and self.file_type == 2:
                    started_at = time.time()
                    video_ready_since = None
                    empty_since = None
                    while True:
                        elapsed = time.time() - started_at
                        st = await self.inspect_tencent_upload_state(page)
                        if st.get("hasUploadError"):
                            self.logger.error(f"视频号上传报错，终止发布: {st}")
                            return False
                        if st.get("dropzoneEmpty"):
                            if empty_since is None:
                                empty_since = time.time()
                            elif time.time() - empty_since >= 15:
                                self.logger.error("视频号视频未成功添加到上传区（上传区持续为空）")
                                return False
                        else:
                            empty_since = None
                        is_uploading = bool(st.get("isUploading"))
                        has_video = bool(st.get("hasVideo"))
                        publish_disabled = bool(st.get("publishDisabled", True))
                        if not is_uploading and not st.get("dropzoneEmpty") and not publish_disabled:
                            self.logger.info(f"视频号视频上传并转码完毕（「发表」按钮已可点），耗时 {elapsed:.1f}s")
                            break
                        if not is_uploading and has_video:
                            if video_ready_since is None:
                                video_ready_since = time.time()
                            elif time.time() - video_ready_since >= 15:
                                self.logger.info(f"视频号视频已上传完成（预览就绪），进入填写文案阶段，耗时 {elapsed:.1f}s")
                                break
                        else:
                            video_ready_since = None
                        if elapsed >= 300:
                            self.logger.error(f"视频号视频上传超时(300s): {st}")
                            return False
                        if int(elapsed) % 6 < 3:
                            self.logger.info(
                                f"视频号正在上传/处理中({elapsed:.0f}s): uploading={is_uploading}, hasVideo={has_video}, publishDisabled={publish_disabled}"
                            )
                        await asyncio.sleep(3)
                    break
                elif self.is_xiaohongshu_platform() and self.file_type == 1:
                    expected_count = max(1, len(self.file_paths) or 0)
                    preview_count = await self.get_xiaohongshu_preview_count(page)
                    body_text = " ".join((await page.locator('body').inner_text()).replace("\xa0", " ").split())
                    upload_blocked = any(keyword in body_text for keyword in ["上传中", "处理中", "校验中", "继续上传"])

                    if preview_count >= expected_count and not upload_blocked:
                        self.logger.info(f"小红书图文上传完毕，预览图数量 {preview_count}/{expected_count}")
                        break
                    else:
                        self.logger.info(f"小红书图文仍在上传处理中，预览图数量 {preview_count}/{expected_count}")
                        await asyncio.sleep(self.check_interval)
                else:
                    # 其他平台，使用find_button方法查找发布按钮，发布按钮能点了就代表上传完毕了
                    publish_button = await self.find_button(self.publish_button_selectors)               
                    # 检查发布按钮是否可点击
                    if publish_button and await publish_button.get_attribute("disabled") is None:
                        self.logger.info("图文/视频上传完毕")
                        break
                    else:
                        self.logger.info("正在上传图文/视频中...")
                        await asyncio.sleep(self.check_interval)
                        # 检查是否有错误需要重试，使用中文和英文选择器
                        error_element = await self.find_button(self.error_selectors)
                        if error_element:
                            self.logger.info("  [-] found error while uploading now retry...")
                            await self.handle_upload_error(page)
            except Exception as e:
                self.logger.info(f"  [-] video uploading... Error: {str(e)}")
                await asyncio.sleep(self.check_interval)
                return False
        return True

    async def get_xiaohongshu_preview_count(self, page):
        selectors = [
            '.img-container img',
            '.image-preview img',
            '.content-center-image-container img',
            '[class*="upload"] img',
        ]
        counts = []
        for selector in selectors:
            try:
                counts.append(await page.locator(selector).count())
            except Exception:
                continue
        return max(counts or [0])

    async def handle_upload_error(self, page):
        """
        作用：处理上传错误，重新上传
        网页中相关按钮：系统文件管理器的上传按钮（input[type="file"]）
        返回：是否重新上传成功
        """
        try:
            self.logger.info("video upload error retrying.")
            upload_payload = self.get_upload_file_payload()
            if not upload_payload:
                return False

            file_input_button = await self.find_file_input(self.file_input_selector)
            if file_input_button:
                await file_input_button.set_input_files(upload_payload)
                self.logger.info(f"重新上传文件: {self.get_file_log_path()}")
                return True
        except Exception as e:
            self.logger.error(f"重新上传失败: {str(e)}")
            return False

    async def upload_sohu_article_image(self, page):
        """
        搜狐图文页通过富文本编辑器弹窗上传正文图片。
        """
        try:
            await self.dismiss_sohu_article_tip(page)
            upload_button = page.locator('button.ql-image').first
            await upload_button.wait_for(state='visible', timeout=self.button_visible_timeout)
            await upload_button.click()
            await page.wait_for_timeout(self.wait_timeout_500ms)

            file_input = page.locator('input[type="file"]').first
            await file_input.wait_for(state='attached', timeout=self.button_visible_timeout)
            await file_input.set_input_files(self.file_path)

            await page.wait_for_selector('.success-number', timeout=self.page_load_timeout)
            confirm_button = page.locator('p.button.positive-button').filter(has_text='确定').first
            await confirm_button.wait_for(state='visible', timeout=self.button_visible_timeout)
            await confirm_button.click()
            await page.wait_for_timeout(1000)
            return True
        except Exception as e:
            self.logger.error(f"搜狐图文正文图片上传失败: {str(e)}")
            return False

    async def upload_wechat_official_article_image(self, page):
        """
        公众号文章正文图片需要先展开工具栏里的“图片”菜单，再上传本地图片。
        """
        try:
            editor = page.locator('div.ProseMirror[contenteditable="true"]').first
            await editor.wait_for(state='visible', timeout=self.button_visible_timeout)
            await editor.click()
            await page.wait_for_timeout(self.wait_timeout_500ms)

            image_menu = page.locator('li#js_editor_insertimage').first
            await image_menu.wait_for(state='visible', timeout=self.button_visible_timeout)
            await image_menu.click()
            await page.wait_for_timeout(self.wait_timeout_500ms)

            file_input = page.locator('li#js_editor_insertimage input[type="file"]').first
            await file_input.wait_for(state='attached', timeout=self.button_visible_timeout)
            await file_input.set_input_files(self.file_path)
            await page.wait_for_timeout(1000)
            return True
        except Exception as e:
            self.logger.error(f"公众号正文图片上传失败: {str(e)}")
            return False

    async def upload_csdn_article_image(self, page):
        """
        CSDN 文章页通过工具栏“图片”按钮触发隐藏 file input 上传正文图片。
        """
        try:
            await self.dismiss_csdn_tip(page)
            editor = page.locator('pre.editor__inner[contenteditable="true"]').first
            await editor.wait_for(state='visible', timeout=self.button_visible_timeout)
            await editor.click()
            await page.wait_for_timeout(self.wait_timeout_500ms)

            upload_button = page.locator('button[data-title*="图片"]').first
            await upload_button.wait_for(state='visible', timeout=self.button_visible_timeout)
            await upload_button.click()
            await page.wait_for_timeout(self.wait_timeout_500ms)

            file_input = page.locator('input[type="file"][accept*="image/"]').last
            await file_input.wait_for(state='attached', timeout=self.button_visible_timeout)
            await file_input.set_input_files(self.file_path)
            await page.wait_for_timeout(1000)
            return True
        except Exception as e:
            self.logger.error(f"CSDN 正文图片上传失败: {str(e)}")
            return False

    async def upload_jianshu_article_image(self, page):
        """
        简书文章页通过工具栏“图片”按钮打开弹窗，再使用隐藏 input 上传正文图片。
        """
        try:
            editor = page.locator('div.kalamu-area[contenteditable="true"]').first
            await editor.wait_for(state='visible', timeout=self.button_visible_timeout)
            await editor.click()
            await page.wait_for_timeout(self.wait_timeout_500ms)

            upload_button = page.locator('a[data-action="openImageModal"]').first
            await upload_button.wait_for(state='visible', timeout=self.button_visible_timeout)
            await upload_button.click()
            await page.wait_for_timeout(self.wait_timeout_500ms)

            file_input = page.locator('#kalamu-upload-image').first
            await file_input.wait_for(state='attached', timeout=self.button_visible_timeout)
            await file_input.set_input_files(self.file_path)
            await page.wait_for_timeout(1000)
            return True
        except Exception as e:
            self.logger.error(f"简书正文图片上传失败: {str(e)}")
            return False

    async def upload_zhihu_article_image(self, page):
        """
        知乎文章页通过工具栏“图片”按钮展开上传面板，再使用隐藏 file input 上传正文图片。
        """
        try:
            editor = page.locator('div.public-DraftEditor-content[contenteditable="true"]').first
            await editor.wait_for(state='visible', timeout=self.button_visible_timeout)
            await editor.click()
            await page.wait_for_timeout(self.wait_timeout_500ms)

            upload_button = page.locator('button[aria-label="图片"]').first
            await upload_button.wait_for(state='visible', timeout=self.button_visible_timeout)
            await upload_button.click()
            await page.wait_for_timeout(self.wait_timeout_500ms)

            file_input = page.locator('input[type="file"][accept*="image/webp"]').first
            await file_input.wait_for(state='attached', timeout=self.button_visible_timeout)
            await file_input.set_input_files(self.file_path)
            await page.wait_for_timeout(1000)
            return True
        except Exception as e:
            self.logger.error(f"知乎正文图片上传失败: {str(e)}")
            return False

    async def upload_tieba_image(self, page):
        """
        贴吧发帖通过富文本工具栏里的“图片”按钮上传正文图片。
        """
        try:
            editor = page.locator('div.edui-body-container[contenteditable="true"]').first
            await editor.wait_for(state='visible', timeout=self.button_visible_timeout)
            await editor.click()
            await page.wait_for_timeout(self.wait_timeout_500ms)

            upload_button = page.locator('.edui-btn.edui-btn-image, .edui-for-image').first
            await upload_button.wait_for(state='visible', timeout=self.button_visible_timeout)
            await upload_button.click(force=True)
            await page.wait_for_timeout(self.wait_timeout_500ms)

            file_input = None
            for selector in [
                '.poster_editor input[type="file"]',
                '.edui-dialog input[type="file"]',
                'input[type="file"]'
            ]:
                locator = page.locator(selector).last
                try:
                    if await locator.count() > 0:
                        await locator.wait_for(state='attached', timeout=self.button_visible_timeout)
                        file_input = locator
                        break
                except Exception:
                    continue

            if file_input is None:
                raise Exception("未找到贴吧图片上传输入框")

            await file_input.set_input_files(self.file_path)
            await page.wait_for_timeout(1000)
            return True
        except Exception as e:
            self.logger.error(f"贴吧正文图片上传失败: {str(e)}")
            return False

    async def upload_omqq_article_image(self, page):
        """
        企鹅号文章页通过编辑器图片工具打开弹窗，再切到“本地上传”完成正文图片插入。
        """
        try:
            editor = page.locator('div.ProseMirror.ExEditor-basic[contenteditable="true"]').first
            await editor.wait_for(state='visible', timeout=self.button_visible_timeout)
            await editor.click()
            await page.wait_for_timeout(self.wait_timeout_500ms)

            upload_button = page.locator('exeditor-toolbar-button[data-toolbar-item-of="imagePlugin"]').first
            await upload_button.wait_for(state='visible', timeout=self.button_visible_timeout)
            await upload_button.click(force=True)
            await page.wait_for_timeout(self.wait_timeout_500ms)

            local_tab = page.locator('.omui-dialog :text("本地上传")').first
            if await local_tab.count() > 0 and await local_tab.is_visible():
                await local_tab.click(force=True)
                await page.wait_for_timeout(self.wait_timeout_500ms)

            file_input = None
            for selector in [
                '.omui-dialog input[type="file"][accept*="image/"]',
                '.omui-dialog input[type="file"]'
            ]:
                locator = page.locator(selector).last
                try:
                    if await locator.count() > 0:
                        await locator.wait_for(state='attached', timeout=self.button_visible_timeout)
                        file_input = locator
                        break
                except Exception:
                    continue

            if file_input is None:
                raise Exception("未找到企鹅号图片上传输入框")

            await file_input.set_input_files(self.file_path)
            await page.wait_for_timeout(1500)

            confirm_button = page.locator('.omui-dialog button:has-text("确认")').last
            if await confirm_button.count() > 0 and await confirm_button.is_visible():
                await confirm_button.click(force=True)
                await page.wait_for_timeout(1000)
            return True
        except Exception as e:
            self.logger.error(f"企鹅号正文图片上传失败: {str(e)}")
            return False

    async def upload_wangyi_article_image(self, page):
        """
        网易号文章页通过富文本工具栏图片按钮打开“本地上传”弹层，再确认插入正文。
        """
        try:
            editor = page.locator('div.public-DraftEditor-content[contenteditable="true"]').first
            await editor.wait_for(state='visible', timeout=self.button_visible_timeout)
            await editor.click()
            await page.wait_for_timeout(self.wait_timeout_500ms)

            upload_button = page.locator('button.rich-editor-panel-item:has(img[src*="icon_image"])').first
            await upload_button.wait_for(state='visible', timeout=self.button_visible_timeout)
            await upload_button.click(force=True)
            await page.wait_for_timeout(self.wait_timeout_500ms)

            modal = page.locator('.ne-modal.picture-adder').first
            await modal.wait_for(state='visible', timeout=self.button_visible_timeout)

            file_input = page.locator('input[type="file"][accept*="image/gif"]').last
            await file_input.wait_for(state='attached', timeout=self.button_visible_timeout)
            await file_input.set_input_files(self.file_path)
            await page.wait_for_timeout(3000)

            confirm_button = modal.locator('button.s-confirm-btn').filter(has_text='确定').first
            await confirm_button.wait_for(state='visible', timeout=self.button_visible_timeout)

            deadline = asyncio.get_event_loop().time() + 20
            while asyncio.get_event_loop().time() < deadline:
                if not await confirm_button.is_disabled():
                    break
                await page.wait_for_timeout(500)
            if await confirm_button.is_disabled():
                raise Exception("网易号图片弹层确认按钮仍不可点击")

            await confirm_button.click(force=True)
            await modal.wait_for(state='hidden', timeout=self.page_load_timeout)
            await page.wait_for_timeout(1000)
            return True
        except Exception as e:
            self.logger.error(f"网易号正文图片上传失败: {str(e)}")
            return False
    
    async def add_title_tags(self, page):
        """
        作用：添加标题和标签
        网页中相关按钮：添加标题和标签的按钮选择器（）
        返回：是否添加成功
        """
        try:
            if self.is_toutiao_platform():
                return await self.add_toutiao_content(page)
            if self.is_weibo_article_mode():
                return await self.add_weibo_article_content(page)
            if self.is_douban_platform():
                return await self.add_douban_content(page)
            if self.is_tieba_platform():
                return await self.add_tieba_content(page)
            if self.is_omqq_platform():
                return await self.add_omqq_content(page)
            if self.is_wangyi_platform():
                return await self.add_wangyi_content(page)
            if self.is_x_platform():
                post_text = self.build_x_post_text()
                if post_text:
                    textbox_button = await self.find_button(self.textbox_selectors)
                    if not textbox_button:
                        raise Exception("未找到推文输入框")
                    await self.replace_text(textbox_button, page, post_text)
                return True
            if self.is_weibo_platform():
                post_text = self.build_weibo_post_text()
                if post_text:
                    textbox_button = await self.find_button(self.textbox_selectors)
                    if not textbox_button:
                        raise Exception("未找到微博输入框")
                    await self.replace_text(textbox_button, page, post_text)
                return True
            if self.platform_name == "baijiahao":
                await self.dismiss_baijiahao_title_tip(page)
            if self.platform_name == "sohu" and self.file_type == 1:
                await self.dismiss_sohu_article_tip(page)
            if self.is_csdn_platform():
                await self.dismiss_csdn_tip(page)

            body_text = self.text
            title_filled = False

            # 输入标题
            if self.title_supported and self.title:
                # 使用find_button方法定位标题输入框，支持中文和英文界面
                editor_button = await self.find_button(self.editor_button_locators)
                if not editor_button:
                    # 发布页渲染有延迟（抖音/小红书等），轮询等待标题框出现
                    for _ in range(8):
                        await asyncio.sleep(2)
                        editor_button = await self.find_button(self.editor_button_locators)
                        if editor_button:
                            break
                if not editor_button:
                    if self.platform_name == "tencent":
                        self.logger.warning("视频号当前未定位到独立标题输入框，将尝试把标题并入正文首行")
                    else:
                        raise Exception("未找到标题输入框")
                else:
                    title_to_fill = self.title
                    if self.platform_name == "tencent":
                        # 视频号短标题规则：仅支持书名号、引号、冒号、加号、问号、百分号、摄氏度，逗号用空格代替，6-16字
                        cleaned = re.sub(r'[,，、;；|｜—–·•]+', ' ', str(self.title or ''))
                        cleaned = re.sub(r'[^\u4e00-\u9fffA-Za-z0-9\s《》"\'“”‘’:：+?？%℃]', '', cleaned)
                        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
                        if len(cleaned) > 16:
                            cleaned = cleaned[:16].strip()
                        if len(cleaned) < 6:
                            cleaned = ''
                        title_to_fill = cleaned
                    if title_to_fill:
                        self.logger.info(f"  [-] 将点击标题输入框: {await editor_button.text_content()} -> {title_to_fill}")
                        await self.replace_text(editor_button, page, title_to_fill)
                        title_filled = True
                    else:
                        self.logger.info("  [-] 视频号短标题清洗后不足6字，跳过选填短标题以免触发校验拦截")

            if self.platform_name == "tencent" and self.title and not title_filled:
                normalized_body_text = str(body_text or "").strip()
                if normalized_body_text:
                    if not normalized_body_text.startswith(self.title):
                        body_text = f"{self.title}\n{normalized_body_text}"
                else:
                    body_text = self.title

            # 输入正文
            if self.textbox_supported and body_text:
                textbox_button = await self.find_button(self.textbox_selectors)
                if not textbox_button:
                    for _ in range(8):
                        await asyncio.sleep(2)
                        textbox_button = await self.find_button(self.textbox_selectors)
                        if textbox_button:
                            break
                if not textbox_button:
                    if self.platform_name == "baijiahao":
                        self.logger.warning("百家号当前页面未提供可见的正文输入框，跳过正文填写")
                    else:
                        raise Exception("未找到正文输入框")
                else:
                    self.logger.info(f"  [-] 将点击正文输入框: {await textbox_button.text_content()}")
                    preview_text = str(body_text or "").replace("\r\n", "\n").replace("\r", "\n")
                    preview_text = " / ".join([item.strip() for item in preview_text.split("\n") if item.strip()])[:200]
                    self.logger.info(f"{self.platform_name} 正文预览：{preview_text}")
                    await self.replace_text(textbox_button, page, body_text)
            
            # 输入标签（跟在正文后面）
            normalized_tags = self.get_tags_list()
            if self.tags_supported and normalized_tags:
                await page.keyboard.press("Enter")
                await page.keyboard.press("Enter")
                    
                for index, tag in enumerate(normalized_tags, start=1):
                    self.logger.info("Setting the %s tag" % index)
                    await page.keyboard.insert_text(f"#{tag} ")
                    # 等待300毫秒
                    await page.wait_for_timeout(self.wait_timeout_500ms)
            return True
        except Exception as e:
            self.logger.error(f"Failed to add title, text and tags: {str(e)}")
            return False

    async def add_douban_content(self, page):
        await self.wait_douban_editor_ready(page, article_mode=self.is_douban_article_mode())

        if self.is_douban_article_mode():
            if not self.title:
                raise Exception("豆瓣日记缺少标题")

            title_input = await self.find_button(self.article_title_locators)
            if not title_input:
                raise Exception("未找到豆瓣日记标题输入框")
            await self.replace_text(title_input, page, self.title)

            article_body = self.build_douban_article_body()
            if not article_body:
                raise Exception("豆瓣日记缺少正文内容")

            body_input = await self.find_button(self.article_textbox_selectors)
            if not body_input:
                raise Exception("未找到豆瓣日记正文输入框")
            await self.replace_text(body_input, page, article_body)
            return True

        post_text = self.build_douban_post_text()
        if not post_text:
            raise Exception("豆瓣广播缺少正文内容")

        textbox_button = await self.find_button(self.textbox_selectors)
        if not textbox_button:
            raise Exception("未找到豆瓣广播输入框")
        await self.replace_text(textbox_button, page, post_text)
        return True

    async def add_weibo_article_content(self, page):
        await self.wait_weibo_article_editor_ready(page)

        if not self.title:
            raise Exception("微博文章缺少标题")

        title_input = await self.find_button(self.article_title_locators)
        if not title_input:
            raise Exception("未找到微博文章标题输入框")
        await self.replace_text(title_input, page, self.title)

        lead_text = self.build_weibo_article_lead()
        if lead_text and self.article_lead_locators:
            lead_input = await self.find_button(self.article_lead_locators)
            if lead_input:
                await self.replace_text(lead_input, page, lead_text)

        article_body = self.build_weibo_article_body()
        if not article_body:
            raise Exception("微博文章缺少正文内容")

        body_input = await self.find_button(self.article_textbox_selectors)
        if not body_input:
            raise Exception("未找到微博文章正文输入框")
        await self.replace_text(body_input, page, article_body)

        try:
            await page.wait_for_timeout(1000)
            body_text = (await body_input.inner_text()).strip()
            if not body_text:
                raise Exception("微博文章正文输入后仍为空")
        except Exception as e:
            raise Exception(f"微博文章正文填写校验失败: {str(e)}")

        return True

    async def add_tieba_content(self, page):
        if not self.title:
            raise Exception("贴吧帖子缺少标题")

        title_input = await self.find_button(self.article_title_locators)
        if not title_input:
            raise Exception("未找到贴吧标题输入框")
        await self.replace_text(title_input, page, self.title)

        tieba_body = self.build_tieba_body()
        if not tieba_body:
            raise Exception("贴吧帖子缺少正文内容")

        body_input = await self.find_button(self.article_textbox_selectors)
        if not body_input:
            raise Exception("未找到贴吧正文输入框")
        await self.replace_text(body_input, page, tieba_body)
        return True

    async def add_omqq_content(self, page):
        if not self.title:
            raise Exception("企鹅号文章缺少标题")

        title_input = await self.find_button(self.article_title_locators)
        if not title_input:
            raise Exception("未找到企鹅号标题输入框")
        await self.replace_text(title_input, page, self.title)

        article_body = self.build_omqq_article_body()
        if not article_body:
            raise Exception("企鹅号文章缺少正文内容")

        body_input = await self.find_button(self.article_textbox_selectors)
        if not body_input:
            raise Exception("未找到企鹅号正文输入框")
        await self.replace_text(body_input, page, article_body)
        return True

    async def add_wangyi_content(self, page):
        if not self.title:
            raise Exception("网易号文章缺少标题")

        title_input = await self.find_button(self.article_title_locators)
        if not title_input:
            raise Exception("未找到网易号标题输入框")
        await self.replace_text(title_input, page, self.title)

        article_body = self.build_wangyi_article_body()
        if not article_body:
            raise Exception("网易号文章缺少正文内容")

        body_input = await self.find_button(self.article_textbox_selectors)
        if not body_input:
            raise Exception("未找到网易号正文输入框")
        await self.replace_text(body_input, page, article_body)
        return True

    async def add_toutiao_content(self, page):
        """
        头条号支持三种内容模式：文章、视频、微头条。
        """
        await self.dismiss_toutiao_tip(page)

        mode = self.content_mode or ("video" if self.file_type == 2 else "article")

        if mode == "video":
            await self.ensure_toutiao_video_cover(page)
            await self.wait_toutiao_video_form_ready(page)

            if self.title:
                title_input = await self.find_button(self.video_title_locators)
                if not title_input:
                    raise Exception("未找到头条视频标题输入框")
                await self.replace_text(title_input, page, self.title)

            if self.text:
                text_input = await self.find_button(self.video_textbox_selectors)
                if not text_input:
                    self.logger.warning("未找到头条视频简介输入框，跳过简介填写")
                else:
                    await self.replace_text(text_input, page, self.text)

            if self.get_tags_list():
                await self.add_toutiao_video_tags(page)
            await self.ensure_toutiao_video_publish_options(page)
            return True

        if mode == "article":
            if self.title:
                title_input = await self.find_button(self.article_title_locators)
                if not title_input:
                    raise Exception("未找到头条文章标题输入框")
                await self.replace_text(title_input, page, self.title)

            article_body = self.build_toutiao_body_text(include_title=False)
            if article_body:
                body_input = await self.find_button(self.article_textbox_selectors)
                if not body_input:
                    raise Exception("未找到头条文章正文输入框")
                await self.replace_text(body_input, page, article_body)

            cover_ready = await self.ensure_toutiao_article_cover_mode(page)
            if not cover_ready:
                raise Exception(self.last_publish_error or "头条文章封面未准备完成")
            return True

        if mode == "weitoutiao":
            body_input = await self.find_button(self.weitoutiao_textbox_selectors)
            if not body_input:
                raise Exception("未找到头条微头条正文输入框")

            weitoutiao_body = self.build_toutiao_weitoutiao_text()
            if not weitoutiao_body:
                raise Exception("头条微头条缺少可发布内容")
            await self.replace_text(body_input, page, weitoutiao_body)
            return True

        raise Exception(f"未知的头条内容模式: {mode}")

    async def add_toutiao_video_tags(self, page):
        topic_input = await self.find_button(self.topic_input_selectors)
        if not topic_input:
            self.logger.warning("未找到头条视频话题输入框，跳过添加话题")
            return

        for clean_tag in self.get_tags_list():
            try:
                await topic_input.focus()
                await topic_input.fill(clean_tag)
                await page.wait_for_timeout(self.wait_timeout_500ms)
                await page.keyboard.press("Enter")
                await page.wait_for_timeout(self.wait_timeout_500ms)
            except Exception as e:
                self.logger.warning(f"头条视频话题输入失败，跳过剩余话题: {str(e)}")
                return

    async def ensure_toutiao_video_publish_options(self, page):
        """
        头条视频页默认不会自动勾选作品声明和可见范围，需要补齐一个最小可发布状态。
        """
        try:
            selected_statements = page.locator('.source-info-wrap input[type="checkbox"]:checked')
            if await selected_statements.count() == 0:
                statement_option = page.locator('label.byte-checkbox.checkbot-item').filter(has_text='自行拍摄').first
                if await statement_option.count() > 0:
                    await statement_option.click(force=True)
                    await page.wait_for_timeout(self.wait_timeout_500ms)
                    self.logger.info("头条视频作品声明已默认选择: 自行拍摄")

            selected_visibility = page.locator('.authority-info-wrap input[type="radio"]:checked')
            if await selected_visibility.count() == 0:
                visibility_option = page.locator('label.byte-radio').filter(has_text='公开').first
                if await visibility_option.count() > 0:
                    await visibility_option.click(force=True)
                    await page.wait_for_timeout(self.wait_timeout_500ms)
                    self.logger.info("头条视频可见范围已默认选择: 公开")
        except Exception as e:
            self.logger.warning(f"设置头条视频默认发布选项失败，继续尝试发布: {str(e)}")

    async def wait_toutiao_video_form_ready(self, page, timeout_ms=15000):
        """
        头条视频封面编辑完成后，页面有时会延迟回到主表单，显式等待标题输入框重新可用。
        """
        deadline = asyncio.get_event_loop().time() + timeout_ms / 1000

        while asyncio.get_event_loop().time() < deadline:
            try:
                await self.dismiss_toutiao_tip(page)

                title_input = await self.find_button(self.video_title_locators)
                visible_editor = page.locator(
                    '.xigua-image-editor-core:visible, '
                    '.m-dialog-edit:visible, '
                    '.Dialog-container .m-xigua-dialog.m-poster-upgrade:visible, '
                    '.Dialog-container .tc-ie-base:visible, '
                    '.byte-modal.resolution-warning-modal:visible'
                ).first
                editor_overlay_visible = await visible_editor.count() > 0

                if title_input and not editor_overlay_visible:
                    return True
            except Exception:
                pass

            await page.wait_for_timeout(1000)

        self.logger.warning("头条视频表单等待超时，继续尝试后续流程")
        return False

    async def wait_toutiao_portrait_cover_next_enabled(self, portrait_dialog, timeout_ms=6000):
        """
        竖版视频封面弹层需要先选中一张推荐封面，“下一步”才会从灰态变成可点击。
        """
        deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
        next_button = portrait_dialog.locator('.footer .m-button.red').first

        while asyncio.get_event_loop().time() < deadline:
            try:
                if await next_button.count() == 0:
                    return False
                class_name = (await next_button.get_attribute('class')) or ''
                if 'cannot-click' not in class_name:
                    return True
            except Exception:
                pass

            await asyncio.sleep(0.5)

        return False

    async def wait_toutiao_portrait_cover_candidates(self, portrait_dialog, timeout_ms=10000):
        """
        竖版视频推荐封面是异步渲染出来的，先等候候选列表出现。
        """
        deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
        thumbnails = portrait_dialog.locator('.m-server-bg-list .m-system-i')

        while asyncio.get_event_loop().time() < deadline:
            try:
                thumbnail_count = await thumbnails.count()
                if thumbnail_count > 0:
                    return thumbnails, thumbnail_count
            except Exception:
                pass

            await asyncio.sleep(0.5)

        return thumbnails, 0

    async def handle_toutiao_portrait_cover_dialog(self, page, portrait_dialog):
        """
        竖版视频会进入“封面截取/本地上传”的推荐封面面板，需要先选一张推荐封面。
        """
        selected_thumbnail = portrait_dialog.locator('.m-server-bg-list .m-system-i.selected')
        thumbnails, thumbnail_count = await self.wait_toutiao_portrait_cover_candidates(portrait_dialog)

        if thumbnail_count == 0:
            raise Exception("头条竖版视频封面弹层里没有可选的推荐封面")

        if await selected_thumbnail.count() == 0:
            preview_count = min(thumbnail_count, 3)
            for index in range(preview_count):
                candidate = thumbnails.nth(index)
                try:
                    await candidate.scroll_into_view_if_needed()
                    await candidate.click(force=True)
                    await page.wait_for_timeout(self.wait_timeout_500ms)
                    if await selected_thumbnail.count() > 0:
                        self.logger.info(f"头条竖版视频封面已选中第 {index + 1} 张推荐封面")
                        break
                except Exception as e:
                    self.logger.warning(f"头条竖版视频封面第 {index + 1} 次选图失败，继续尝试下一张: {str(e)}")

        if await selected_thumbnail.count() == 0:
            raise Exception("头条竖版视频封面未成功选中任何推荐图")

        if not await self.wait_toutiao_portrait_cover_next_enabled(portrait_dialog):
            raise Exception("头条竖版视频封面“下一步”按钮仍为灰态")

        next_button = portrait_dialog.locator('.footer .m-button.red').first
        await next_button.click(force=True)
        await page.wait_for_timeout(1500)
        self.logger.info("头条竖版视频封面推荐图已确认，进入下一步")

    async def handle_toutiao_cover_resolution_warning(self, page):
        """
        竖版封面确认后，头条可能提示“上传更清晰的封面”。保留当前封面时应点“取消”。
        """
        resolution_modal = page.locator('.byte-modal.resolution-warning-modal').first
        if await resolution_modal.count() == 0 or not await resolution_modal.is_visible():
            return

        cancel_button = resolution_modal.locator('button', has_text='取消').first
        close_button = resolution_modal.locator('.byte-modal-close-icon').first

        if await cancel_button.count() > 0 and await cancel_button.is_visible():
            await cancel_button.click(force=True)
        elif await close_button.count() > 0 and await close_button.is_visible():
            await close_button.click(force=True)
        else:
            raise Exception("头条低分辨率封面提示未找到关闭按钮")

        await page.wait_for_timeout(1000)
        self.logger.info("头条视频低分辨率封面提示已关闭，保留当前封面")

    async def handle_toutiao_video_publish_blockers(self, page):
        """
        头条视频点击发布后，可能再次弹出封面编辑器或低清晰度封面提示，需要先处理掉。
        """
        handled = False

        for _ in range(3):
            resolution_modal = page.locator('.byte-modal.resolution-warning-modal').first
            editor_dialog = page.locator('.Dialog-container .tc-ie-base').first
            generic_confirm = page.locator('.Dialog-container .m-button.red', has_text='确定').last
            confirm_button = page.locator('.Dialog-container .btn-sure', has_text='确定').last

            modal_visible = await resolution_modal.count() > 0 and await resolution_modal.is_visible()
            editor_visible = await editor_dialog.count() > 0 and await editor_dialog.is_visible()

            if modal_visible:
                await self.handle_toutiao_cover_resolution_warning(page)
                handled = True
                continue

            if await generic_confirm.count() > 0 and await generic_confirm.is_visible():
                await generic_confirm.click(force=True)
                await page.wait_for_timeout(1500)
                handled = True
                continue

            if editor_visible and await confirm_button.count() > 0 and await confirm_button.is_visible():
                await confirm_button.click(force=True)
                await page.wait_for_timeout(1500)
                handled = True
                continue

            break

        if handled:
            for selector in [
                '.Dialog-container .tc-ie-base',
                '.byte-modal.resolution-warning-modal'
            ]:
                try:
                    await page.locator(selector).first.wait_for(state='hidden', timeout=5000)
                except Exception:
                    pass

            self.logger.info("头条视频发布后拦截弹窗已处理完成")

        return handled

    async def ensure_toutiao_video_cover(self, page):
        """
        头条视频必须补一张封面，这里走平台内置的封面截取流程。
        """
        try:
            cover_required = page.locator('.video-form-item.form-item-poster .required').first
            cover_trigger = page.locator('.xigua-poster-editor').first
            if await cover_required.count() == 0 or await cover_trigger.count() == 0:
                return

            await cover_trigger.click(force=True)
            await page.wait_for_timeout(1000)

            cover_dialog = page.locator('.Dialog-container .m-xigua-dialog.m-poster-upgrade').first
            if await cover_dialog.count() == 0:
                self.logger.warning("头条视频封面截取弹层未出现，继续尝试发布")
                return

            portrait_dialog = page.locator('.Dialog-container .m-xigua-dialog.m-poster-upgrade.portrait').first
            if await portrait_dialog.count() > 0 and await portrait_dialog.is_visible():
                await self.handle_toutiao_portrait_cover_dialog(page, portrait_dialog)
            else:
                next_button = cover_dialog.locator('.m-button.red').first
                if await next_button.count() > 0:
                    await next_button.click(force=True)
                    await page.wait_for_timeout(1500)

            await self.handle_toutiao_video_publish_blockers(page)

            try:
                await page.locator('.Dialog-container .m-xigua-dialog.m-poster-upgrade').first.wait_for(state='hidden', timeout=10000)
            except Exception:
                pass

            try:
                await page.locator('.m-dialog-edit').first.wait_for(state='hidden', timeout=10000)
            except Exception:
                pass

            try:
                await page.locator('.xigua-image-editor-core').first.wait_for(state='hidden', timeout=10000)
            except Exception:
                pass

            try:
                await page.locator('.Dialog-container .tc-ie-base').first.wait_for(state='hidden', timeout=10000)
            except Exception:
                pass

            try:
                await page.locator('.byte-modal.resolution-warning-modal').first.wait_for(state='hidden', timeout=10000)
            except Exception:
                pass

            await page.wait_for_timeout(1000)
            self.logger.info("头条视频封面已通过内置截取流程生成")

            await self.dismiss_toutiao_tip(page)
            await self.wait_toutiao_video_form_ready(page)
        except Exception as e:
            self.logger.warning(f"设置头条视频封面失败，继续尝试发布: {str(e)}")

    async def get_toutiao_article_cover_state(self, page):
        try:
            state = await page.evaluate(
                """() => {
                    const isVisible = (el) => {
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        return style.display !== 'none'
                            && style.visibility !== 'hidden'
                            && style.opacity !== '0'
                            && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
                    };

                    const normalizeText = (value) => (value || '').replace(/\\s+/g, ' ').trim();
                    const options = Array.from(document.querySelectorAll('label'))
                        .filter((label) => {
                            if (!isVisible(label)) return false;
                            const text = normalizeText(label.innerText || label.textContent || '');
                            return ['单图', '三图', '无封面'].some((item) => text.includes(item));
                        })
                        .map((label) => {
                            const input = label.querySelector('input[type="radio"]');
                            return {
                                text: normalizeText(label.innerText || label.textContent || ''),
                                checked: !!(input && input.checked),
                                disabled: !!(input && input.disabled),
                                value: input ? (input.value || '') : '',
                                className: label.className || ''
                            };
                        });

                    const selected = options.find((item) => item.checked) || null;
                    const coverSection = Array.from(document.querySelectorAll('body *'))
                        .find((el) => isVisible(el) && normalizeText(el.innerText || el.textContent || '').includes('展示封面'));

                    return {
                        options,
                        selectedOptionText: selected ? selected.text : '',
                        coverSectionText: coverSection ? normalizeText(coverSection.innerText || coverSection.textContent || '').slice(0, 300) : ''
                    };
                }"""
            )
            return state or {"options": [], "selectedOptionText": "", "coverSectionText": ""}
        except Exception as e:
            self.logger.warning(f"读取头条文章封面状态失败: {str(e)}")
            return {"options": [], "selectedOptionText": "", "coverSectionText": ""}

    async def ensure_toutiao_article_cover_mode(self, page):
        """
        头条文章默认经常停在“单图”模式，未补封面就会卡在发布前。
        这里显式切到“无封面”，并校验 radio 状态，失败时直接给出明确提示。
        """
        try:
            cover_selectors = [
                'label:has(input[type="radio"][value="1"])',
                'label:has-text("无封面")',
                'span:has-text("无封面")',
            ]

            for selector in cover_selectors:
                no_cover = page.locator(selector).first
                if await no_cover.count() == 0 or not await no_cover.is_visible():
                    continue

                await no_cover.scroll_into_view_if_needed()
                await no_cover.click(force=True)
                await page.wait_for_timeout(self.wait_timeout_500ms)

                no_cover_radio = page.locator('input[type="radio"][value="1"]').first
                if await no_cover_radio.count() > 0:
                    try:
                        if await no_cover_radio.is_checked():
                            self.logger.info("头条文章封面模式已切换为无封面")
                            return True
                    except Exception:
                        pass

                cover_state = await self.get_toutiao_article_cover_state(page)
                if "无封面" in (cover_state.get("selectedOptionText") or ""):
                    self.logger.info("头条文章封面模式已切换为无封面")
                    return True

            cover_state = await self.get_toutiao_article_cover_state(page)
            validation_messages = await self.get_toutiao_validation_messages(page)
            cover_messages = [message for message in validation_messages if "封面" in message]

            if cover_messages:
                self.last_publish_error = "；".join(cover_messages[:3])
            else:
                selected_option = cover_state.get("selectedOptionText") or "未识别"
                self.last_publish_error = (
                    f"头条文章封面仍未准备完成，当前封面模式: {selected_option}。"
                    "请在任务里选择封面图，或切换为无封面后再发布"
                )

            cover_section_text = cover_state.get("coverSectionText") or ""
            if cover_section_text:
                self.logger.warning(f"头条文章封面区状态: {cover_section_text}")
            self.logger.warning(self.last_publish_error)
            return False
        except Exception as e:
            self.last_publish_error = f"设置头条文章无封面失败: {str(e)}"
            self.logger.warning(self.last_publish_error)
            return False

    async def handle_toutiao_sync_authorization(self, page):
        """
        头条首次发文后可能弹“作品同步授权”提示，关闭即可。
        """
        try:
            cancel_button = page.locator('button:has-text("取消")').first
            modal_title = page.locator('text=作品同步授权').first
            if await modal_title.count() > 0 and await modal_title.is_visible() and await cancel_button.count() > 0:
                await cancel_button.click()
                await page.wait_for_timeout(self.wait_timeout_500ms)
                self.logger.info("头条作品同步授权弹窗已关闭")
        except Exception as e:
            self.logger.warning(f"处理头条作品同步授权弹窗失败: {str(e)}")

    def is_page_or_context_closed_error(self, error):
        return "Target page, context or browser has been closed" in str(error)

    def get_toutiao_manage_urls(self):
        manage_urls = ["https://mp.toutiao.com/profile_v4/manage/content/all"]
        if self.content_mode == "article":
            manage_urls.insert(0, "https://mp.toutiao.com/profile_v4/graphic/articles")
        if self.content_mode == "video":
            manage_urls.insert(0, "https://mp.toutiao.com/profile_v4/xigua/content-manage-v2")
        if self.content_mode == "weitoutiao":
            manage_urls.insert(0, "https://mp.toutiao.com/profile_v4/weitoutiao")
        return manage_urls

    def pick_toutiao_article_result_url(self, item):
        if not isinstance(item, dict):
            return ""

        article_base = item.get("articleBase") if isinstance(item.get("articleBase"), dict) else item
        if not isinstance(article_base, dict):
            article_base = {}

        candidate_urls = [
            article_base.get("articleURL"),
            article_base.get("displayURL"),
            article_base.get("schema"),
            item.get("articleURL"),
            item.get("displayURL"),
            item.get("schema"),
        ]
        for candidate in candidate_urls:
            normalized = self.normalize_external_url(candidate)
            if normalized:
                return normalized

        gid = article_base.get("gidStr") or article_base.get("groupID") or item.get("gidStr") or item.get("groupID")
        gid = str(gid or "").strip()
        if gid:
            return f"https://www.toutiao.com/item/{gid}/"
        return ""

    async def fetch_toutiao_article_candidates(self, verify_page, offset=0, count=10, page_index=1):
        return await verify_page.evaluate(
            """async ({ offset, count, pageIndex }) => {
                const buildResult = (payload) => payload && typeof payload === 'object' ? payload : {};
                try {
                    const userInfoResp = await fetch(
                        'https://mp.toutiao.com/mp/agw/creator_center/user_info?app_id=1231',
                        {
                            method: 'GET',
                            credentials: 'include',
                            headers: {
                                'accept': 'application/json, text/plain, */*'
                            }
                        }
                    );
                    const userInfo = buildResult(await userInfoResp.json());
                    const visitedUid = String(
                        userInfo.user_id_str
                        || userInfo.user_id
                        || (userInfo.data && (userInfo.data.user_id_str || userInfo.data.user_id))
                        || ''
                    ).trim();

                    const params = new URLSearchParams({
                        provider_type: 'mp_provider',
                        aid: '13',
                        app_name: 'news_article',
                        category: 'mp_article',
                        channel: '',
                        stream_api_version: '88',
                        genre_type_switch: JSON.stringify({
                            repost: 1,
                            small_video: 1,
                            toutiao_graphic: 1,
                            weitoutiao: 1,
                            xigua_video: 1
                        }),
                        device_platform: 'pc',
                        platform_id: '0',
                        visited_uid: visitedUid,
                        offset: String(offset),
                        count: String(count),
                        keyword: '',
                        client_extra_params: JSON.stringify({
                            category: 'mp_article',
                            real_app_id: '1231',
                            need_forward: 'true',
                            offset_mode: '1',
                            page_index: String(pageIndex),
                            status: '0',
                            source: '0'
                        }),
                        app_id: '1231'
                    });

                    const response = await fetch(
                        `https://mp.toutiao.com/api/feed/mp_provider/v1/?${params.toString()}`,
                        {
                            method: 'GET',
                            credentials: 'include',
                            headers: {
                                'accept': 'application/json, text/plain, */*'
                            }
                        }
                    );
                    const payload = buildResult(await response.json());
                    const rawItems = Array.isArray(payload.data) ? payload.data : [];
                    const items = rawItems.map((entry) => {
                        const articleBase =
                            (entry && entry.assembleCell && entry.assembleCell.itemCell && entry.assembleCell.itemCell.articleBase)
                            || (entry && entry.itemCell && entry.itemCell.articleBase)
                            || entry.articleBase
                            || entry;
                        return {
                            title: articleBase && articleBase.title ? String(articleBase.title) : '',
                            articleURL: articleBase && articleBase.articleURL ? String(articleBase.articleURL) : '',
                            displayURL: articleBase && articleBase.displayURL ? String(articleBase.displayURL) : '',
                            schema: articleBase && articleBase.schema ? String(articleBase.schema) : '',
                            gidStr: articleBase && articleBase.gidStr ? String(articleBase.gidStr) : '',
                            groupID: articleBase && articleBase.groupID ? String(articleBase.groupID) : '',
                            articleBase
                        };
                    });
                    return {
                        ok: true,
                        visitedUid,
                        total: items.length,
                        items
                    };
                } catch (error) {
                    return {
                        ok: false,
                        error: error && error.message ? String(error.message) : String(error)
                    };
                }
            }""",
            {
                "offset": int(offset or 0),
                "count": int(count or 10),
                "pageIndex": int(page_index or 1),
            }
        )

    async def extract_toutiao_article_result_url(self, verify_page, expected_text, max_pages=3):
        if not (self.is_toutiao_platform() and (self.content_mode or "article") == "article"):
            return ""

        expected_normalized = self.normalize_match_text(expected_text)
        markers = self.build_text_match_markers(expected_text)
        if not expected_normalized or not markers:
            return ""

        page_size = 10
        fuzzy_matches = []
        for page_index in range(1, max_pages + 1):
            offset = (page_index - 1) * page_size
            try:
                payload = await self.fetch_toutiao_article_candidates(
                    verify_page,
                    offset=offset,
                    count=page_size,
                    page_index=page_index,
                )
            except Exception as e:
                self.logger.warning(f"请求头条作品列表接口失败: {str(e)}")
                continue

            if not payload or not payload.get("ok"):
                self.logger.warning(f"头条作品列表接口返回异常: {payload.get('error') if isinstance(payload, dict) else payload}")
                continue

            items = payload.get("items") or []
            for item in items:
                candidate_title = item.get("title") or ""
                candidate_normalized = self.normalize_match_text(candidate_title)
                if not candidate_normalized:
                    continue

                # 精确匹配优先：同日连发多篇标题前缀相似的文章时，模糊匹配会把别篇链接当成本篇
                if candidate_normalized == expected_normalized:
                    article_url = self.pick_toutiao_article_result_url(item)
                    if article_url:
                        self.logger.info(f"头条作品单篇链接精确匹配成功: {candidate_title} -> {article_url}")
                        self.set_result_url(article_url, url_type="published", label="查看文章", force=True)
                        return article_url
                elif self.text_matches_markers(candidate_title, markers):
                    fuzzy_matches.append(item)

            if len(items) < page_size:
                break

        # 前缀模糊匹配仅在唯一命中时才可信；命中多条时放弃提取，避免张冠李戴
        if len(fuzzy_matches) == 1:
            item = fuzzy_matches[0]
            article_url = self.pick_toutiao_article_result_url(item)
            if article_url:
                self.logger.info(f"头条作品单篇链接前缀唯一命中: {item.get('title')} -> {article_url}")
                self.set_result_url(article_url, url_type="published", label="查看文章", force=True)
                return article_url
        elif len(fuzzy_matches) > 1:
            titles = " | ".join(str(it.get("title") or "")[:30] for it in fuzzy_matches[:5])
            self.logger.warning(f"头条作品列表前缀命中 {len(fuzzy_matches)} 条且无精确匹配，放弃单篇链接提取: {titles}")

        return ""

    async def scan_toutiao_manage_page(self, verify_page, expected_text, manage_urls, timeout_ms=60000):
        markers = self.build_text_match_markers(expected_text)
        deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
        while asyncio.get_event_loop().time() < deadline:
            for manage_url in manage_urls:
                try:
                    await verify_page.goto(manage_url, wait_until='domcontentloaded', timeout=self.page_load_timeout)

                    # 列表接口优先：只依赖登录态、不依赖页面渲染，成功时可立即返回
                    if markers:
                        article_url = await self.extract_toutiao_article_result_url(verify_page, expected_text)
                        if article_url:
                            self.logger.info(f"头条作品管理页已提取单篇链接: {expected_text} @ {manage_url}")
                            return True

                    await verify_page.wait_for_timeout(1500)
                    await self.handle_toutiao_sync_authorization(verify_page)
                    await self.dismiss_toutiao_tip(verify_page)
                    blocker_error = await self.get_toutiao_account_blocker_error(verify_page)
                    if blocker_error:
                        self.last_publish_error = blocker_error
                        self.logger.warning(f"头条作品管理页检测到账号限制: {manage_url} {blocker_error}")
                        return False

                    if not markers:
                        continue

                    body_text = self.normalize_match_text(await verify_page.locator('body').inner_text())
                    if self.text_matches_markers(body_text, markers):
                        self.logger.info(f"头条作品管理页已检索到内容: {expected_text} @ {manage_url}")
                        self.set_result_url(manage_url, url_type="manage", label="查看后台")
                        return True
                except Exception as e:
                    self.logger.warning(f"核对头条作品管理页失败，重试中: {manage_url} {str(e)}")

            await verify_page.wait_for_timeout(2000)

        return False

    async def verify_toutiao_manage_contains_via_storage_state(self, expected_text, manage_urls, timeout_ms=20000):
        """
        如果原始发布页上下文提前关闭，回退到独立浏览器核对作品管理页。
        """
        account_path = Path(self.account_file)
        if not account_path.exists() or not account_path.is_file():
            self.logger.warning(f"头条独立核对失败，Cookie 文件不存在: {account_path}")
            return False

        try:
            async with async_playwright() as verify_playwright:
                browser = await verify_playwright.chromium.launch(
                    headless=True,
                    executable_path=self.local_executable_path,
                    proxy=self.proxy_config,
                )
                context = await browser.new_context(
                    storage_state=str(account_path),
                    locale=self.browser_lang,
                )
                if self.stealth_enabled:
                    context = await set_init_script(context)
                verify_page = await context.new_page()
                try:
                    return await self.scan_toutiao_manage_page(
                        verify_page,
                        expected_text,
                        manage_urls,
                        timeout_ms=timeout_ms,
                    )
                finally:
                    await context.close()
                    await browser.close()
        except Exception as e:
            self.logger.warning(f"独立浏览器核对头条作品管理页失败: {str(e)}")
            return False

    async def wait_toutiao_article_publish_confirmation(self, page, timeout_ms=8000):
        """
        头条文章点击“预览并发布”后，可能会异步出现“确认发布”按钮。
        """
        if not (self.is_toutiao_platform() and self.content_mode == "article"):
            return True

        deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
        while asyncio.get_event_loop().time() < deadline:
            if page.is_closed():
                self.logger.warning("头条文章确认发布阶段页面已关闭")
                return False

            blocker_error = await self.get_toutiao_account_blocker_error(page)
            if blocker_error:
                self.last_publish_error = blocker_error
                self.logger.warning(f"头条文章发布被账号限制拦截: {blocker_error}")
                return False

            try:
                confirm_button = page.locator(
                    'button.publish-btn.publish-btn-last:has-text("确认发布"), '
                    'button.publish-btn:has-text("确认发布"), '
                    'button:has-text("确认发布")'
                ).first
                if await confirm_button.count() > 0 and await confirm_button.is_visible():
                    await confirm_button.click()
                    await page.wait_for_timeout(1500)
                    self.logger.info("头条文章确认发布按钮已点击")
                    return True
            except Exception as e:
                if self.is_page_or_context_closed_error(e):
                    self.logger.warning("头条文章确认发布阶段页面已关闭")
                    return False

            try:
                validation_messages = await self.get_toutiao_validation_messages(page)
                blocking_messages = [
                    message for message in validation_messages
                    if "确认发布" not in message and "完成后无法继续编辑" not in message
                ]
                if blocking_messages:
                    self.last_publish_error = "；".join(blocking_messages[:3])
                    restriction = self.match_toutiao_account_restriction(self.last_publish_error)
                    if restriction:
                        self.last_publish_error = restriction
                    self.logger.warning(f"头条文章发布校验提示: {self.last_publish_error}")
                    return False
            except Exception as e:
                if self.is_page_or_context_closed_error(e):
                    self.logger.warning("头条文章确认发布阶段页面已关闭")
                    return False

            await page.wait_for_timeout(self.wait_timeout_500ms)

        return True

    async def verify_toutiao_manage_contains(self, page, expected_text, timeout_ms=60000):
        """
        到作品管理页核对发布结果是否出现。
        """
        if not expected_text:
            return False

        expected_text = expected_text.strip()
        manage_urls = self.get_toutiao_manage_urls()

        verify_page = None
        try:
            verify_page = await page.context.new_page()
            return await self.scan_toutiao_manage_page(
                verify_page,
                expected_text,
                manage_urls,
                timeout_ms=timeout_ms,
            )
        except Exception as e:
            if not self.is_page_or_context_closed_error(e):
                self.logger.warning(f"头条作品管理页核对异常，尝试独立浏览器兜底: {str(e)}")
        finally:
            if verify_page:
                try:
                    await verify_page.close()
                except Exception:
                    pass

        return await self.verify_toutiao_manage_contains_via_storage_state(
            expected_text,
            manage_urls,
            timeout_ms=min(timeout_ms, 20000),
        )

    async def get_toutiao_validation_messages(self, page):
        """
        收集头条视频页当前可见的校验/报错提示，便于定位“点击发布没反应”的真实原因。
        """
        try:
            messages = await page.evaluate(
                """() => {
                    const isVisible = (el) => {
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        return style.display !== 'none'
                            && style.visibility !== 'hidden'
                            && style.opacity !== '0'
                            && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
                    };

                    const phrases = [
                        '需要上传一个封面',
                        '请上传封面',
                        '请选择封面',
                        '请先选择封面',
                        '封面不能为空',
                        '封面必填',
                        '请添加封面',
                        '至少选择一张封面',
                        '请选择合集',
                        '请填写标题',
                        '请填写简介',
                        '发布失败',
                        '提交失败',
                        '完成后无法继续编辑',
                        '是否确定完成',
                        '禁言',
                        '封禁',
                        '封号',
                        '限制发布',
                        '限制发文',
                        '暂无发文权限',
                        '没有发文权限',
                        '账号异常',
                        '请完善账号信息'
                    ];
                    const result = [];
                    for (const el of Array.from(document.querySelectorAll('body *'))) {
                        if (!isVisible(el)) continue;
                        const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
                        if (!text || text.length > 80) continue;
                        if (!phrases.some((phrase) => text.includes(phrase))) continue;
                        if (!result.includes(text)) {
                            result.push(text);
                        }
                        if (result.length >= 20) break;
                    }
                    return result;
                }"""
            )
            return messages or []
        except Exception as e:
            self.logger.warning(f"收集头条页面校验提示失败: {str(e)}")
            return []

    async def collect_toutiao_video_debug_state(self, page):
        """
        汇总头条视频发布页当前表单状态、按钮状态和可见提示。
        """
        validation_messages = await self.get_toutiao_validation_messages(page)
        try:
            state = await page.evaluate(
                """() => {
                    const isVisible = (el) => {
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        return style.display !== 'none'
                            && style.visibility !== 'hidden'
                            && style.opacity !== '0'
                            && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
                    };

                    const collectButtons = () =>
                        Array.from(document.querySelectorAll('button'))
                            .filter((el) => {
                                const text = (el.innerText || el.textContent || '').trim();
                                return text.includes('发布') || text.includes('保存') || text.includes('草稿');
                            })
                            .map((el, index) => ({
                                index,
                                text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim(),
                                className: el.className || '',
                                disabled: !!el.disabled,
                                ariaDisabled: el.getAttribute('aria-disabled') || '',
                                visible: isVisible(el)
                            }));

                    const checkedTexts = (selector, inputSelector) =>
                        Array.from(document.querySelectorAll(selector))
                            .filter((label) => {
                                const input = label.querySelector(inputSelector);
                                return input && input.checked;
                            })
                            .map((label) => (label.innerText || label.textContent || '').replace(/\\s+/g, ' ').trim())
                            .filter(Boolean);

                    const titleInput = document.querySelector('input.xigua-input.show-limit.byte-input.byte-input-size-large[placeholder*="请输入 1～30 个字符"]');
                    const abstractInput = document.querySelector('textarea.byte-textarea.abstract[placeholder*="请输入视频简介"]');
                    const coverContainer = document.querySelector('.video-form-item.form-item-poster');

                    return {
                        titleValue: titleInput ? titleInput.value || '' : '',
                        abstractValue: abstractInput ? abstractInput.value || '' : '',
                        publishButtons: collectButtons(),
                        selectedStatements: checkedTexts('.source-info-wrap label.byte-checkbox.checkbot-item', 'input[type="checkbox"]'),
                        selectedVisibility: checkedTexts('.authority-info-wrap label.byte-radio', 'input[type="radio"]'),
                        coverSectionText: coverContainer ? (coverContainer.innerText || '').replace(/\\s+/g, ' ').trim() : '',
                        bodyHead: (document.body.innerText || '').slice(0, 4000)
                    };
                }"""
            )
            state["validationMessages"] = validation_messages
            return state
        except Exception as e:
            self.logger.warning(f"收集头条视频调试状态失败: {str(e)}")
            return {
                "titleValue": "",
                "abstractValue": "",
                "publishButtons": [],
                "selectedStatements": [],
                "selectedVisibility": [],
                "coverSectionText": "",
                "bodyHead": "",
                "validationMessages": validation_messages
            }

    async def dump_toutiao_video_debug_artifacts(self, page, stage, extra=None):
        """
        将头条视频发布阶段的页面证据落盘，便于对比“手工成功”与“后端失败”的差异。
        """
        if not self.is_toutiao_video_mode():
            return

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        debug_dir = Path(BASE_DIR) / "output" / "playwright" / "toutiao_backend_video"
        debug_dir.mkdir(parents=True, exist_ok=True)

        file_prefix = f"{timestamp}_{stage}"
        screenshot_path = debug_dir / f"{file_prefix}.png"
        html_path = debug_dir / f"{file_prefix}.html"
        json_path = debug_dir / f"{file_prefix}.json"

        try:
            await page.screenshot(path=str(screenshot_path), full_page=True)
        except Exception as e:
            self.logger.warning(f"头条视频截图保存失败: {str(e)}")

        try:
            html_path.write_text(await page.content(), encoding="utf-8")
        except Exception as e:
            self.logger.warning(f"头条视频 HTML 保存失败: {str(e)}")

        state = await self.collect_toutiao_video_debug_state(page)
        payload = {
            "stage": stage,
            "title": self.title,
            "text": self.text,
            "url": page.url,
            "capturedAt": timestamp,
            "extra": extra or {},
            "state": state
        }
        try:
            json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            self.logger.info(f"头条视频调试证据已落盘: {json_path}")
        except Exception as e:
            self.logger.warning(f"头条视频 JSON 保存失败: {str(e)}")

    async def wait_toutiao_video_publish_ready(self, page, publish_button, timeout_ms=15000):
        """
        等待头条视频发布按钮进入可提交状态，避免强制点击掩盖真实校验问题。
        """
        deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
        while asyncio.get_event_loop().time() < deadline:
            try:
                button_state = await publish_button.evaluate(
                    """(el) => ({
                        text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim(),
                        className: el.className || '',
                        disabled: !!el.disabled,
                        ariaDisabled: el.getAttribute('aria-disabled') || ''
                    })"""
                )
            except Exception as e:
                self.logger.warning(f"读取头条发布按钮状态失败，继续等待: {str(e)}")
                await page.wait_for_timeout(500)
                continue

            validation_messages = await self.get_toutiao_validation_messages(page)
            fatal_message = next((message for message in validation_messages if self.is_toutiao_fatal_publish_error(message)), "")
            if not fatal_message:
                fatal_message = await self.get_toutiao_account_blocker_error(page)
            if fatal_message:
                self.last_publish_error = self.match_toutiao_account_restriction(fatal_message) or fatal_message
                self.logger.warning(f"头条视频发布被账号限制拦截: {self.last_publish_error}")
                return False

            disabled = (
                button_state.get("disabled")
                or button_state.get("ariaDisabled") == "true"
                or "disabled" in (button_state.get("className") or "").lower()
            )

            if not disabled and not validation_messages:
                self.logger.info("头条视频发布按钮已进入可提交状态")
                return True

            self.logger.info(
                f"头条视频发布按钮等待就绪中: disabled={disabled}, 校验提示={validation_messages or '无'}"
            )
            await page.wait_for_timeout(1000)

        return False

    def record_toutiao_network_event(self, response, event_store):
        """
        记录头条发布阶段的关键网络请求，帮助判断“点了发布但没有真正提交”。
        """
        try:
            request = response.request
            resource_type = request.resource_type
            if resource_type not in {"fetch", "xhr", "document"}:
                return

            url = response.url
            if "toutiao.com" not in url:
                return

            if not any(keyword in url for keyword in ["publish", "video", "xigua", "content", "draft", "creator"]):
                return

            event_store.append({
                "method": request.method,
                "resourceType": resource_type,
                "status": response.status,
                "url": url
            })
            if len(event_store) > 80:
                del event_store[:-80]
        except Exception:
            return

    async def replace_text(self, locator, page, value):
        """
        为普通输入框优先使用 fill，为富文本编辑器回退到键盘输入
        """
        try:
            tag_name = await locator.evaluate("el => el.tagName.toLowerCase()")
        except Exception:
            tag_name = ""

        if tag_name in ["input", "textarea"]:
            await locator.focus()
            await locator.fill(value)
            await page.wait_for_timeout(self.wait_timeout_500ms)
            return

        try:
            await locator.focus()
        except Exception:
            await locator.click(force=True)

        # 兼容 macOS 和 Windows 的全选快捷键
        # 抖音等富文本编辑器里一次全选经常清不干净，这里循环清空直到真的空
        for _ in range(4):
            await page.keyboard.press("Meta+A")
            await page.keyboard.press("Control+A")
            await page.keyboard.press("Backspace")
            await page.wait_for_timeout(self.wait_timeout_500ms)
            try:
                remaining = await locator.evaluate(
                    "el => ((el.innerText || el.textContent || '') + '').replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim()"
                )
            except Exception:
                remaining = ""
            if not remaining:
                break
        # 整段 insert_text 粘贴出来的换行会被抖音存成行首「*」，改成逐段打字 + 真实回车
        parts = str(value or "").split("\n")
        for idx, part in enumerate(parts):
            if part:
                await page.keyboard.insert_text(part)
            if idx < len(parts) - 1:
                await page.keyboard.press("Enter")
        await page.wait_for_timeout(self.wait_timeout_500ms)
        try:
            written = await locator.evaluate(
                "el => ((el.innerText || el.textContent || '') + '').replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim()"
            )
            expect = str(value or "").strip().replace("\n", "").replace(" ", "")[:12]
            got = str(written or "").replace("\n", "").replace(" ", "")
            if expect and expect not in got:
                self.logger.warning("正文写入后校验不一致，重试一次")
                await page.keyboard.press("Meta+A")
                await page.keyboard.press("Control+A")
                await page.keyboard.press("Backspace")
                await page.wait_for_timeout(self.wait_timeout_500ms)
                await page.keyboard.insert_text(value)
                await page.wait_for_timeout(self.wait_timeout_500ms)
        except Exception:
            pass

    async def place_cursor_at_end(self, locator, page):
        try:
            tag_name = await locator.evaluate("el => el.tagName.toLowerCase()")
        except Exception:
            tag_name = ""

        if tag_name in ["input", "textarea"]:
            await locator.focus()
            await locator.evaluate(
                """el => {
                    const value = el.value || '';
                    const end = value.length;
                    el.setSelectionRange(end, end);
                }"""
            )
            return

        try:
            await locator.evaluate(
                """el => {
                    el.focus();
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    range.collapse(false);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }"""
            )
        except Exception:
            await locator.click(force=True)

    async def append_text(self, locator, page, value, trailing_breaks=2):
        if not value:
            return
        await self.place_cursor_at_end(locator, page)
        await page.keyboard.insert_text(value)
        for _ in range(max(trailing_breaks, 0)):
            await page.keyboard.press("Enter")
        await page.wait_for_timeout(self.wait_timeout_500ms)

    async def get_article_editor_locator(self, page):
        locator = await self.find_button(self.article_textbox_selectors)
        if not locator:
            raise Exception("未找到文章正文输入框")
        return locator

    async def get_inserted_article_image_count(self, page):
        selector_map = {
            "sohu": '.ql-editor img, .ql-image-container img',
            "wechat_official": 'div.ProseMirror img.js_insertlocalimg, div.ProseMirror img[data-upload="1"]',
            "csdn": 'img[src*="i-blog.csdnimg.cn"]',
            "jianshu": '#editor img.uploaded-img, div.kalamu-area img.uploaded-img, #editor img',
            "zhihu": 'img.Editable-imageUploader-image, img.Image[alt="图片"], div.public-DraftEditor-content img',
            "tieba": 'div.edui-body-container img, .j_editor_for_container img',
            "omqq": 'div.ProseMirror img, .ExEditor-basic img',
            "wangyi_mp": 'div.public-DraftEditor-content img, .public-DraftEditor-content figure img',
        }
        selector = selector_map.get(self.platform_name)
        if not selector:
            return 0
        try:
            return await page.locator(selector).count()
        except Exception:
            return 0

    async def wait_for_article_image_count(self, page, baseline_count, timeout_ms=30000):
        deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
        while asyncio.get_event_loop().time() < deadline:
            current_count = await self.get_inserted_article_image_count(page)
            if current_count > baseline_count:
                return True
            await page.wait_for_timeout(1000)
        return False

    def format_article_block_text(self, block):
        block_type = block.get("type")
        if block_type == "divider":
            return "────────"

        text = (block.get("text") or "").strip()
        if not text:
            return ""

        if block_type == "quote":
            return f"“{text}”"
        if block_type == "heading":
            return text
        return text

    async def render_structured_article(self, page):
        blocks = self.get_article_blocks()
        if not blocks:
            return await self.add_title_tags(page)

        if self.is_weibo_article_mode():
            await self.wait_weibo_article_editor_ready(page)

        title_locator_candidates = self.article_title_locators or self.editor_button_locators
        if self.title_supported and self.title:
            title_input = await self.find_button(title_locator_candidates)
            if title_input:
                await self.replace_text(title_input, page, self.title)

        if self.is_weibo_article_mode() and self.article_lead_locators:
            lead_text = self.build_weibo_article_lead()
            if lead_text:
                lead_input = await self.find_button(self.article_lead_locators)
                if lead_input:
                    await self.replace_text(lead_input, page, lead_text)

        body_locator = await self.get_article_editor_locator(page)
        await self.replace_text(body_locator, page, "")

        for block in blocks:
            block_type = block.get("type")
            if block_type == "image":
                if not self.article_doc_supports_image_upload():
                    continue

                asset_path = self.resolve_article_asset_path(block.get("assetPath"))
                if not asset_path:
                    raise Exception("文章图片块缺少本地素材，请在文章编辑器里重新绑定图片")
                if not asset_path.exists():
                    raise Exception(f"文章图片素材不存在: {asset_path}")

                body_locator = await self.get_article_editor_locator(page)
                await self.place_cursor_at_end(body_locator, page)
                before_count = await self.get_inserted_article_image_count(page)
                original_file_path = self.file_path
                self.file_path = asset_path
                upload_result = await self.upload_video_file(page)
                self.file_path = original_file_path
                if not upload_result:
                    raise Exception(f"{self.platform_name} 文章图片上传失败")
                if not await self.wait_for_article_image_count(page, before_count):
                    raise Exception(f"{self.platform_name} 文章图片插入超时")

                caption = (block.get("caption") or "").strip()
                if caption:
                    body_locator = await self.get_article_editor_locator(page)
                    await self.append_text(body_locator, page, caption, trailing_breaks=2)
                continue

            formatted_text = self.format_article_block_text(block)
            if not formatted_text:
                continue
            body_locator = await self.get_article_editor_locator(page)
            await self.append_text(body_locator, page, formatted_text, trailing_breaks=2)

        normalized_tags = self.get_tags_list()
        if self.tags_supported and normalized_tags and not self.is_weibo_article_mode():
            body_locator = await self.get_article_editor_locator(page)
            await self.place_cursor_at_end(body_locator, page)
            for _ in range(2):
                await page.keyboard.press("Enter")
            for tag in normalized_tags:
                await page.keyboard.insert_text(f"#{tag} ")
                await page.wait_for_timeout(self.wait_timeout_500ms)

        return True

    async def get_csdn_editor_text(self, page):
        try:
            editor = page.locator('pre.editor__inner[contenteditable="true"]').first
            if await editor.count() == 0:
                return ""
            return (await editor.inner_text()).strip()
        except Exception:
            return ""

    async def dismiss_csdn_tip(self, page):
        """
        CSDN 写文章页首次进入会有引导浮层，遮挡标题和发布按钮。
        """
        selectors = [
            '.middle button:has-text("我知道了")',
            '.updata-content .btn:has-text("我知道了")',
            'button:has-text("我知道了")'
        ]

        for selector in selectors:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    await locator.click()
                    await page.wait_for_timeout(self.wait_timeout_500ms)
            except Exception:
                continue

    def get_csdn_publish_tag(self):
        normalized_tags = self.get_tags_list()
        return normalized_tags[0] if normalized_tags else "自动化"

    def get_csdn_cover_upload_path(self):
        image_exts = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}
        for candidate in [self.thumbnail_path, self.file_path]:
            if not candidate:
                continue
            candidate_path = Path(candidate)
            if candidate_path.exists() and candidate_path.suffix.lower() in image_exts:
                return candidate_path
        return None

    async def ensure_csdn_publish_tag(self, page, modal):
        tag_chip = modal.locator('.mark_selection_box_el_tag').first
        if await tag_chip.count() > 0:
            return True

        tag_button = modal.locator('button.tag__btn-tag').first
        if await tag_button.count() == 0:
            self.last_publish_error = "CSDN 发布弹窗未找到标签按钮"
            return False

        await tag_button.click(force=True)
        await page.wait_for_timeout(800)

        tag_input = modal.locator('input[placeholder*="请输入文字搜索"]').first
        tag_value = self.get_csdn_publish_tag()
        if await tag_input.count() > 0 and await tag_input.is_visible():
            await tag_input.fill(tag_value)
            await page.wait_for_timeout(800)

            suggestion = modal.locator('li').filter(has_text=tag_value).first
            if await suggestion.count() > 0 and await suggestion.is_visible():
                await suggestion.click(force=True)
            else:
                await tag_input.press("Enter")
            await page.wait_for_timeout(1000)

        if await tag_chip.count() > 0:
            self.logger.info(f"CSDN 发布弹窗已补齐标签：{tag_value}")
            return True

        self.last_publish_error = "CSDN 发布弹窗标签未成功添加"
        return False

    async def ensure_csdn_publish_cover(self, page, modal):
        preview = modal.locator('.container-coverimage-box img.preview').first
        existing_src = await preview.get_attribute('src') if await preview.count() > 0 else ""
        if existing_src:
            return True

        upload_path = self.get_csdn_cover_upload_path()
        if not upload_path:
            self.last_publish_error = "CSDN 自动发布缺少可用封面图片"
            return False

        cover_input = modal.locator('input[type="file"][accept*=".png"]').first
        if await cover_input.count() == 0:
            cover_input = page.locator('input[type="file"][accept*=".png"]').first
        if await cover_input.count() == 0:
            self.last_publish_error = "CSDN 发布弹窗未找到封面上传入口"
            return False

        await cover_input.set_input_files(str(upload_path))
        await page.wait_for_timeout(1500)

        crop_confirm_selectors = [
            'text=确认上传',
            '.vicp-wrap button:has-text("确认上传")',
            '.vicp-wrap button:has-text("确定")',
            '.vicp-wrap button:has-text("保存")',
            '.vicp-wrap button:has-text("完成")',
        ]
        for selector in crop_confirm_selectors:
            button = page.locator(selector).last
            try:
                if await button.count() > 0 and await button.is_visible():
                    await button.click(force=True)
                    await page.wait_for_timeout(1000)
                    break
            except Exception:
                continue

        deadline = asyncio.get_event_loop().time() + 20
        while asyncio.get_event_loop().time() < deadline:
            preview_src = await preview.get_attribute('src') if await preview.count() > 0 else ""
            crop_visible = await page.locator('.vicp-wrap:visible').count() > 0
            if preview_src and not crop_visible:
                self.logger.info("CSDN 发布弹窗封面已上传完成")
                return True
            await page.wait_for_timeout(500)

        self.last_publish_error = "CSDN 发布弹窗封面上传未完成"
        return False

    async def ensure_csdn_publish_options(self, page, modal):
        option_selectors = [
            ("original", "原创"),
            ("public", "全部可见"),
        ]

        for option_id, option_label in option_selectors:
            radio = modal.locator(f'input#{option_id}').first
            if await radio.count() == 0:
                self.last_publish_error = f"CSDN 发布弹窗缺少 {option_label} 选项"
                return False

            try:
                if await radio.is_checked():
                    continue
            except Exception:
                pass

            option_trigger = modal.locator(f'label[for=\"{option_id}\"]').first
            if await option_trigger.count() == 0:
                self.last_publish_error = f"CSDN 发布弹窗未找到 {option_label} 选项"
                return False
            await option_trigger.click(force=True)
            await page.wait_for_timeout(500)

        return True

    async def ensure_csdn_publish_requirements(self, page, modal):
        await self.dismiss_csdn_tip(page)

        if not await self.ensure_csdn_publish_tag(page, modal):
            return False
        if not await self.ensure_csdn_publish_cover(page, modal):
            return False
        if not await self.ensure_csdn_publish_options(page, modal):
            return False

        return True

    async def dismiss_baijiahao_title_tip(self, page):
        """
        百家号标题编辑器偶尔会弹出升级提示浮层，遮挡标题输入框。
        """
        try:
            tip_button = page.locator('button:has-text("我知道了")').first
            if await tip_button.count() > 0 and await tip_button.is_visible():
                await tip_button.click()
                await page.wait_for_timeout(self.wait_timeout_500ms)
                self.logger.info("百家号标题升级提示已关闭")
        except Exception as e:
            self.logger.warning(f"关闭百家号标题提示失败，继续尝试填写: {str(e)}")

    async def dismiss_sohu_article_tip(self, page):
        """
        搜狐文章编辑器偶尔会弹出表格功能提示，遮挡工具栏按钮。
        """
        try:
            tip_button = page.locator('button:has-text("我知道了")').first
            if await tip_button.count() > 0 and await tip_button.is_visible():
                await tip_button.click()
                await page.wait_for_timeout(self.wait_timeout_500ms)
                self.logger.info("搜狐文章表格提示已关闭")
        except Exception as e:
            self.logger.warning(f"关闭搜狐文章提示失败，继续尝试填写: {str(e)}")

    async def save_csdn_draft(self, page):
        """
        CSDN 草稿模式：点击保存草稿后，到草稿箱核对标题。
        """
        try:
            await self.dismiss_csdn_tip(page)
            draft_button = await self.find_button(self.draft_button_selectors)
            if not draft_button:
                raise Exception("未找到 CSDN 保存草稿按钮")

            await draft_button.click()
            self.logger.info("CSDN 保存草稿按钮已点击")

            for _ in range(10):
                body_text = await page.locator('body').inner_text()
                if "保存成功" in body_text or "草稿" in body_text:
                    break
                await page.wait_for_timeout(1000)

            return await self.verify_csdn_manage_contains(page, self.title, include_draft=True)
        except Exception as e:
            self.logger.warning(f"CSDN 保存草稿流程失败: {str(e)}")
            return False

    async def save_jianshu_draft(self, page):
        """
        简书文章页依赖自动保存，检测“已保存”提示即可视为草稿写入成功。
        """
        try:
            for _ in range(15):
                saved_tip = page.locator('text=已保存').first
                if await saved_tip.count() > 0 and await saved_tip.is_visible():
                    self.logger.info("简书文章已自动保存到草稿")
                    return True
                await page.wait_for_timeout(1000)
        except Exception as e:
            self.logger.warning(f"简书草稿状态检测失败: {str(e)}")

        self.last_publish_error = "简书页面未检测到“已保存”，草稿状态未知"
        return False

    async def save_zhihu_draft(self, page):
        """
        知乎文章页依赖自动保存，编辑区右下角会显示“刚刚 · 草稿”等状态。
        """
        try:
            for _ in range(20):
                body_text = " ".join((await page.locator('body').inner_text()).replace("\xa0", " ").split())
                if "· 草稿" in body_text or "• 草稿" in body_text:
                    self.logger.info("知乎文章已自动保存到草稿")
                    return True
                await page.wait_for_timeout(1000)
        except Exception as e:
            self.logger.warning(f"知乎草稿状态检测失败: {str(e)}")

        self.last_publish_error = "知乎页面未检测到草稿保存提示"
        return False

    async def save_weibo_article_draft(self, page):
        """
        微博文章草稿模式：点击保存草稿后，要求草稿 URL 已生成且页面中能看到当前标题。
        """
        try:
            draft_button = await self.find_button(self.draft_button_selectors)
            if not draft_button:
                raise Exception("未找到微博文章保存草稿按钮")

            await draft_button.click(force=True)
            self.logger.info("微博文章保存草稿按钮已点击")

            for _ in range(15):
                current_url = page.url or ""
                body_text = " ".join((await page.locator('body').inner_text()).replace("\xa0", " ").split())
                if "/draft/" in current_url and self.title and self.title in body_text:
                    self.logger.info("微博文章已保存到草稿")
                    return True
                await page.wait_for_timeout(1000)
        except Exception as e:
            self.logger.warning(f"微博文章保存草稿流程失败: {str(e)}")

        self.last_publish_error = self.last_publish_error or "微博文章未检测到草稿保存成功"
        return False

    async def save_omqq_draft(self, page):
        """
        企鹅号文章页支持显式“存草稿”，同时编辑器也会自动保存。
        """
        try:
            draft_button = await self.find_button(self.draft_button_selectors)
            if draft_button and await draft_button.count() > 0 and await draft_button.is_visible():
                try:
                    if not await draft_button.is_disabled():
                        await draft_button.click(force=True)
                        self.logger.info("企鹅号存草稿按钮已点击")
                except Exception:
                    pass

            for _ in range(20):
                body_text = " ".join((await page.locator('body').inner_text()).replace("\xa0", " ").split())
                if "已保存" in body_text and (not self.title or self.title in body_text):
                    self.logger.info("企鹅号文章已保存到草稿")
                    return True
                await page.wait_for_timeout(1000)
        except Exception as e:
            self.logger.warning(f"企鹅号草稿状态检测失败: {str(e)}")

        self.last_publish_error = "企鹅号页面未检测到“已保存”，草稿状态未知"
        return False

    async def save_wangyi_draft(self, page):
        """
        网易号文章页依赖自动草稿态，检测“草稿”标签和当前标题同时出现即可视为已写入草稿。
        """
        try:
            for _ in range(20):
                body_text = " ".join((await page.locator('body').inner_text()).replace("\xa0", " ").split())
                has_title = not self.title or self.title in body_text
                if has_title and "草稿" in body_text:
                    self.logger.info("网易号文章已写入草稿态")
                    return True
                await page.wait_for_timeout(1000)
        except Exception as e:
            self.logger.warning(f"网易号草稿状态检测失败: {str(e)}")

        self.last_publish_error = "网易号页面未检测到草稿状态"
        return False

    async def prepare_wangyi_cover(self, page):
        """
        网易号文章发布前需要显式选择一次封面模式。
        实测点击“自动”后，后续发文前检测才能顺利进入真正发布。
        """
        for label in ["自动", "单图"]:
            locator = page.get_by_text(label, exact=True).last
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    await locator.click(force=True)
                    await page.wait_for_timeout(800)
                    return True
            except Exception:
                continue
        return False

    async def handle_wangyi_publish_precheck(self, page):
        """
        网易号第一次点击“发布”通常只会触发发文前检测。
        检测结束后需要再次点击发布，才会真正跳到内容管理页。
        """
        try:
            for _ in range(30):
                if "content-manage" in page.url:
                    return True
                body_text = " ".join((await page.locator('body').inner_text()).replace("\xa0", " ").split())
                if "正在为您进行发文前检测" not in body_text:
                    break
                await page.wait_for_timeout(1000)

            if "content-manage" in page.url:
                return True

            publish_button = await self.find_button(self.publish_button_selectors)
            if publish_button and await publish_button.count() > 0 and await publish_button.is_visible():
                if not await publish_button.is_disabled():
                    await publish_button.click(force=True)
                    await page.wait_for_timeout(5000)
                    if "content-manage" in page.url:
                        return True
        except Exception as e:
            self.logger.warning(f"网易号发文前检测处理失败: {str(e)}")

        return False

    async def get_jianshu_publish_error(self, page):
        error_selectors = [
            'text=需要绑定手机号后才能发布文章哟~',
            'text=绑定手机',
            'text=发送验证码',
            'text=请先绑定手机号',
            'text=发布失败'
        ]

        for selector in error_selectors:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    text = (await locator.inner_text()).strip().replace("\n", " ")
                    if not text:
                        continue
                    if "绑定手机" in text or "手机号" in text or "验证码" in text:
                        return "简书当前账号需要先绑定手机号后才能自动发布"
                    return text
            except Exception:
                continue

        try:
            body_text = " ".join((await page.locator("body").inner_text()).replace("\xa0", " ").split())
            if "绑定手机号" in body_text or "需要绑定手机号" in body_text:
                return "简书当前账号需要先绑定手机号后才能自动发布"
        except Exception:
            pass

        return ""

    async def click_jianshu_publish_button(self, page):
        try:
            await page.wait_for_selector('a[data-action="publicize"]', state="attached", timeout=8000)
        except Exception:
            self.logger.warning("等待简书 a[data-action=publicize] 超时，改为全文扫描点击")

        result = {}
        try:
            result = await page.evaluate(
                """() => {
                  const normalize = (value) => (value || '').replace(/\\s+/g, '');
                  const fire = (el) => {
                    if (!el) return false;
                    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (error) {}
                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    if (typeof el.click === 'function') el.click();
                    return true;
                  };
                  const publicize = document.querySelector('a[data-action="publicize"]');
                  if (fire(publicize)) return { ok: true, via: 'data-action-publicize' };
                  const nodes = Array.from(document.querySelectorAll('a,button,span,li'));
                  const exact = nodes
                    .filter((el) => normalize(el.innerText) === '发布文章')
                    .sort((a, b) => (a.offsetWidth * a.offsetHeight) - (b.offsetWidth * b.offsetHeight))[0];
                  if (fire(exact)) return { ok: true, via: 'text-发布文章' };
                  return {
                    ok: false,
                    hasPublicize: Boolean(document.querySelector('a[data-action="publicize"]')),
                    bodyHasPublish: Boolean(document.body && document.body.innerText.includes('发布文章')),
                    iframeCount: document.querySelectorAll('iframe').length,
                  };
                }"""
            )
        except Exception as error:
            self.logger.warning(f"简书发布按钮脚本点击失败: {error}")

        if isinstance(result, dict) and result.get("ok"):
            self.logger.info(f"已点击简书发布按钮: {result.get('via')}")
            return True

        self.logger.warning(f"简书发布按钮脚本未点到: {result}")
        try:
            locator = page.locator('a[data-action="publicize"]').first
            if await locator.count() > 0:
                await locator.click(force=True, timeout=3000)
                self.logger.info("已强制点击 a[data-action=publicize]")
                return True
        except Exception as error:
            self.logger.warning(f"简书发布按钮强制点击失败: {error}")

        await self._log_jianshu_publish_candidates(page)
        return False

    async def _log_jianshu_publish_candidates(self, page):
        try:
            rows = await page.evaluate(
                """() => {
                  const items = [];
                  for (const el of document.querySelectorAll('a,button,div,span,li,p,i,[role="button"]')) {
                    const text = (el.innerText || el.textContent || '').replace(/\\s+/g, '');
                    const title = el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('data-original-title') || '';
                    const action = el.getAttribute('data-action') || '';
                    if (!text.includes('发布') && !title.includes('发布') && action !== 'publicize') {
                      continue;
                    }
                    if (text.length > 24) {
                      continue;
                    }
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 2 || rect.height < 2) {
                      continue;
                    }
                    items.push({
                      tag: el.tagName,
                      className: String(el.className || '').slice(0, 80),
                      action,
                      text: text.slice(0, 24),
                      title: String(title).slice(0, 24),
                      x: Math.round(rect.x),
                      y: Math.round(rect.y),
                      w: Math.round(rect.width),
                      h: Math.round(rect.height),
                    });
                    if (items.length >= 20) {
                      break;
                    }
                  }
                  return items;
                }"""
            )
            self.logger.info(f"简书发布按钮候选: {rows}")
        except Exception as error:
            self.logger.warning(f"简书发布按钮候选扫描失败: {error}")

    async def _find_jianshu_publish_by_dom(self, page, labels):
        try:
            handle = await page.evaluate_handle(
                """(labels) => {
                  const normalize = (value) => (value || '').replace(/\\s+/g, '');
                  const wanted = (labels || []).map(normalize).filter(Boolean);
                  const isVisible = (el) => {
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 2 || rect.height < 2) return false;
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
                  };
                  const area = (el) => {
                    const rect = el.getBoundingClientRect();
                    return rect.width * rect.height;
                  };
                  const nodes = Array.from(document.querySelectorAll('a,button,div,span,li,p,i,[role="button"]'));
                  const hits = [];
                  for (const el of nodes) {
                    if (!isVisible(el)) continue;
                    const text = normalize(el.innerText || el.textContent);
                    const title = normalize(
                      el.getAttribute('title') ||
                      el.getAttribute('aria-label') ||
                      el.getAttribute('data-original-title') ||
                      ''
                    );
                    const action = el.getAttribute('data-action') || '';
                    if (action === 'publicize' || wanted.some((label) => text === label || title === label)) {
                      hits.push(el);
                    }
                  }
                  hits.sort((left, right) => area(left) - area(right));
                  return hits[0] || null;
                }""",
                labels,
            )
            element = handle.as_element()
            if element:
                self.logger.info("通过 DOM 扫描找到简书发布按钮")
                return element
        except Exception as error:
            self.logger.warning(f"简书发布按钮 DOM 扫描失败: {error}")
        return None

    async def get_jianshu_publish_button(self, page, labels=None):
        labels = [item for item in (labels or ["发布文章", "公开发布"]) if item]
        selectors = []
        for label in labels:
            selectors.extend([
                f'text="{label}"',
                f'text={label}',
                f'a:has-text("{label}")',
                f'button:has-text("{label}")',
                f'[role="button"]:has-text("{label}")',
                f'[title="{label}"]',
                f'[aria-label="{label}"]',
                f'[data-original-title="{label}"]',
            ])
        selectors.extend([
            'a[data-action="publicize"]',
            'i.fa-mail-forward',
            'a.fa-mail-forward',
        ])

        scopes = [page]
        try:
            scopes.extend(frame for frame in page.frames if frame != page.main_frame)
        except Exception:
            pass

        for scope in scopes:
            for selector in selectors:
                try:
                    locator = scope.locator(selector)
                    count = await locator.count()
                except Exception:
                    continue
                for index in range(min(count, 15)):
                    candidate = locator.nth(index)
                    try:
                        if not await candidate.is_visible():
                            continue
                        box = await candidate.bounding_box()
                        if box and (box.get("width", 0) * box.get("height", 0) > 60000):
                            continue
                        text = ""
                        try:
                            text = " ".join((await candidate.inner_text()).split())
                        except Exception:
                            text = ""
                        self.logger.info(f"找到简书发布按钮: {selector} text={text!r}")
                        return candidate
                    except Exception:
                        continue

        button = await self._find_jianshu_publish_by_dom(page, labels)
        if button:
            return button
        await self._log_jianshu_publish_candidates(page)
        return None

    async def handle_jianshu_publish_confirmation(self, page):
        bind_error = await self.get_jianshu_publish_error(page)
        if bind_error:
            self.last_publish_error = bind_error
            return False

        try:
            for selector in ('a[data-action="privatize"]', 'text=已发布', 'text=发布成功'):
                published = page.locator(selector)
                if await published.count() > 0 and await published.first.is_visible():
                    self.logger.info("简书已出现发布成功状态，不再点击二次确认")
                    return True
        except Exception:
            pass

        await page.wait_for_timeout(800)
        dialog = page.locator('[role="dialog"], .modal:visible, .ant-modal:visible, div[class*="modal"]:visible').last
        try:
            if await dialog.count() > 0 and await dialog.is_visible():
                dialog_text = " ".join((await dialog.inner_text()).split())
                if "绑定手机" in dialog_text or "验证码" in dialog_text:
                    self.last_publish_error = "简书当前账号需要先绑定手机号后才能自动发布"
                    return False
                for label in ["公开发布", "确认发布"]:
                    button = dialog.get_by_text(label, exact=True)
                    if await button.count() > 0 and await button.first.is_visible():
                        await button.first.click(force=True)
                        self.logger.info(f"已点击简书弹窗确认按钮: {label}")
                        await page.wait_for_timeout(1200)
                        return True
        except Exception as error:
            self.logger.warning(f"简书发布弹窗确认失败: {error}")

        button = await self.get_jianshu_publish_button(page, labels=["公开发布", "确认发布", "确定发布"])
        if not button:
            return False
        try:
            await button.click(force=True)
            self.logger.info("已点击简书二次发布确认")
            await page.wait_for_timeout(1200)
            return True
        except Exception as error:
            self.logger.warning(f"简书二次发布确认点击失败: {error}")
            return False

    async def is_jianshu_publish_succeeded(self, page):
        success_markers = ["发布成功", "文章发布成功", "发布完成"]
        deadline = time.monotonic() + 8
        while True:
            current_url = (page.url or "").lower()
            if "jianshu.com/p/" in current_url:
                return True
            if "/writer" not in current_url and "/sign_in" not in current_url and "jianshu.com" in current_url:
                return True
            for marker in success_markers:
                locator = page.get_by_text(marker)
                try:
                    if await locator.count() > 0 and await locator.first.is_visible():
                        return True
                except Exception:
                    continue
            try:
                update_button = page.get_by_text("更新", exact=True)
                publish_button = page.get_by_text("发布文章", exact=True)
                update_visible = await update_button.count() > 0 and await update_button.first.is_visible()
                publish_visible = False
                try:
                    publish_visible = await publish_button.count() > 0 and await publish_button.first.is_visible()
                except Exception:
                    publish_visible = False
                if update_visible and not publish_visible:
                    return True
            except Exception:
                pass
            if time.monotonic() >= deadline:
                return False
            await page.wait_for_timeout(500)

    async def get_zhihu_publish_error(self, page):
        if await self.is_zhihu_security_page(page):
            return "知乎当前触发了安全验证，请在浏览器中手动完成验证后再继续"

        error_selectors = [
            'text=请输入标题',
            'text=请输入正文',
            'text=图片上传中',
            'text=发布失败',
            'text=请求失败',
            'text=网络异常'
        ]

        for selector in error_selectors:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    text = (await locator.inner_text()).strip().replace("\n", " ")
                    if not text:
                        continue
                    if "图片上传中" in text:
                        return "知乎正文图片仍在上传中，请稍后重试"
                    return text
            except Exception:
                continue

        return ""

    async def get_x_publish_error(self, page):
        error_selectors = [
            'text=Something went wrong',
            'text=Try again',
            'text=Post wasn’t sent',
            'text=Post not sent',
            'text=You already said that',
            'text=Duplicate Post',
            'text=Rate limit exceeded',
            'text=Posts are not loading right now'
        ]

        for selector in error_selectors:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    text = (await locator.inner_text()).strip().replace("\n", " ")
                    if text:
                        return text
            except Exception:
                continue

        publish_button = await self.get_x_publish_button()
        try:
            if publish_button and await publish_button.count() > 0 and await publish_button.is_visible():
                disabled = await publish_button.is_disabled()
                if disabled:
                    return "X 当前发布按钮仍不可点击，请检查推文内容或媒体上传状态"
        except Exception:
            pass

        return ""

    async def get_weibo_publish_error(self, page):
        if await self.is_weibo_security_page(page):
            return "微博触发身份验证，请先在浏览器里完成滑块或身份验证"

        error_selectors = [
            'text=发布失败',
            'text=发送失败',
            'text=内容不能为空',
            'text=请先输入内容',
            'text=发布太频繁',
            'text=请稍后再试'
        ]

        for selector in error_selectors:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    text = (await locator.inner_text()).strip().replace("\n", " ")
                    if text:
                        return text
            except Exception:
                continue

        publish_button = await self.get_weibo_publish_button()
        try:
            if self.is_weibo_article_mode():
                title_input = page.locator('textarea[placeholder="请输入标题"]').first
                body_input = page.locator('div.ProseMirror[contenteditable="true"]').first
                title_value = (await title_input.input_value()).strip() if await title_input.count() > 0 else ""
                body_value = (await body_input.inner_text()).strip() if await body_input.count() > 0 else ""
                if publish_button and await publish_button.count() > 0 and await publish_button.is_visible():
                    disabled = await publish_button.is_disabled()
                    if disabled and (title_value or body_value):
                        return "微博文章当前仍未到可发布状态，请检查标题、正文或身份验证"
                return ""

            textarea = page.locator('textarea[placeholder*="新鲜事"]').first
            textarea_value = ""
            if await textarea.count() > 0:
                textarea_value = (await textarea.input_value()).strip()
            if publish_button and await publish_button.count() > 0 and await publish_button.is_visible():
                disabled = await publish_button.is_disabled()
                if disabled and textarea_value:
                    return "微博当前发送按钮仍不可点击，请检查内容或媒体上传状态"
        except Exception:
            pass

        return ""

    async def get_douban_publish_error(self, page):
        error_selectors = [
            'text=请先输入内容',
            'text=请输入标题',
            'text=发布失败',
            'text=请稍后再试'
        ]

        for selector in error_selectors:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    text = (await locator.inner_text()).strip().replace("\n", " ")
                    if text:
                        return text
            except Exception:
                continue

        publish_button = await self.get_douban_publish_button()
        try:
            if publish_button and await publish_button.count() > 0 and await publish_button.is_visible():
                disabled = await publish_button.is_disabled()
                if disabled:
                    if self.is_douban_article_mode():
                        return "豆瓣日记当前发布按钮仍不可点击，请检查标题、正文或图片上传状态"
                    return "豆瓣广播当前发布按钮仍不可点击，请检查正文或图片上传状态"
        except Exception:
            pass

        return ""

    async def get_omqq_publish_error(self, page):
        error_selectors = [
            'text=请选择自主声明',
            'text=请选择分类',
            'text=请输入标题',
            'text=请输入正文',
            'text=资质审核中',
            'text=发布失败',
            'text=提交失败'
        ]

        for selector in error_selectors:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    text = (await locator.inner_text()).strip().replace("\n", " ")
                    if not text:
                        continue
                    if "资质审核中" in text:
                        return "企鹅号当前账号仍在资质审核中，暂时无法正式发布"
                    return text
            except Exception:
                continue

        try:
            body_text = " ".join((await page.locator('body').inner_text()).replace("\xa0", " ").split())
            if "资质审核中" in body_text:
                return "企鹅号当前账号仍在资质审核中，暂时无法正式发布"
            if "请选择自主声明" in body_text:
                return "请选择自主声明"
            if "请选择分类" in body_text:
                return "请选择分类"
        except Exception:
            pass

        publish_button = await self.find_button(self.publish_button_selectors)
        try:
            if publish_button and await publish_button.count() > 0 and await publish_button.is_visible():
                disabled = await publish_button.is_disabled()
                if disabled:
                    return "企鹅号当前发布按钮仍不可点击，请检查分类、自主声明或账号审核状态"
        except Exception:
            pass

        return ""

    async def get_wangyi_publish_error(self, page):
        error_selectors = [
            'text=请输入标题',
            'text=请输入正文',
            'text=发布失败',
            'text=提交失败',
            'text=系统繁忙',
            'text=请稍后再试'
        ]

        for selector in error_selectors:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    text = (await locator.inner_text()).strip().replace("\n", " ")
                    if text:
                        return text
            except Exception:
                continue

        try:
            publish_button = await self.find_button(self.publish_button_selectors)
            if publish_button and await publish_button.count() > 0 and await publish_button.is_visible():
                if await publish_button.is_disabled():
                    return "网易号当前发布按钮仍不可点击，请检查标题、正文或图片上传状态"
        except Exception:
            pass

        return ""

    async def handle_csdn_publish_confirmation(self, page):
        """
        CSDN 点击页面顶部“发布文章”后会弹出发布设置弹窗，需要在弹窗里再次确认。
        当前自动发布链路要求正文里已经有图片，纯文本文章建议先走存草稿。
        """
        try:
            await self.dismiss_csdn_tip(page)
            modal = page.locator('.modal:visible').last
            await modal.wait_for(state='visible', timeout=self.button_visible_timeout)
            await self.dismiss_csdn_tip(page)

            modal_text = await modal.inner_text()
            if '暂无内容图片，请在正文中添加图片' in modal_text:
                self.last_publish_error = "CSDN 自动发布当前至少需要一张图片，请先上传图片或改为存草稿"
                self.logger.warning(self.last_publish_error)
                return False

            if not await self.ensure_csdn_publish_requirements(page, modal):
                self.logger.warning(self.last_publish_error or "CSDN 发布前置条件补齐失败")
                return False

            confirm_button = modal.locator('button.btn-b-red:has-text("发布文章")').first
            await confirm_button.wait_for(state='visible', timeout=self.button_visible_timeout)
            self.logger.info("CSDN 发布设置弹窗已出现，准备点击弹窗内发布按钮")

            await confirm_button.scroll_into_view_if_needed()
            await confirm_button.click(force=True)
            await page.wait_for_timeout(self.wait_timeout_500ms)

            # CSDN 文章页首次发布时会弹“点击这里发布 / 我知道了”的引导浮层，容易挡住真正的发布按钮。
            # 如果弹窗还在，先关闭引导再补点一次发布。
            if await modal.count() > 0 and await modal.is_visible():
                await self.dismiss_csdn_tip(page)
                if await modal.is_visible():
                    await confirm_button.click(force=True)

            for _ in range(10):
                if await page.locator('text=发布成功！正在审核中').count() > 0:
                    self.logger.info("CSDN 发布成功页已出现")
                    return True
                if await page.locator('text=查看文章').count() > 0:
                    self.logger.info("CSDN 发布成功后的查看文章入口已出现")
                    return True
                await page.wait_for_timeout(1000)

            self.logger.info("CSDN 弹窗内发布按钮已点击，继续等待管理页核对")
            return True
        except Exception as e:
            self.logger.warning(f"CSDN 发布确认弹窗处理失败: {str(e)}")
            return False

    async def get_csdn_publish_error(self, page):
        error_selectors = [
            'text=还需要输入',
            'text=请输入文章标题',
            'text=发布失败',
            'text=系统繁忙'
        ]

        for selector in error_selectors:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    text = (await locator.inner_text()).strip()
                    if text:
                        return text.replace("\n", " ")
            except Exception:
                continue

        return ""

    async def verify_csdn_manage_contains(self, page, expected_text, timeout_ms=45000, include_draft=False):
        expected_text = " ".join((expected_text or "").replace("\xa0", " ").split())
        if not expected_text:
            return False

        verify_page = await page.context.new_page()
        deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
        try:
            while asyncio.get_event_loop().time() < deadline:
                await verify_page.goto(self.personal_url, wait_until='domcontentloaded', timeout=self.page_load_timeout)
                await verify_page.wait_for_timeout(3000)

                if include_draft:
                    draft_tab = verify_page.locator('text=草稿箱').first
                    if await draft_tab.count() > 0:
                        await draft_tab.click()
                        await verify_page.wait_for_timeout(2500)
                else:
                    for tab_text in ['审核中/未通过', '已发布']:
                        body_text = " ".join((await verify_page.locator('body').inner_text()).replace("\xa0", " ").split())
                        if expected_text in body_text:
                            self.logger.info(f"CSDN 管理页已检索到内容: {expected_text}")
                            self.set_result_url(self.personal_url, url_type="manage", label="查看后台")
                            return True
                        tab = verify_page.locator(f'text={tab_text}').first
                        if await tab.count() > 0:
                            await tab.click()
                            await verify_page.wait_for_timeout(2500)

                body_text = " ".join((await verify_page.locator('body').inner_text()).replace("\xa0", " ").split())
                if expected_text in body_text:
                    self.logger.info(f"CSDN 管理页已检索到内容: {expected_text}")
                    self.set_result_url(self.personal_url, url_type="manage", label="查看后台")
                    return True

                await verify_page.wait_for_timeout(1500)
        except Exception as e:
            self.logger.warning(f"CSDN 管理页核对失败，继续回退到页面态判定: {str(e)}")
        finally:
            await verify_page.close()

        return False

    async def handle_sohu_article_publish_confirmation(self, page):
        """
        搜狐文章发布时，短文可能会弹二次确认框，需要继续点击确定。
        """
        try:
            confirm_button = page.locator('.win-mask .sure-btn').first
            if await confirm_button.count() > 0 and await confirm_button.is_visible():
                await confirm_button.click()
                await page.wait_for_timeout(1000)
                self.logger.info("搜狐文章发布确认弹窗已处理")
        except Exception as e:
            self.logger.warning(f"处理搜狐文章发布确认弹窗失败，继续等待发布结果: {str(e)}")

    async def ensure_wechat_official_cover(self, page):
        """
        公众号文章发布前必须补一张封面，这里默认从正文首图选择。
        """
        try:
            cover_preview = page.locator('#js_cover_area .js_cover_preview_new').first
            if await cover_preview.count() > 0 and await cover_preview.is_visible():
                self.logger.info("公众号文章封面已存在")
                return True

            cover_button = page.locator('#js_cover_area > .js_cover_btn_area.select-cover__mask').first
            await cover_button.wait_for(state='visible', timeout=self.button_visible_timeout)
            await cover_button.click(force=True)
            await page.wait_for_timeout(self.wait_timeout_500ms)

            select_from_content = page.locator('#js_cover_null a.js_selectCoverFromContent').first
            await select_from_content.wait_for(state='attached', timeout=self.button_visible_timeout)
            await select_from_content.click(force=True)
            await page.wait_for_timeout(1500)

            cover_dialog = page.locator('.weui-desktop-dialog_img-picker').first
            await cover_dialog.wait_for(state='visible', timeout=self.button_visible_timeout)

            image_item = cover_dialog.locator('.appmsg_content_img_item').first
            await image_item.wait_for(state='visible', timeout=self.button_visible_timeout)
            await image_item.click(force=True)
            await page.wait_for_timeout(self.wait_timeout_500ms)

            next_button = cover_dialog.get_by_role('button', name='下一步').first
            await next_button.wait_for(state='visible', timeout=self.button_visible_timeout)
            await next_button.click(force=True)
            await page.wait_for_timeout(1500)

            confirm_button = page.get_by_role('button', name='确认').first
            await confirm_button.wait_for(state='visible', timeout=self.button_visible_timeout)
            await confirm_button.click(force=True)
            for _ in range(15):
                if await cover_preview.count() > 0 and await cover_preview.is_visible():
                    return True
                await page.wait_for_timeout(1000)

            picker_visible = await page.locator('.weui-desktop-dialog_img-picker').first.is_visible()
            edit_visible = await page.locator('text=编辑封面').first.is_visible()
            if not picker_visible and not edit_visible:
                self.logger.warning("公众号封面预览未及时刷新，但封面选择弹层已关闭，继续尝试发布")
                return True

            self.logger.warning("公众号文章封面预览未出现")
            return False
        except Exception as e:
            self.logger.error(f"公众号文章封面设置失败: {str(e)}")
            return False

    async def ensure_zhihu_cover(self, page):
        """
        知乎文章如果本次带图，优先把同一张图片补到封面区域，避免发布前还缺封面。
        """
        if not self.file_path:
            return True

        try:
            cover_preview = page.locator('img[alt="封面图"]').first
            if await cover_preview.count() > 0 and await cover_preview.is_visible():
                self.logger.info("知乎文章封面已存在")
                return True

            cover_input = page.locator('input.UploadPicture-input').first
            await cover_input.wait_for(state='attached', timeout=self.button_visible_timeout)
            await cover_input.set_input_files(self.file_path)

            for _ in range(20):
                if await cover_preview.count() > 0 and await cover_preview.is_visible():
                    return True
                await page.wait_for_timeout(1000)

            self.logger.warning("知乎文章封面预览未出现")
            return False
        except Exception as e:
            self.logger.error(f"知乎文章封面设置失败: {str(e)}")
            return False

    async def handle_wechat_official_publish_confirmation(self, page):
        """
        公众号文章点击发表后，可能会要求补充创作来源声明。
        """
        try:
            confirm_button = page.locator('button:has-text("无需声明并发表")').first
            if await confirm_button.count() > 0 and await confirm_button.is_visible():
                await confirm_button.click()
                await page.wait_for_timeout(3000)
                self.logger.info("公众号创作来源声明弹窗已处理")
        except Exception as e:
            self.logger.warning(f"处理公众号创作来源声明失败，继续等待结果: {str(e)}")

    async def save_wechat_official_draft(self, page):
        """
        公众号文章草稿模式：优先点击“保存为草稿”，找不到时回退到等待编辑器自动保存。
        """
        try:
            draft_button = await self.find_button(self.draft_button_selectors)
            if draft_button:
                await draft_button.scroll_into_view_if_needed()
                await draft_button.evaluate("el => el.click()")
                self.logger.info("公众号保存草稿按钮已点击")
            else:
                self.logger.info("未找到公众号保存草稿按钮，等待编辑器自动保存")

            for _ in range(12):
                if "appmsgid=" in page.url:
                    self.logger.info("公众号文章编辑页已生成 appmsgid，视为草稿保存成功")
                    break
                save_success = page.locator("text=保存成功").first
                if await save_success.count() > 0 and await save_success.is_visible():
                    self.logger.info("公众号页面已出现保存成功提示")
                    break
                await page.wait_for_timeout(1500)

            return await self.verify_wechat_official_draft_contains(page, self.title)
        except Exception as e:
            self.logger.warning(f"公众号保存草稿流程失败: {str(e)}")
            return False

    async def get_wechat_official_publish_error(self, page):
        """
        读取公众号文章页当前可见的发布校验提示。
        """
        error_selectors = [
            '.js_cover_error .js_msg_content',
            'text=必须插入一张图片',
            'text=请在这里输入标题',
            'text=若你发表的内容涉及'
        ]

        for selector in error_selectors:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    text = (await locator.inner_text()).strip()
                    if text:
                        return text.replace("\n", " ")
            except Exception:
                continue

        return ""

    async def get_xiaohongshu_publish_error(self, page):
        """
        读取小红书图文页当前可见的校验或失败提示。
        """
        error_selectors = [
            'text=请填写标题',
            'text=请输入标题',
            'text=请补充正文',
            'text=请上传图片',
            'text=标题不能超过',
            'text=标题最多',
            'text=正文不能超过',
            'text=描述不能超过',
            'text=字数超过限制',
            'text=内容包含敏感词',
            'text=内容违规',
            'text=上传失败',
            'text=发布失败',
            'text=网络异常',
            '[class*="error"]',
            '[class*="Error"]',
        ]

        for selector in error_selectors:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    text = " ".join((await locator.inner_text()).replace("\n", " ").split())
                    if text:
                        return text
            except Exception:
                continue

        return ""

    def get_xiaohongshu_manage_url(self):
        return "https://creator.xiaohongshu.com/new/note-manager"

    async def verify_xiaohongshu_manage_contains(self, page, expected_text, timeout_ms=30000):
        """
        小红书发布完成后，去“笔记管理”页核对最新笔记是否出现。
        """
        normalized_text = " ".join((expected_text or "").replace("\xa0", " ").split())
        if not normalized_text:
            return False

        # 列表页通常会展示完整标题；如果发生截断，退化到前缀匹配。
        markers = [normalized_text]
        if len(normalized_text) > 24:
            markers.append(normalized_text[:24].strip())
        if len(normalized_text) > 16:
            markers.append(normalized_text[:16].strip())
        markers = [marker for marker in markers if marker]

        verify_page = None
        manage_url = self.get_xiaohongshu_manage_url()
        deadline = time.monotonic() + timeout_ms / 1000

        try:
            verify_page = await page.context.new_page()
            while time.monotonic() < deadline:
                await verify_page.goto(manage_url, wait_until='domcontentloaded', timeout=self.page_load_timeout)
                await verify_page.wait_for_timeout(2500)
                body_text = " ".join((await verify_page.locator('body').inner_text()).replace("\xa0", " ").split())
                if any(marker in body_text for marker in markers):
                    self.logger.info("小红书笔记管理页已检索到刚发布的内容")
                    self.set_result_url(manage_url, url_type="manage", label="查看后台")
                    return True
                await verify_page.wait_for_timeout(1500)
            return False
        except Exception as e:
            self.logger.warning(f"小红书笔记管理页核验失败: {str(e)}")
            return False
        finally:
            if verify_page:
                try:
                    await verify_page.close()
                except Exception:
                    pass

    async def wait_xiaohongshu_publish_result(self, page, timeout_ms=30000):
        """
        小红书图文发布后通常不会重新出现可见上传按钮，需要等待跳转或成功提示。
        """
        success_texts = [
            "发布成功",
            "笔记发布成功",
            "笔记已发布",
            "发布完成",
            "内容已发布",
            "审核中",
            "正在审核",
        ]
        deadline = time.monotonic() + timeout_ms / 1000
        target_url = self.get_target_url()
        quick_check_deadline = min(deadline, time.monotonic() + 8)

        while time.monotonic() < quick_check_deadline:
            current_url = page.url
            if "/new/note-manager" in current_url:
                self.set_result_url(current_url, url_type="manage", label="查看后台")
                return True

            if target_url not in current_url and "creator.xiaohongshu.com" in current_url:
                self.set_result_url(current_url, url_type="manage", label="查看后台")
                return True

            for text in success_texts:
                locator = page.locator(f"text={text}").first
                try:
                    if await locator.count() > 0 and await locator.is_visible():
                        self.set_result_url(current_url or self.personal_url, url_type="manage", label="查看后台")
                        return True
                except Exception:
                    continue

            self.last_publish_error = await self.get_xiaohongshu_publish_error(page)
            if self.last_publish_error:
                return False

            await page.wait_for_timeout(1000)

        marker = (self.title or self.text or "").strip()
        remaining_ms = max(1000, int((deadline - time.monotonic()) * 1000))
        if await self.verify_xiaohongshu_manage_contains(page, marker, timeout_ms=remaining_ms):
            return True

        self.last_publish_error = await self.get_xiaohongshu_publish_error(page)
        return False

    async def verify_wechat_official_draft_contains(self, page, expected_text, timeout_ms=30000):
        """
        公众号后台自动化当前实际落点是草稿箱，发布后去草稿箱核对标题是否出现。
        """
        expected_text = " ".join((expected_text or "").replace("\xa0", " ").split())
        if not expected_text:
            return False

        token = self.extract_token_from_url(page.url) or self.extract_token_from_url(self.personal_url)
        if not token:
            self.logger.warning("公众号草稿箱核对失败：未获取到 token")
            return False

        verify_page = await page.context.new_page()
        draft_url = self.build_wechat_official_draft_url(token)
        deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
        try:
            while asyncio.get_event_loop().time() < deadline:
                await verify_page.goto(draft_url, wait_until='domcontentloaded', timeout=self.page_load_timeout)
                await verify_page.wait_for_timeout(3000)
                body_text = " ".join((await verify_page.locator('body').inner_text()).replace("\xa0", " ").split())
                if expected_text in body_text:
                    self.logger.info(f"公众号草稿箱已检索到内容: {expected_text}")
                    self.set_result_url(draft_url, url_type="draft", label="查看草稿")
                    return True
                await verify_page.wait_for_timeout(1500)
        except Exception as e:
            self.logger.warning(f"公众号草稿箱核对失败，继续回退到页面态判定: {str(e)}")
        finally:
            await verify_page.close()

        return False

    async def handle_baijiahao_phone_verification(self, page):
        """
        百家号发布时可能触发手机号验证，需等待人工完成。
        """
        verification_selectors = [
            'text=手机号验证',
            'text=手机验证',
            'text=验证手机号',
            'text=请输入验证码',
            'text=获取验证码'
        ]

        verification_visible = False
        for selector in verification_selectors:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    verification_visible = True
                    break
            except Exception:
                continue

        if not verification_visible:
            return

        self.logger.warning("百家号发布触发手机号验证")
        if self.headless:
            raise Exception("百家号发布触发手机号验证，请切换有头模式后在浏览器中完成验证")

        self.logger.info("请在浏览器中完成百家号手机号验证，程序将继续等待发布结果")
        for _ in range(180):
            still_visible = False
            for selector in verification_selectors:
                locator = page.locator(selector).first
                try:
                    if await locator.count() > 0 and await locator.is_visible():
                        still_visible = True
                        break
                except Exception:
                    continue

            if not still_visible:
                self.logger.info("百家号手机号验证已完成")
                await page.wait_for_timeout(1000)
                return

            await page.wait_for_timeout(1000)

        raise Exception("百家号手机号验证超时，请完成验证后重试")

    async def get_baijiahao_publish_error(self, page):
        """
        读取百家号页面上可见的发布错误提示。
        """
        error_selectors = [
            '.cheetah-message-notice-error',
            '.cheetah-form-item-explain-error',
            'text=请添加横版封面',
            'text=请添加竖版封面',
            'text=请选择内容分类',
            'text=手机号验证',
            'text=手机验证',
            'text=请输入验证码'
        ]

        for selector in error_selectors:
            locator = page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible():
                    text = (await locator.inner_text()).strip()
                    if text:
                        return text.replace("\n", " ")
            except Exception:
                continue

        return ""

    async def set_thumbnail(self, page):
        """
        设置视频封面
        """
        if self.platform_name == "baijiahao" and not self.thumbnail_path:
            for attempt in range(3):
                missing_cover_buttons = page.locator('.form-cover [data-testid="select-cover"]')
                if await missing_cover_buttons.count() == 0:
                    self.logger.info("百家号未检测到缺失的封面槽位，结束封面补齐")
                    return

                self.logger.info(f"百家号补封面第 {attempt + 1} 次")
                thumbnail_button = missing_cover_buttons.first
                await thumbnail_button.click()
                await page.wait_for_timeout(1000)

                thumbnail_finish = await self.find_button(self.thumbnail_finish_selectors)
                if thumbnail_finish:
                    await thumbnail_finish.click()
                    await page.wait_for_timeout(1200)

                if await page.locator('.form-cover [data-testid="select-cover"]').count() == 0:
                    self.logger.info("百家号横竖版封面已补齐")
                    return

            self.logger.warning("百家号封面补齐达到最大尝试次数，继续后续流程")
            return

        if self.thumbnail_path:
            self.logger.info(f"  [-] 将点击封面选择按钮: {await self.find_button(self.thumbnail_button_selectors).text_content()}")
            await self.find_button(self.thumbnail_button_selectors).click()
            self.logger.info(f"  [-] 将点击封面上传按钮: {await self.find_button(self.thumbnail_upload_selectors).text_content()}")
            await self.find_button(self.thumbnail_upload_selectors).set_input_files(self.thumbnail_path)
            await page.wait_for_timeout(2000)  # 等待2秒
            self.logger.info(f"  [-] 将点击封面确认按钮: {await self.find_button(self.thumbnail_finish_selectors).text_content()}")
            await self.find_button(self.thumbnail_finish_selectors).click()
            self.logger.info(f"  [-] 将点击封面关闭按钮: {await self.find_button(self.thumbnail_close_selectors).text_content()}")
            await self.find_button(self.thumbnail_close_selectors).click()
            await page.wait_for_timeout(2000)  # 等待2秒
        else:
            self.logger.info("  [-] 将点击封面选择按钮")
            thumbnail_button = await self.find_button(self.thumbnail_button_selectors)
            if thumbnail_button:
                await thumbnail_button.click()
            await page.wait_for_timeout(2000)  # 等待2秒
            self.logger.info("  [-] 将点击封面确认按钮")
            thumbnail_finish =await self.find_button(self.thumbnail_finish_selectors)
            if thumbnail_finish:
                await thumbnail_finish.click()
            await page.wait_for_timeout(2000)  # 等待2秒


    async def set_location(self, page):
        """
        设置视频发布位置
        """
        if not self.location:
            return
        await page.locator('div.semi-select span:has-text("输入地理位置")').click()

    async def click_baijiahao_category_item(self, menu, preferred_texts):
        """
        在百家号分类菜单中优先点击指定文本，找不到时退回到首项。
        """
        for text in preferred_texts:
            item = menu.locator(".cheetah-cascader-menu-item").filter(has_text=text).first
            if await item.count() > 0:
                await item.click()
                return text

        fallback_item = menu.locator(".cheetah-cascader-menu-item").first
        if await fallback_item.count() == 0:
            return ""

        fallback_text = (await fallback_item.inner_text()).strip()
        await fallback_item.click()
        return fallback_text

    async def ensure_baijiahao_video_category(self, page):
        """
        百家号视频发布前必须选择内容分类，而且要依次完成一级和二级分类。
        """
        try:
            cascader = page.locator(".video-category").first
            if await cascader.count() == 0:
                self.logger.warning("未找到百家号内容分类控件，跳过自动选择")
                return True

            selector = cascader.locator(".cheetah-select-selector").first
            current_text = (await selector.inner_text()).strip()
            if current_text and "请选择内容分类" not in current_text:
                self.logger.info(f"百家号内容分类已存在: {current_text}")
                return True

            await selector.click()
            await page.wait_for_timeout(self.wait_timeout_500ms)

            menus = page.locator(".cheetah-cascader-menu")
            await menus.first.wait_for(state="visible", timeout=self.button_visible_timeout)

            primary_text = await self.click_baijiahao_category_item(
                menus.nth(0),
                ["其他", "其它", "生活", "科技"]
            )
            await page.wait_for_timeout(self.wait_timeout_500ms)

            second_menu = menus.nth(1)
            await second_menu.wait_for(state="visible", timeout=self.button_visible_timeout)
            secondary_text = await self.click_baijiahao_category_item(
                second_menu,
                ["其他", "其它"]
            )
            await page.wait_for_timeout(self.wait_timeout_500ms)

            selected_text = (await selector.inner_text()).strip()
            if "请选择内容分类" in selected_text or not selected_text:
                self.logger.warning("百家号内容分类选择后仍未生效")
                return False

            self.logger.info(f"百家号内容分类已选择: {selected_text or f'{primary_text} / {secondary_text}'}")
            return True
        except Exception as e:
            self.logger.error(f"百家号内容分类设置失败: {str(e)}")
            return False

    async def ensure_sohu_video_category(self, page):
        """
        搜狐视频发布前需要补齐频道二级分类，否则点击发布不会真正触发发布请求。
        """
        try:
            channel_section = page.locator("div.option-item").filter(has_text="频道分类").first
            if await channel_section.count() == 0:
                self.logger.warning("未找到搜狐频道分类区域，跳过二级分类设置")
                return True

            dropdowns = channel_section.locator("div.select.plugin-dropdown")
            if await dropdowns.count() < 2:
                self.logger.warning("搜狐频道分类未出现二级下拉框，跳过二级分类设置")
                return True

            second_dropdown = dropdowns.nth(1)
            selected_text = (await second_dropdown.locator(".select-text").inner_text()).strip()
            if selected_text and selected_text != "请选择":
                self.logger.info(f"搜狐频道二级分类已存在: {selected_text}")
                return True

            await second_dropdown.locator(".select-main").click()
            await page.wait_for_timeout(self.wait_timeout_500ms)

            option = second_dropdown.locator("ul li").first
            await option.wait_for(state="visible", timeout=self.button_visible_timeout)
            option_text = (await option.inner_text()).strip()
            await option.click()
            await page.wait_for_timeout(self.wait_timeout_500ms)
            self.logger.info(f"搜狐频道二级分类已选择: {option_text}")
            return True
        except Exception as e:
            self.logger.error(f"搜狐频道二级分类设置失败: {str(e)}")
            return False
        await page.keyboard.press("Backspace")
        await page.wait_for_timeout(2000)
        await page.keyboard.type(location)
        await page.wait_for_selector('div[role="listbox"] [role="option"]', timeout=5000)
        await page.locator('div[role="listbox"] [role="option"]').first.click()
    
    async def set_schedule_time(self, page, publish_date):
        """
        设置定时发布时间
        """
        # 使用find_button方法查找定时发布按钮
        schedule_button = await self.find_button(self.schedule_button_selectors)
        if not schedule_button:
            raise Exception("未找到定时发布按钮")
        self.logger.info(f"  [-] 将点击定时发布按钮: {await schedule_button.text_content()}")
        await schedule_button.wait_for(state='visible')
        await schedule_button.click()

        # 解析时间戳
        publish_datetime = publish_date
        if isinstance(publish_date, int):
            publish_datetime = datetime.fromtimestamp(publish_date)

        # 设置日期和时间
        await page.fill('[aria-label="Date"]', publish_datetime.strftime(self.date_format))
        await page.fill('[aria-label="Time"]', publish_datetime.strftime(self.time_format))
        
        self.logger.info(f"  [-] 定时发布时间设置为: {publish_datetime}")

    async def click_publish(self, page):
        """
        作用：点击发布按钮并等待发布完成
        参数：
            page: Playwright页面对象
        返回值：
            bool: 发布是否成功
        """
        max_attempts = 1 if self.platform_name in {"sohu", "jianshu", "zhihu", "omqq", "wangyi_mp"} else self.max_publish_attempts
        attempt = 0
        
        # 上传按钮选择器列表
        while attempt < max_attempts and not self.publish_status:
            attempt += 1
            try:
                toutiao_network_events = []
                if self.is_csdn_platform() and self.is_draft:
                    self.publish_status = await self.save_csdn_draft(page)
                    if self.publish_status:
                        break
                    self.last_publish_error = "CSDN 草稿保存失败"
                    self.logger.warning("CSDN 草稿未保存成功，准备重试")
                    continue
                if self.is_jianshu_platform() and self.is_draft:
                    self.publish_status = await self.save_jianshu_draft(page)
                    if self.publish_status:
                        break
                    self.last_publish_error = self.last_publish_error or "简书草稿保存失败"
                    self.logger.warning(self.last_publish_error)
                    continue
                if self.is_zhihu_platform() and self.is_draft:
                    self.publish_status = await self.save_zhihu_draft(page)
                    if self.publish_status:
                        break
                    self.last_publish_error = self.last_publish_error or "知乎草稿保存失败"
                    self.logger.warning(self.last_publish_error)
                    continue
                if self.is_weibo_article_mode() and self.is_draft:
                    self.publish_status = await self.save_weibo_article_draft(page)
                    if self.publish_status:
                        break
                    self.last_publish_error = self.last_publish_error or "微博文章草稿保存失败"
                    self.logger.warning(self.last_publish_error)
                    continue
                if self.is_omqq_platform() and self.is_draft:
                    self.publish_status = await self.save_omqq_draft(page)
                    if self.publish_status:
                        break
                    self.last_publish_error = self.last_publish_error or "企鹅号草稿保存失败"
                    self.logger.warning(self.last_publish_error)
                    continue
                if self.is_wangyi_platform() and self.is_draft:
                    self.publish_status = await self.save_wangyi_draft(page)
                    if self.publish_status:
                        break
                    self.last_publish_error = self.last_publish_error or "网易号草稿保存失败"
                    self.logger.warning(self.last_publish_error)
                    continue
                if self.is_wechat_official_platform() and self.file_type == 1 and self.is_draft:
                    self.publish_status = await self.save_wechat_official_draft(page)
                    if self.publish_status:
                        break
                    self.last_publish_error = "公众号草稿保存失败"
                    self.logger.warning("公众号草稿未保存成功，准备重试")
                    continue
                if self.is_toutiao_platform():
                    await self.dismiss_toutiao_tip(page)
                    blocker_error = await self.get_toutiao_account_blocker_error(page)
                    if blocker_error:
                        self.last_publish_error = blocker_error
                        self.logger.warning(f"头条发布终止，不再重试: {blocker_error}")
                        break
                    if self.content_mode == "article":
                        publish_button_selectors = self.article_publish_button_selectors
                    elif self.content_mode == "weitoutiao":
                        publish_button_selectors = self.weitoutiao_publish_button_selectors
                    else:
                        publish_button_selectors = self.video_publish_button_selectors
                else:
                    publish_button_selectors = self.publish_button_selectors

                # 步骤1: 查找并点击发布按钮
                if self.is_x_platform():
                    publish_button = await self.get_x_publish_button()
                elif self.is_douban_platform():
                    publish_button = await self.get_douban_publish_button()
                elif self.is_weibo_platform():
                    publish_button = await self.get_weibo_publish_button()
                elif self.is_jianshu_platform():
                    publish_button = await self.click_jianshu_publish_button(page)
                else:
                    publish_button = await self.find_button(publish_button_selectors)
                if not publish_button and self.is_jianshu_platform():
                    self.last_publish_error = await self.get_jianshu_publish_error(page) or "未找到简书发布按钮，已停止本次发布"
                    self.logger.warning(self.last_publish_error)
                    break
                if publish_button:
                    if self.is_wangyi_platform():
                        await self.prepare_wangyi_cover(page)
                    if self.is_omqq_platform():
                        self.last_publish_error = await self.get_omqq_publish_error(page)
                        if await publish_button.is_disabled():
                            raise Exception(self.last_publish_error or "企鹅号当前发布按钮仍不可点击")
                    if self.is_toutiao_video_mode():
                        page.on("response", lambda response: self.record_toutiao_network_event(response, toutiao_network_events))
                        await self.dump_toutiao_video_debug_artifacts(
                            page,
                            f"attempt_{attempt}_before_publish",
                            {
                                "attempt": attempt,
                                "publishSelectors": publish_button_selectors
                            }
                        )
                        publish_ready = await self.wait_toutiao_video_publish_ready(page, publish_button)
                        if not publish_ready:
                            await self.dump_toutiao_video_debug_artifacts(
                                page,
                                f"attempt_{attempt}_publish_not_ready",
                                {
                                    "attempt": attempt,
                                    "networkEvents": toutiao_network_events
                                }
                            )

                    if self.is_toutiao_platform() and self.is_toutiao_fatal_publish_error(self.last_publish_error):
                        self.logger.warning(f"头条发布终止，不再点击发布: {self.last_publish_error}")
                        break
                    if self.platform_name == "tencent":
                        # 等待「发表」按钮解除 weui-desktop-btn_disabled 再点击
                        tencent_ready = False
                        for _wait in range(15):
                            st = await self.inspect_tencent_upload_state(page)
                            if st.get("hasUploadError"):
                                self.last_publish_error = "视频号视频上传失败，无法发表"
                                break
                            if not st.get("publishDisabled", True) and not st.get("isUploading"):
                                tencent_ready = True
                                break
                            self.logger.info(f"视频号等待「发表」按钮可用({_wait + 1}/15): {st}")
                            await asyncio.sleep(3)
                        if not tencent_ready:
                            if not self.last_publish_error:
                                self.last_publish_error = "视频号「发表」按钮仍不可点击（视频未上传完成或内容校验未通过）"
                            self.logger.error(self.last_publish_error)
                            break
                        await publish_button.scroll_into_view_if_needed()
                        await publish_button.click()
                        try:
                            await page.wait_for_url(lambda u: "/post/create" not in str(u), timeout=15000)
                        except Exception:
                            await asyncio.sleep(3)
                    elif self.is_toutiao_platform():
                        await publish_button.click(force=self.is_toutiao_video_mode())
                    elif self.is_wechat_official_platform():
                        await publish_button.scroll_into_view_if_needed()
                        await publish_button.evaluate("el => el.click()")
                    elif self.is_x_platform() or self.is_weibo_platform() or self.is_douban_platform() or self.is_tieba_platform():
                        await publish_button.scroll_into_view_if_needed()
                        await publish_button.evaluate("el => el.click()")
                    elif self.is_jianshu_platform():
                        pass
                    else:
                        await publish_button.click()
                    await asyncio.sleep(self.check_interval)
                    if self.is_jianshu_platform():
                        bind_error = await self.get_jianshu_publish_error(page)
                        if bind_error:
                            self.last_publish_error = bind_error
                            self.logger.warning(self.last_publish_error)
                            break
                        await self.handle_jianshu_publish_confirmation(page)
                    if self.is_wangyi_platform():
                        wangyi_publish_done = await self.handle_wangyi_publish_precheck(page)
                        if wangyi_publish_done:
                            self.publish_status = True
                            break
                    if self.is_weibo_article_mode():
                        verification_ready = await self.handle_weibo_security_verification(page)
                        if not verification_ready:
                            continue
                    if self.is_toutiao_video_mode():
                        await page.wait_for_timeout(5000)
                        await self.dump_toutiao_video_debug_artifacts(
                            page,
                            f"attempt_{attempt}_after_publish_click",
                            {
                                "attempt": attempt,
                                "networkEvents": toutiao_network_events
                            }
                        )
                        try:
                            await page.wait_for_url("**/xigua/content-manage-v2**", timeout=15000)
                        except Exception:
                            await page.wait_for_timeout(10000)
                        await self.dump_toutiao_video_debug_artifacts(
                            page,
                            f"attempt_{attempt}_after_publish_wait",
                            {
                                "attempt": attempt,
                                "networkEvents": toutiao_network_events
                            }
                        )
                        if await self.handle_toutiao_video_publish_blockers(page):
                            publish_button = await self.find_button(publish_button_selectors)
                            if publish_button:
                                await self.wait_toutiao_video_publish_ready(page, publish_button)
                                await publish_button.click(force=True)
                                await page.wait_for_timeout(5000)
                                await self.dump_toutiao_video_debug_artifacts(
                                    page,
                                    f"attempt_{attempt}_after_blocker_retry_click",
                                    {
                                        "attempt": attempt,
                                        "networkEvents": toutiao_network_events
                                    }
                                )
                    if self.is_toutiao_platform() and self.content_mode == "article":
                        confirmation_ready = await self.wait_toutiao_article_publish_confirmation(page)
                        if not confirmation_ready:
                            if self.is_toutiao_fatal_publish_error(self.last_publish_error):
                                self.logger.warning(f"头条文章发布终止: {self.last_publish_error}")
                                break
                            continue
                    if self.is_toutiao_platform():
                        await self.handle_toutiao_sync_authorization(page)
                    if self.platform_name == "sohu" and self.file_type == 1:
                        await self.handle_sohu_article_publish_confirmation(page)
                    if self.is_wechat_official_platform() and self.file_type == 1:
                        await self.handle_wechat_official_publish_confirmation(page)
                    if self.is_douyin_platform():
                        # 抖音第一下「发布」只是进入作品详情页，底部还要再点一次「发布」才算提交
                        await self.confirm_douyin_detail_page(page)
                    if self.is_csdn_platform():
                        confirm_result = await self.handle_csdn_publish_confirmation(page)
                        if not confirm_result:
                            continue
                    # tiktok平台发布时要检查并处理版权检查弹窗
                    if self.platform_name == "tiktok":
                        # 等待版权检查弹窗出现
                        try:
                            await page.wait_for_selector('button.TUXButton.TUXButton--primary div.TUXButton-label:has-text("Post now")', timeout=5000)
                            self.logger.info("  [-]检测到版权检查弹窗，准备点击Post now按钮")
                            # 使用更精确的选择器点击Post now按钮
                            await self.locator_base.locator('button.TUXButton.TUXButton--primary div.TUXButton-label >> text=Post now').click()
                            self.logger.info("  [-]已点击Post now按钮")
                            # 等待操作完成
                            await page.wait_for_timeout(2000)
                        except Exception as e:
                            self.logger.warning(f"  [-]未检测到版权检查弹窗或点击失败: {str(e)}")
                    if self.is_x_platform():
                        await page.wait_for_timeout(4000)


                # 步骤2: 等待视频处理完成（通过检查上传按钮重新出现）
                self.logger.info("等待发布完成...")
                current_url = page.url
                self.logger.info(f"当前url: {current_url}")
                if self.platform_name == "sohu":
                    try:
                        await page.wait_for_url("**/contentManagement/first/page**", timeout=self.button_visible_timeout)
                    except Exception:
                        pass

                    current_url = page.url
                    if "contentManagement/first/page" in current_url:
                        self.publish_status = True
                        break

                    if await page.locator("text=发布成功").count() > 0:
                        self.publish_status = True
                        break

                    self.logger.warning("搜狐未检测到发布完成跳转或成功提示")
                    continue
                if self.is_wechat_official_platform():
                    self.last_publish_error = await self.get_wechat_official_publish_error(page)
                    draft_verified = await self.verify_wechat_official_draft_contains(page, self.title)
                    if draft_verified:
                        self.publish_status = True
                        break

                    if "appmsgid=" in current_url or await page.locator("text=保存成功").count() > 0:
                        self.logger.info("公众号文章已保存到编辑页，但草稿箱暂未立即检索到标题，按页面成功态继续")
                        self.publish_status = True
                        break

                    if self.last_publish_error:
                        self.logger.warning(f"公众号页面提示: {self.last_publish_error}")
                    else:
                        self.logger.warning("公众号未检测到保存成功提示，准备重试")
                    continue
                if self.is_csdn_platform():
                    success_texts = ["发布成功！正在审核中", "查看文章", "管理博文", "再写一篇"]
                    if any([await page.locator(f"text={text}").count() > 0 for text in success_texts]):
                        self.publish_status = True
                        break

                    self.last_publish_error = await self.get_csdn_publish_error(page)
                    if await self.verify_csdn_manage_contains(page, self.title):
                        self.publish_status = True
                        break

                    if self.last_publish_error:
                        self.logger.warning(f"CSDN 页面提示: {self.last_publish_error}")
                    else:
                        self.logger.warning("CSDN 管理页暂未检索到刚发布的内容，准备重试")
                    continue
                if self.is_jianshu_platform():
                    self.last_publish_error = await self.get_jianshu_publish_error(page)
                    if self.last_publish_error:
                        self.logger.warning(f"简书页面提示: {self.last_publish_error}")
                        break

                    if await self.is_jianshu_publish_succeeded(page):
                        self.publish_status = True
                        break

                    self.logger.warning("简书未检测到发布完成跳转或成功提示")
                    continue
                if self.is_zhihu_platform():
                    self.last_publish_error = await self.get_zhihu_publish_error(page)

                    success_texts = ["发布成功", "内容已发布", "文章已发布", "发布完成", "审核中"]
                    if any([await page.locator(f"text={text}").count() > 0 for text in success_texts]):
                        self.publish_status = True
                        break

                    if "/write" not in current_url and "signin" not in current_url:
                        self.publish_status = True
                        break

                    if self.last_publish_error:
                        self.logger.warning(f"知乎页面提示: {self.last_publish_error}")
                    else:
                        self.logger.warning("知乎未检测到发布完成跳转或成功提示")
                    continue
                if self.is_x_platform():
                    self.last_publish_error = await self.get_x_publish_error(page)

                    success_texts = ["Your post was sent", "Post sent", "Your post was posted"]
                    if any([await page.locator(f"text={text}").count() > 0 for text in success_texts]):
                        self.publish_status = True
                        break

                    if "/compose/post" not in current_url and "/login" not in current_url:
                        self.publish_status = True
                        break

                    if self.last_publish_error:
                        self.logger.warning(f"X 页面提示: {self.last_publish_error}")
                    else:
                        self.logger.warning("X 未检测到发布完成跳转或成功提示")
                    continue
                if self.is_weibo_platform():
                    if self.is_weibo_article_mode():
                        self.last_publish_error = await self.get_weibo_publish_error(page)

                        success_texts = ["发布成功", "文章发布成功", "已发布", "发布完成"]
                        if any([await page.locator(f"text={text}").count() > 0 for text in success_texts]):
                            self.publish_status = True
                            break

                        if "security.weibo.com/captcha" not in current_url and "card.weibo.com/article/v5/editor" not in current_url:
                            self.publish_status = True
                            break

                        if self.last_publish_error:
                            self.logger.warning(f"微博文章页面提示: {self.last_publish_error}")
                        else:
                            self.logger.warning("微博文章未检测到发布完成提示，准备重试")
                        continue

                    self.last_publish_error = await self.get_weibo_publish_error(page)

                    success_texts = ["发布成功", "发送成功", "微博已发送"]
                    if any([await page.locator(f"text={text}").count() > 0 for text in success_texts]):
                        self.publish_status = True
                        break

                    marker = (self.build_weibo_post_text() or "").strip()
                    if marker and await self.verify_weibo_profile_contains(page, marker[:40]):
                        self.publish_status = True
                        break

                    try:
                        textarea = page.locator('textarea[placeholder*="新鲜事"]').first
                        textarea_value = ""
                        if await textarea.count() > 0:
                            textarea_value = (await textarea.input_value()).strip()
                        publish_button = await self.get_weibo_publish_button()
                        if not textarea_value and publish_button and await publish_button.is_disabled():
                            self.publish_status = True
                            break
                    except Exception:
                        pass

                    if self.last_publish_error:
                        self.logger.warning(f"微博页面提示: {self.last_publish_error}")
                    else:
                        self.logger.warning("微博未检测到发布完成提示，准备重试")
                    continue
                if self.is_douban_platform():
                    self.last_publish_error = await self.get_douban_publish_error(page)

                    success_texts = ["发布成功", "发表成功", "已发布"]
                    if any([await page.locator(f"text={text}").count() > 0 for text in success_texts]):
                        self.publish_status = True
                        break

                    marker = (self.title or "").strip() if self.is_douban_article_mode() else (self.build_douban_post_text() or "").strip()
                    if marker and await self.verify_douban_home_contains(page, marker[:40]):
                        self.publish_status = True
                        break

                    if self.is_douban_article_mode() and "subtype=note" not in current_url and "douban.com/" in current_url:
                        self.publish_status = True
                        break

                    try:
                        publish_button = await self.get_douban_publish_button()
                        if publish_button and await publish_button.is_visible() and await publish_button.is_disabled():
                            self.logger.warning(self.last_publish_error or "豆瓣发布按钮仍不可点击，继续等待下一轮重试")
                        elif self.is_douban_post_mode():
                            body_input = page.locator('div.DRE-inputor.DRE-root[contenteditable="true"]').first
                            if await body_input.count() > 0:
                                body_text = " ".join((await body_input.inner_text()).replace("\xa0", " ").split())
                                if not body_text and not self.last_publish_error:
                                    self.publish_status = True
                                    break
                    except Exception:
                        pass

                    if self.last_publish_error:
                        self.logger.warning(f"豆瓣页面提示: {self.last_publish_error}")
                    else:
                        self.logger.warning("豆瓣首页暂未检索到刚发布的内容，准备重试")
                    continue
                if self.is_omqq_platform():
                    self.last_publish_error = await self.get_omqq_publish_error(page)

                    success_texts = ["发布成功", "提交成功", "审核中", "内容已发布"]
                    if any([await page.locator(f"text={text}").count() > 0 for text in success_texts]):
                        self.publish_status = True
                        break

                    if "/main/creation/article" not in current_url and "om.qq.com" in current_url:
                        self.publish_status = True
                        break

                    if self.last_publish_error:
                        self.logger.warning(f"企鹅号页面提示: {self.last_publish_error}")
                    else:
                        self.logger.warning("企鹅号未检测到发布完成提示")
                    continue
                if self.is_wangyi_platform():
                    self.last_publish_error = await self.get_wangyi_publish_error(page)

                    success_texts = ["发布成功", "提交成功", "审核中", "内容已发布", "发表成功"]
                    if any([await page.locator(f"text={text}").count() > 0 for text in success_texts]):
                        self.publish_status = True
                        break

                    if "article-publish" not in current_url and "mp.163.com" in current_url:
                        self.publish_status = True
                        break

                    if self.last_publish_error:
                        self.logger.warning(f"网易号页面提示: {self.last_publish_error}")
                    else:
                        self.logger.warning("网易号未检测到发布完成提示")
                    continue
                if self.is_tieba_platform():
                    self.last_publish_error = await self.get_tieba_publish_error(page)

                    success_texts = ["发贴成功", "发帖成功", "发表成功"]
                    if any([await page.locator(f"text={text}").count() > 0 for text in success_texts]):
                        self.publish_status = True
                        break

                    if "/p/" in current_url:
                        self.publish_status = True
                        break

                    marker = (self.title or "").strip()
                    if marker and await self.verify_tieba_bar_contains(page, marker[:40]):
                        self.publish_status = True
                        break

                    if self.last_publish_error:
                        self.logger.warning(f"贴吧页面提示: {self.last_publish_error}")
                    else:
                        self.logger.warning("贴吧列表页暂未检索到刚发布的帖子，准备重试")
                    continue
                if self.platform_name == "baijiahao":
                    await self.handle_baijiahao_phone_verification(page)
                    self.last_publish_error = await self.get_baijiahao_publish_error(page)
                    if self.last_publish_error:
                        self.logger.warning(f"百家号页面提示: {self.last_publish_error}")

                    current_url = page.url
                    if "builder/rc/edit" not in current_url:
                        self.publish_status = True
                        break

                    success_texts = ["发布成功", "内容已提交", "提交成功", "审核中", "处理中"]
                    success_detected = False
                    for text in success_texts:
                        if await page.locator(f"text={text}").count() > 0:
                            success_detected = True
                            break
                    if success_detected:
                        self.publish_status = True
                        break

                    if self.last_publish_error:
                        self.logger.warning(f"百家号未检测到发布完成，当前阻塞提示: {self.last_publish_error}")
                    else:
                        self.logger.warning("百家号未检测到发布完成，可能仍停留在验证或提交流程中")
                    continue
                if self.is_xiaohongshu_platform() and self.file_type == 1:
                    publish_ready = await self.wait_xiaohongshu_publish_result(page)
                    if publish_ready:
                        self.publish_status = True
                        break

                    if self.last_publish_error:
                        self.logger.warning(f"小红书页面提示: {self.last_publish_error}")
                    else:
                        self.logger.warning("小红书未检测到发布完成跳转或成功提示")
                    continue
                if self.is_toutiao_platform():
                    blocker_error = await self.get_toutiao_account_blocker_error(page)
                    if blocker_error or self.is_toutiao_fatal_publish_error(self.last_publish_error):
                        self.last_publish_error = blocker_error or self.last_publish_error
                        self.logger.warning(f"头条发布终止，不再重试: {self.last_publish_error}")
                        break
                    marker = self.title if self.content_mode != "weitoutiao" else self.build_toutiao_weitoutiao_text()[:30]
                    if await self.verify_toutiao_manage_contains(page, marker):
                        self.publish_status = True
                        break
                    if self.is_toutiao_fatal_publish_error(self.last_publish_error):
                        self.logger.warning(f"头条发布终止，不再重试: {self.last_publish_error}")
                        break
                    if self.is_toutiao_video_mode():
                        await self.dump_toutiao_video_debug_artifacts(
                            page,
                            f"attempt_{attempt}_verify_failed",
                            {
                                "attempt": attempt,
                                "networkEvents": toutiao_network_events
                            }
                        )
                    self.logger.warning("头条作品管理页暂未检索到刚发布的内容，准备重试")
                    continue
                #ks平台、视频号平台等待发布完成的逻辑：如果当前url已不在发布页面，说明发布成功
                blocker = await self.detect_common_blocker(page)
                if blocker:
                    self.logger.error(blocker)
                    if self.is_human_action_blocker(blocker) and not self.is_headless_runtime():
                        cleared = await self.wait_human_verification(page, blocker)
                        if cleared:
                            self.logger.info("人工验证已完成，继续发布流程")
                            continue
                    self.last_publish_error = blocker
                    break
                if self.is_douyin_platform() and ("/content/post/" in current_url or "/content/upload" in current_url):
                    self.logger.info(f"抖音仍停留在发布页({current_url})，不算发布成功，继续等待")
                    await asyncio.sleep(2)
                    continue
                if self.platform_name == "tencent":
                    st = await self.inspect_tencent_upload_state(page)
                    if "/post/create" not in current_url or st.get("publishSuccess"):
                        self.publish_status = True
                        break
                    self.logger.info(f"视频号仍停留在发表页({current_url})，不算发布成功，继续等待: {st}")
                    await asyncio.sleep(3)
                    continue
                target_url = self.get_target_url()
                if target_url not in current_url:
                    self.publish_status = True
                    break
                #xx平台等待发布完成：尝试查找上传按钮，如果上传按钮可见，也能说明发布成功
                upload_button = await self.find_button(self.upload_button_selectors)
                if upload_button:
                    self.logger.info(f"发布尝试 {attempt}，上传按钮可见状态: {await upload_button.is_visible()}")
                    await upload_button.wait_for(state='visible', timeout=self.button_visible_timeout)
                    self.publish_status = True
                    break
                else:
                    self.logger.info(f"发布尝试 {attempt}，未找到上传按钮")
            except Exception as e:
                error_text = str(e)
                if not self.last_publish_error:
                    self.last_publish_error = error_text
                if self.is_toutiao_fatal_publish_error(error_text) or self.is_toutiao_fatal_publish_error(self.last_publish_error):
                    self.last_publish_error = self.match_toutiao_account_restriction(error_text) or self.last_publish_error or error_text
                    self.logger.warning(f"头条发布终止，不再重试: {self.last_publish_error}")
                    break
                # 等待后重试
                self.logger.warning(f"发布尝试 {attempt} 失败，等待重试... {error_text}")
                await asyncio.sleep(min(attempt * 2, self.max_retry_delay))
        
        # 最终状态检查
        if self.publish_status:
            self.capture_result_url_from_page(page)
            if not self.result_url:
                fallback_type = "draft" if self.is_draft else "manage"
                fallback_label = "查看草稿" if fallback_type == "draft" else "查看后台"
                self.set_result_url(self.personal_url or self.get_target_url(), url_type=fallback_type, label=fallback_label)
            self.logger.info(f"{self.get_content_label()}发布完成")
        else:
            if self.last_publish_error:
                self.logger.error(f"{self.get_content_label()}发布失败，已尝试 {max_attempts} 次，最后错误: {self.last_publish_error}")
            else:
                self.logger.error(f"{self.get_content_label()}发布失败，已尝试 {max_attempts} 次")
        return self.publish_status


    async def platform_setup(self, handle=False):
        """
        设置平台账户cookie
        """
        account_file = get_absolute_path(self.account_file, "cookiesFile")
        if not os.path.exists(account_file) or not await self.cookie_auth():
            if not handle:
                return False
            self.logger.info("Cookie文件不存在，需要获取新的Cookie")
            await self.get_platform_cookie(account_file, self.local_executable_path, self.page_load_timeout, self.login_url, self.login_wait_timeout, self.browser_lang)
        return True


    async def cookie_auth(self):
        """
        验证平台的cookie是否有效
        """
        try:
            # 获取平台类型编号
            platform_type = get_type_by_platform_key(self.platform)
            if not platform_type:
                self.logger.error(f"平台 {self.platform} 类型未找到")
                return False
            
            # 提取cookie文件路径（相对路径）
            # 假设self.account_file是完整路径，需要提取相对于cookiesFile目录的部分
            cookie_file_path = os.path.relpath(self.account_file, os.path.join(BASE_DIR, "cookiesFile"))
            
            # 调用通用的Cookie验证方法
            is_valid = await check_cookie_generic(platform_type, cookie_file_path)
            
            if is_valid:
                self.logger.info("Cookie有效")
            else:
                self.logger.error("Cookie已过期")
            
            return is_valid
        except Exception as e:
            self.logger.error(f"Cookie验证失败: {str(e)}")
            return False


    async def get_platform_cookie(self, account_file, executable_path, timeout, login_url, login_wait_timeout, browser_lang):
        """
        获取平台登录cookie
        """
        async with async_playwright() as playwright:
            options = {
                'args': self.login_browser_args,
                'headless': False,  # 登录时需要可视化
                'executable_path': executable_path,
            }
            if self.proxy_config:
                options['proxy'] = self.proxy_config
            # Make sure to run headed.
            browser = await playwright.chromium.launch(**options)
            # Setup context however you like.
            context = await browser.new_context(locale=browser_lang)  # Pass any options
            login_stealth_enabled = self.config["features"].get(
                "login_stealth",
                self.config["features"].get("stealth", True)
            )
            if login_stealth_enabled:
                context = await set_init_script(context)
            # Pause the page, and start recording manually.
            page = await context.new_page()
            await page.goto(self.login_url, wait_until='domcontentloaded', timeout=timeout)
            await page.pause()
            # 等待用户登录完成
            self.logger.info(f"请在浏览器中登录{self.platform_name}账号")
            await page.wait_for_timeout(login_wait_timeout)
            # 保存cookie
            await context.storage_state(path=account_file)
            self.logger.info(f"Cookie已保存到: {account_file}")
            await browser.close()


    async def setup_upload_browser(self, playwright):
        """
        设置上传浏览器
        """
        # 创建浏览器实例
        browser = await playwright.chromium.launch(
            headless=self.headless,
            executable_path=self.local_executable_path,
            args=self.browser_args,
            slow_mo=self.slow_mo
        )
        
        # 创建上下文并加载cookie
        account_file = get_absolute_path(self.account_file, "cookiesFile")
        if os.path.exists(account_file):
            context = await browser.new_context(storage_state=account_file, locale=self.browser_lang)
            if self.stealth_enabled:
                context = await set_init_script(context)
            return browser, context
        else:
            raise FileNotFoundError(f"Cookie文件不存在: {account_file}")

    async def change_language(self, page):
        # set the language to english
        await page.goto("https://www.tiktok.com", timeout=60000)  # 设置60秒超时
        await page.wait_for_load_state('domcontentloaded', timeout=60000)
        await asyncio.sleep(2)
        await page.wait_for_selector('[data-e2e="nav-more-menu"]', timeout=60000)
        # 已经设置为英文, 省略这个步骤
        if await page.locator('[data-e2e="nav-more-menu"]').text_content() == "More":
            return
        await page.locator('[data-e2e="nav-more-menu"]').click()
        await page.locator('[data-e2e="language-select"]').click()
        await page.locator('#creator-tools-selection-menu-header >> text=English (US)').click()




# 工厂函数和便捷函数
async def run_upload(platform, account_file, file_type, file_path, title, text, tags, thumbnail_path, location, publish_date, **kwargs):
    """
    运行单个文件上传到某个平台的任务
    """
    uploader = BaseFileUploader(
        platform,
        account_file,
        file_type,
        file_path,
        title,
        text,
        tags,
        thumbnail_path,
        location,
        publish_date,
        content_mode=kwargs.get("content_mode"),
        is_draft=kwargs.get("is_draft", False),
        forum_name=kwargs.get("forum_name"),
        article_doc=kwargs.get("article_doc"),
        headless_override=kwargs.get("headless_override"),
        progress_callback=kwargs.get("progress_callback"),
        snapshot_callback=kwargs.get("snapshot_callback"),
        desktop_runner_id=kwargs.get("desktop_runner_id"),
    )
    try:
        success = await uploader.main()
        return {
            "success": bool(success),
            "result_url": uploader.result_url or "",
            "result_url_type": uploader.result_url_type or "",
            "result_url_label": uploader.result_url_label or "",
            "error_msg": "" if success else (uploader.last_publish_error or f"{uploader.platform_name}{uploader.get_content_label()}发布失败"),
        }
    except Exception as e:
        uploader.logger.error(f"上传任务失败: {str(e)}")
        return {
            "success": False,
            "result_url": "",
            "result_url_type": "",
            "result_url_label": "",
            "error_msg": uploader.last_publish_error or str(e) or f"{uploader.platform_name}{uploader.get_content_label()}发布失败",
        }


# 特定平台上传器类（用于向后兼容和特殊处理）
# 小红书文件上传器
class XiaohongshuFile(BaseFileUploader):
    """小红书文件上传器"""
    def __init__(self, account_file, file_type, file_path, title, text, tags, thumbnail_path, location, publish_date):
        super().__init__("xiaohongshu", account_file, file_type, file_path, title, text, tags, thumbnail_path, location, publish_date)


if __name__ == "__main__":
    # 示例运行代码
    asyncio.run(run_upload(
        "xiaohongshu",
        "cookies/xhs_cookie.json",
        2,  # 文件类型：2为视频
        "videos/demo.mp4",
        "测试视频标题",
        "测试视频正文",
        "测试 标签",
        "thumbnails/demo.jpg",
        "测试地点",
        0  # 立即发布
    ))
