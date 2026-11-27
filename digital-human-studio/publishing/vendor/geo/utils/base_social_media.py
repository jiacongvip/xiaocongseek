from pathlib import Path
from typing import List

from conf import BASE_DIR, SOURCE_ROOT

SOCIAL_MEDIA_DOUYIN = "douyin"
SOCIAL_MEDIA_TENCENT = "tencent"
SOCIAL_MEDIA_TIKTOK = "tiktok"
SOCIAL_MEDIA_BILIBILI = "bilibili"
SOCIAL_MEDIA_KUAISHOU = "kuaishou"


def get_supported_social_media() -> List[str]:
    return [SOCIAL_MEDIA_DOUYIN, SOCIAL_MEDIA_TENCENT, SOCIAL_MEDIA_TIKTOK, SOCIAL_MEDIA_KUAISHOU]


def get_cli_action() -> List[str]:
    return ["upload", "login", "watch"]


def resolve_stealth_script_path() -> Path:
    candidates = [
        Path(BASE_DIR / "sau_backend/utils/stealth.min.js"),
        Path(BASE_DIR / "backend-dist/sau_backend/utils/stealth.min.js"),
        Path(SOURCE_ROOT / "sau_backend/utils/stealth.min.js"),
        Path(SOURCE_ROOT / "backend-dist/sau_backend/utils/stealth.min.js"),
        Path(__file__).resolve().parent / "stealth.min.js",
    ]
    return next((candidate for candidate in candidates if candidate.exists()), candidates[0])


async def set_init_script(context):
    stealth_js_path = resolve_stealth_script_path()
    await context.add_init_script(path=stealth_js_path)
    return context
