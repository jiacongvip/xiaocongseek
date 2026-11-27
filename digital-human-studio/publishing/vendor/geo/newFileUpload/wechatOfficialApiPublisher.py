from pathlib import Path

import requests

from utils.log import create_logger
from utils.wechat_official import (
    WECHAT_OFFICIAL_ADD_DRAFT_URL,
    WECHAT_OFFICIAL_SUBMIT_PUBLISH_URL,
    build_wechat_official_article_html,
    load_wechat_official_credentials,
    request_wechat_official_access_token,
    upload_wechat_official_content_image,
    upload_wechat_official_thumb_media,
)


class WechatOfficialApiPublisher:
    def __init__(self, account_file, file_paths, title, text, is_draft=False):
        self.account_file = account_file
        self.file_paths = [Path(file_path) for file_path in file_paths if file_path]
        self.title = (title or "").strip()
        self.text = (text or "").strip()
        self.is_draft = bool(is_draft)
        self.logger = create_logger("wechat_official_api", "logs/wechat_official_api.log")

    def publish(self):
        if not self.title:
            raise ValueError("公众号文章标题不能为空")
        if not self.text:
            raise ValueError("公众号文章正文不能为空")
        if not self.file_paths:
            raise ValueError("公众号 API 发布至少需要一张图片作为封面")

        credentials = load_wechat_official_credentials(self.account_file)
        access_token, _ = request_wechat_official_access_token(credentials)

        self.logger.info("公众号 API access_token 获取成功")

        thumb_media_id = upload_wechat_official_thumb_media(access_token, self.file_paths[0])
        content_image_urls = [
            upload_wechat_official_content_image(access_token, image_path)
            for image_path in self.file_paths
        ]
        content_html = build_wechat_official_article_html(self.text, content_image_urls)
        digest = credentials["digest"] or self.text[:120]

        draft_media_id = self._add_draft(
            access_token=access_token,
            title=self.title,
            content=content_html,
            thumb_media_id=thumb_media_id,
            author=credentials["author"],
            digest=digest,
        )
        self.logger.info(f"公众号草稿创建成功: {draft_media_id}")

        if self.is_draft:
            self.logger.info("公众号 API 当前为草稿模式，跳过自动发布")
            return True

        publish_id = self._submit_publish(access_token, draft_media_id)
        self.logger.info(f"公众号发布任务提交成功: {publish_id}")
        return True

    def _add_draft(self, access_token, title, content, thumb_media_id, author, digest):
        payload = {
            "articles": [
                {
                    "title": title,
                    "author": author,
                    "digest": digest,
                    "content": content,
                    "thumb_media_id": thumb_media_id,
                    "need_open_comment": 0,
                    "only_fans_can_comment": 0,
                }
            ]
        }
        response = requests.post(
            WECHAT_OFFICIAL_ADD_DRAFT_URL,
            params={"access_token": access_token},
            json=payload,
            timeout=60,
        )
        response.raise_for_status()
        data = response.json()
        media_id = data.get("media_id")
        if not media_id:
            raise ValueError(data.get("errmsg") or "公众号草稿创建失败")
        return media_id

    def _submit_publish(self, access_token, media_id):
        response = requests.post(
            WECHAT_OFFICIAL_SUBMIT_PUBLISH_URL,
            params={"access_token": access_token},
            json={"media_id": media_id},
            timeout=60,
        )
        response.raise_for_status()
        data = response.json()
        publish_id = data.get("publish_id")
        if not publish_id:
            raise ValueError(data.get("errmsg") or "公众号发布提交失败")
        return publish_id


def publish_wechat_official_via_api(account_file, file_paths, title, text, is_draft=False):
    publisher = WechatOfficialApiPublisher(account_file, file_paths, title, text, is_draft=is_draft)
    return publisher.publish()
