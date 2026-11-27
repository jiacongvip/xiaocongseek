# -*- coding: utf-8 -*-
"""Generate a 7-shot vertical storyboard with the Duomi image API.

Usage:
    export DUOMI_API_KEY="your-new-key"
    uv run python tools/duomi_storyboard.py

The API key is read only from the environment and is never written to disk.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx

BASE_URL = "https://duomiapi.com"
CREATE_PATH = "/v1/images/generations"
TASK_PATH = "/v1/tasks/{task_id}"

STYLE = (
    "竖屏 9:16 商业短视频分镜，真实电影摄影质感，现代连锁零售门店场景，"
    "冷白与青绿色主色调，干净明亮，专业商务感，高级 SaaS 广告视觉。"
    "画面预留上方和下方字幕安全区。不要生成任何文字、字母、数字、Logo、水印或乱码。"
    "同一位 32 岁亚洲区域门店经理：短发、深蓝色西装外套、白色衬衫，形象保持一致。"
)

SHOTS = [
    {
        "name": "01_hook",
        "prompt": (
            "年轻亚洲区域门店经理站在由多家现代连锁零售门店组成的商业空间中，"
            "周围悬浮着简洁抽象的数据面板与门店指标图形，人物自信专注，"
            "表现快速决策和业绩提升的氛围。" + STYLE
        ),
    },
    {
        "name": "02_pain_point",
        "prompt": (
            "区域门店经理坐在办公桌前，面对大量电脑屏幕、杂乱表格和不断变化的报表，"
            "人物神情忙碌而克制，表现连锁门店多、业绩变化快、人工分析效率低。"
            "真实办公环境，画面信息丰富但不过度杂乱。" + STYLE
        ),
    },
    {
        "name": "03_ai_summary",
        "prompt": (
            "现代零售管理后台的抽象界面与真实门店场景融合，"
            "多个门店的销售数据、经营质量和门店排名被整齐汇总到一个清晰的智能分析面板中，"
            "青绿色科技 UI，秩序感强，强调自动汇总和快速查看。" + STYLE
        ),
    },
    {
        "name": "04_find_store",
        "prompt": (
            "俯视视角的连锁门店网络数据可视化，多个门店节点连成网络，"
            "其中一个门店节点被青绿色高亮标记，表现 AI 自动锁定关键问题门店，"
            "画面专业、清晰，具有商业数据分析感。" + STYLE
        ),
    },
    {
        "name": "05_action_plan",
        "prompt": (
            "真实零售门店内，区域经理、店员和顾客自然互动，"
            "简洁的视觉连线从区域管理层延伸到具体门店和具体员工，"
            "表现问题定位到店、到人以及可执行的行动建议，氛围积极明确。" + STYLE
        ),
    },
    {
        "name": "06_tracking",
        "prompt": (
            "区域经理手持平板电脑查看多个门店的执行进度，"
            "背景是整洁明亮的连锁零售门店，画面中有抽象的进度状态和完成标记，"
            "表现实时跟踪、持续改善和执行落地。" + STYLE
        ),
    },
    {
        "name": "07_ending",
        "prompt": (
            "年轻亚洲区域门店经理自信地站在现代连锁零售门店中央，"
            "背景明亮整洁，多个门店和数据面板形成有秩序的视觉层次，"
            "整体氛围是业绩提升、管理效率提高和目标达成，画面适合作为结尾品牌镜头。" + STYLE
        ),
    },
]


class DuomiError(RuntimeError):
    pass


def api_key_from_env() -> str:
    key = os.getenv("DUOMI_API_KEY", "").strip()
    if not key:
        raise SystemExit(
            "缺少 DUOMI_API_KEY。请先撤销聊天中暴露的旧密钥，然后在本机执行：\n"
            '  export DUOMI_API_KEY="新密钥"\n'
            "再重新运行本脚本。"
        )
    return key


def create_task(client: httpx.Client, model: str, size: str, prompt: str) -> str:
    payload = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "quality": "high",
        "background": "opaque",
        "oversea": False,
    }
    response = client.post(CREATE_PATH, json=payload)
    response.raise_for_status()
    body = response.json()
    task_id = body.get("id") or body.get("task_id") or (body.get("data") or {}).get("id")
    if not task_id:
        raise DuomiError(f"创建任务响应中没有 id: {body}")
    return str(task_id)


def wait_task(client: httpx.Client, task_id: str, interval: float, timeout: float) -> dict:
    deadline = time.monotonic() + timeout
    last_state = None
    while time.monotonic() < deadline:
        response = client.get(TASK_PATH.format(task_id=task_id))
        response.raise_for_status()
        body = response.json()
        state = str(body.get("state", "")).lower()
        if state != last_state:
            print(f"  [{task_id[:8]}] state={state} progress={body.get('progress')}", flush=True)
            last_state = state
        if state in {"succeeded", "success", "completed"}:
            return body
        if state in {"failed", "error", "cancelled"}:
            raise DuomiError(f"任务失败 {task_id}: {json.dumps(body, ensure_ascii=False)}")
        time.sleep(interval)
    raise DuomiError(f"任务超时 {task_id}（{timeout}s）")


def image_urls(task: dict) -> list[str]:
    images = ((task.get("data") or {}).get("images") or [])
    urls = []
    for item in images:
        if isinstance(item, str):
            urls.append(item)
        elif isinstance(item, dict) and item.get("url"):
            urls.append(item["url"])
    return urls


def download(url: str, target: Path, timeout: float = 180.0) -> None:
    # 下载走独立 client，不携带 API 密钥，避免凭证发送到 CDN 域名。
    with httpx.Client(follow_redirects=True, timeout=timeout) as client:
        response = client.get(url)
        response.raise_for_status()
        target.write_bytes(response.content)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate storyboard images via Duomi API")
    parser.add_argument("--model", default="gpt-image-2")
    parser.add_argument("--size", default="1152x2048", help="9:16 竖屏，宽高需能被 16 整除")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("data/video_analysis/7670164820838173990/images"),
    )
    parser.add_argument("--interval", type=float, default=4.0, help="轮询间隔秒数")
    parser.add_argument("--timeout", type=float, default=600.0, help="单任务超时秒数")
    parser.add_argument("--only", default="", help="只生成指定序号，例如 1,3,7")
    parser.add_argument("--dry-run", action="store_true", help="只打印提示词，不调用接口")
    args = parser.parse_args()

    if args.dry_run:
        for index, shot in enumerate(SHOTS, 1):
            print(f"\n=== {index:02d} {shot['name']} ===\n{shot['prompt']}")
        return 0

    key = api_key_from_env()
    args.out.mkdir(parents=True, exist_ok=True)
    wanted = {int(x) for x in args.only.split(",") if x.strip()} if args.only else None

    headers = {"Authorization": key, "Content-Type": "application/json"}
    manifest_path = args.out / "manifest.json"
    manifest = {"model": args.model, "size": args.size, "shots": []}

    with httpx.Client(
        base_url=BASE_URL,
        headers=headers,
        timeout=httpx.Timeout(120.0, connect=30.0),
        follow_redirects=True,
    ) as client:
        for index, shot in enumerate(SHOTS, 1):
            if wanted and index not in wanted:
                continue
            print(f"\n[{index}/{len(SHOTS)}] {shot['name']}", flush=True)
            task_id = create_task(client, args.model, args.size, shot["prompt"])
            print(f"  task_id={task_id}", flush=True)
            task = wait_task(client, task_id, args.interval, args.timeout)
            urls = image_urls(task)
            if not urls:
                raise DuomiError(f"任务成功但没有返回图片 {task_id}: {json.dumps(task, ensure_ascii=False)}")

            saved = []
            for image_index, url in enumerate(urls, 1):
                suffix = "" if len(urls) == 1 else f"_{image_index}"
                target = args.out / f"{shot['name']}{suffix}.png"
                download(url, target)
                saved.append(str(target))
                print(f"  saved {target}", flush=True)

            manifest["shots"].append(
                {"index": index, "name": shot["name"], "task_id": task_id, "files": saved}
            )
            manifest_path.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )

    print(f"\n完成，共 {len(manifest['shots'])} 个分镜。输出目录: {args.out}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except httpx.HTTPStatusError as exc:
        print(f"HTTP {exc.response.status_code}: {exc.response.text}", file=sys.stderr)
        sys.exit(1)
    except DuomiError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        sys.exit(1)
