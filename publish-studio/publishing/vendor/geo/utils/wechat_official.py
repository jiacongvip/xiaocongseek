import html
import json
import mimetypes
from pathlib import Path

import requests

from conf import BASE_DIR


WECHAT_OFFICIAL_API_FILE_PREFIX = "wechat_official_api_"
WECHAT_OFFICIAL_PLATFORM_KEY = "wechat_official"
WECHAT_OFFICIAL_PERSONAL_URL = "https://mp.weixin.qq.com/"
WECHAT_OFFICIAL_TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token"
WECHAT_OFFICIAL_ADD_DRAFT_URL = "https://api.weixin.qq.com/cgi-bin/draft/add"
WECHAT_OFFICIAL_SUBMIT_PUBLISH_URL = "https://api.weixin.qq.com/cgi-bin/freepublish/submit"
WECHAT_OFFICIAL_UPLOAD_IMAGE_URL = "https://api.weixin.qq.com/cgi-bin/media/uploadimg"
WECHAT_OFFICIAL_UPLOAD_MATERIAL_URL = "https://api.weixin.qq.com/cgi-bin/material/add_material"


def resolve_wechat_official_account_path(file_path):
    path = Path(file_path)
    if path.is_absolute():
        return path
    return Path(BASE_DIR / "cookiesFile" / path)


def is_wechat_official_api_credentials(data):
    if not isinstance(data, dict):
        return False
    return bool(data.get("app_id") or data.get("appId") or data.get("appid")) and bool(
        data.get("app_secret") or data.get("appSecret") or data.get("appsecret")
    )


def is_wechat_official_api_account_file(file_path):
    path = resolve_wechat_official_account_path(file_path)
    if path.name.startswith(WECHAT_OFFICIAL_API_FILE_PREFIX):
        return True
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return False
    return is_wechat_official_api_credentials(data)


def load_wechat_official_credentials(file_path):
    path = resolve_wechat_official_account_path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"公众号账号配置不存在: {path}")

    data = json.loads(path.read_text(encoding="utf-8"))
    if not is_wechat_official_api_credentials(data):
        raise ValueError("公众号 API 账号配置缺少 AppID 或 AppSecret")

    app_id = data.get("app_id") or data.get("appId") or data.get("appid")
    app_secret = data.get("app_secret") or data.get("appSecret") or data.get("appsecret")
    return {
        "app_id": str(app_id).strip(),
        "app_secret": str(app_secret).strip(),
        "author": (data.get("author") or "").strip(),
        "digest": (data.get("digest") or "").strip(),
        "driver": data.get("driver") or "api",
        "platform": data.get("platform") or WECHAT_OFFICIAL_PLATFORM_KEY,
        "user_name": (data.get("user_name") or "").strip(),
    }


def request_wechat_official_access_token(credentials, timeout=20):
    response = requests.get(
        WECHAT_OFFICIAL_TOKEN_URL,
        params={
            "grant_type": "client_credential",
            "appid": credentials["app_id"],
            "secret": credentials["app_secret"],
        },
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    access_token = data.get("access_token")
    if not access_token:
        raise ValueError(data.get("errmsg") or "获取公众号 access_token 失败")
    return access_token, data


def validate_wechat_official_credentials(file_path, timeout=20):
    try:
        credentials = load_wechat_official_credentials(file_path)
        _, data = request_wechat_official_access_token(credentials, timeout=timeout)
        return True, data
    except Exception as exc:
        return False, {"errmsg": str(exc)}


def _build_media_tuple(image_path):
    mime_type = mimetypes.guess_type(str(image_path))[0] or "application/octet-stream"
    return image_path.name, image_path.read_bytes(), mime_type


def upload_wechat_official_content_image(access_token, image_path, timeout=60):
    image_path = Path(image_path)
    response = requests.post(
        WECHAT_OFFICIAL_UPLOAD_IMAGE_URL,
        params={"access_token": access_token},
        files={"media": _build_media_tuple(image_path)},
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    image_url = data.get("url")
    if not image_url:
        raise ValueError(data.get("errmsg") or "上传公众号正文图片失败")
    return image_url


def upload_wechat_official_thumb_media(access_token, image_path, timeout=60):
    image_path = Path(image_path)
    response = requests.post(
        WECHAT_OFFICIAL_UPLOAD_MATERIAL_URL,
        params={"access_token": access_token, "type": "image"},
        files={"media": _build_media_tuple(image_path)},
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    media_id = data.get("media_id")
    if not media_id:
        raise ValueError(data.get("errmsg") or "上传公众号封面失败")
    return media_id


def build_wechat_official_article_html(text, image_urls=None):
    image_urls = image_urls or []
    blocks = []
    for image_url in image_urls:
        safe_url = html.escape(image_url, quote=True)
        blocks.append(f'<p><img src="{safe_url}" alt="image" /></p>')

    paragraphs = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    for paragraph in paragraphs:
        blocks.append(f"<p>{html.escape(paragraph)}</p>")

    if not blocks:
        blocks.append("<p></p>")
    return "".join(blocks)
