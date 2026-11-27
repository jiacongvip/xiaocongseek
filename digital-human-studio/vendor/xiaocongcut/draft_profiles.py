import json
import os
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional


@dataclass(frozen=True)
class DraftProfile:
    name: str
    template_dir: str
    content_file: str
    content_mirrors: tuple[str, ...] = ()
    timeline_content_file: Optional[str] = None
    is_capcut_env: bool = True
    platform: Optional[Dict[str, object]] = None


CAPCUT_PLATFORM = {
    "app_id": 359289,
    "app_source": "cc",
    "app_version": "6.5.0",
    "device_id": "c4ca4238a0b923820dcc509a6f75849b",
    "hard_disk_id": "307563e0192a94465c0e927fbc482942",
    "mac_address": "c3371f2d4fb02791c067ce44d8fb4ed5",
    "os": "mac",
    "os_version": "15.5",
}

JIANYING_10_PLATFORM = {
    "app_id": 3704,
    "app_source": "lv",
    "app_version": "10.2.0",
    "os": "windows",
}

PROFILES: Dict[str, DraftProfile] = {
    "capcut_legacy": DraftProfile(
        name="capcut_legacy",
        template_dir="template",
        content_file="draft_info.json",
        content_mirrors=("draft_info.json.bak", "template-2.tmp", "template.tmp"),
        is_capcut_env=True,
        platform=CAPCUT_PLATFORM,
    ),
    "jianying_legacy": DraftProfile(
        name="jianying_legacy",
        template_dir="template_jianying",
        content_file="draft_info.json",
        content_mirrors=("draft_info.json.bak",),
        is_capcut_env=False,
        platform=JIANYING_10_PLATFORM,
    ),
    "jianying_pro_10": DraftProfile(
        name="jianying_pro_10",
        template_dir="template_jianying_10_2",
        content_file="draft_content.json",
        content_mirrors=("draft_content.json.bak", "template-2.tmp"),
        timeline_content_file="template.tmp",
        is_capcut_env=False,
        platform=JIANYING_10_PLATFORM,
    ),
}

PROFILE_ALIASES = {
    "capcut": "jianying_pro_10",
    "capcut_legacy": "capcut_legacy",
    "capcut_modern": "jianying_pro_10",
    "jianying": "jianying_pro_10",
    "jianying_legacy": "jianying_legacy",
    "jianying_10": "jianying_pro_10",
    "jianying_10_x": "jianying_pro_10",
    "jianying_pro_10": "jianying_pro_10",
    "jianying_pro_10_2": "jianying_pro_10",
    "jianying_pro_10_2_0": "jianying_pro_10",
}


def normalize_profile_name(name: Optional[str]) -> str:
    if not name:
        return "jianying_pro_10"
    key = name.strip().lower().replace(".", "_").replace("-", "_")
    if key not in PROFILE_ALIASES:
        raise ValueError(
            f"Unknown draft profile '{name}'. Supported profiles: {', '.join(sorted(PROFILE_ALIASES))}"
        )
    return PROFILE_ALIASES[key]


def get_draft_profile(name: Optional[str] = None) -> DraftProfile:
    if name is None:
        try:
            from settings.local import DRAFT_PROFILE
        except Exception:
            DRAFT_PROFILE = "jianying_pro_10"
        name = DRAFT_PROFILE
    return PROFILES[normalize_profile_name(name)]


def get_template_dir(name: Optional[str] = None) -> str:
    return get_draft_profile(name).template_dir


def write_profile_content(profile: DraftProfile, draft_dir: os.PathLike, content: str) -> List[Path]:
    draft_path = Path(draft_dir)
    written: List[Path] = []
    content_data = json.loads(content)

    # Auto-adjust canvas_config ratio based on dimensions
    canvas_cfg = content_data.get("canvas_config", {})
    w = canvas_cfg.get("width", content_data.get("width", 1080))
    h = canvas_cfg.get("height", content_data.get("height", 1920))
    if canvas_cfg.get("ratio") in ("original", None, ""):
        if h > w:
            canvas_cfg["ratio"] = "9:16"
        elif w > h:
            canvas_cfg["ratio"] = "16:9"
        elif w == h:
            canvas_cfg["ratio"] = "1:1"
    content_data["canvas_config"] = canvas_cfg
    content = json.dumps(content_data, ensure_ascii=False, indent=2)

    # Remove any stale .locked files in draft directory
    try:
        lock_file = draft_path / ".locked"
        if lock_file.exists():
            lock_file.unlink()
    except Exception:
        pass

    targets = [profile.content_file, *profile.content_mirrors]
    for relative_path in targets:
        path = draft_path / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        written.append(path)

    if profile.timeline_content_file:
        timelines_dir = draft_path / "Timelines"
        if timelines_dir.exists():
            timeline_dirs = [path for path in timelines_dir.iterdir() if path.is_dir()]
            timeline_id = content_data.get("id")
            if timeline_id and timeline_dirs:
                timeline_dir = timeline_dirs[0]
                desired_timeline_dir = timelines_dir / timeline_id
                if timeline_dir != desired_timeline_dir:
                    if desired_timeline_dir.exists():
                        shutil.rmtree(desired_timeline_dir)
                    timeline_dir.rename(desired_timeline_dir)
                    timeline_dirs = [desired_timeline_dir]

            for timeline_dir in timeline_dirs:
                timeline_targets = set(targets)
                timeline_targets.add(profile.timeline_content_file)
                for relative_path in timeline_targets:
                    path = timeline_dir / relative_path
                    path.write_text(content, encoding="utf-8")
                    written.append(path)

            if timeline_id:
                now_us = int(time.time() * 1_000_000)
                project = {
                    "config": {
                        "color_space": -1,
                        "render_index_track_mode_on": False,
                        "use_float_render": False,
                    },
                    "create_time": now_us,
                    "id": timeline_id,
                    "main_timeline_id": timeline_id,
                    "timelines": [
                        {
                            "create_time": now_us,
                            "id": timeline_id,
                            "is_marked_delete": False,
                            "name": "时间线01",
                            "update_time": now_us,
                        }
                    ],
                    "update_time": now_us,
                    "version": 0,
                }
                for relative_path in ("project.json", "project.json.bak"):
                    path = timelines_dir / relative_path
                    path.write_text(json.dumps(project, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
                    written.append(path)

                layout_path = draft_path / "timeline_layout.json"
                if layout_path.exists():
                    layout = json.loads(layout_path.read_text(encoding="utf-8"))
                    for item in layout.get("dockItems", []):
                        item["timelineIds"] = [timeline_id]
                        item["timelineNames"] = ["时间线01"]
                    layout_path.write_text(json.dumps(layout, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
                    written.append(layout_path)

    return written


def rewrite_draft_meta_info(
    draft_dir: os.PathLike,
    *,
    draft_id: str,
    draft_name: str,
    duration_us: int = 0,
) -> Path:
    """Rewrite draft_meta_info.json so it no longer keeps foreign template paths.

    Sets draft_name / draft_fold_path / draft_root_path / tm_duration to the
    actual output directory on this machine.
    """
    draft_path = Path(draft_dir).resolve()
    meta_path = draft_path / "draft_meta_info.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
    else:
        meta = {}

    now_us = int(time.time() * 1_000_000)
    root_path = str(draft_path.parent)
    fold_path = str(draft_path)
    meta["draft_id"] = str(draft_id or meta.get("draft_id") or draft_path.name)
    meta["draft_name"] = str(draft_name or draft_path.name)
    meta["draft_fold_path"] = fold_path
    meta["draft_root_path"] = root_path
    meta["tm_duration"] = int(duration_us or meta.get("tm_duration") or 0)
    meta["tm_draft_modified"] = now_us
    if not meta.get("tm_draft_create"):
        meta["tm_draft_create"] = now_us
    # Drop obviously foreign machine leftovers from the template.
    for key in ("draft_deeplink_url",):
        if key in meta and isinstance(meta[key], str) and meta[key]:
            meta[key] = ""
    meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return meta_path
