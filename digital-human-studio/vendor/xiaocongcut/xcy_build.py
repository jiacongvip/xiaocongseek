#!/usr/bin/env python
"""配方出片：一份 JSON 描述一条视频，一条命令生成剪映草稿。

以后做视频 = 改配方，不改代码。

用法：
  cd vendor/xiaocongcut   # 从 digital-human-studio 根目录
  .venv/bin/python xcy_build.py recipes/demo.json            # 出草稿
  .venv/bin/python xcy_build.py recipes/demo.json --dry-run  # 只看计划，不动草稿
  .venv/bin/python xcy_build.py recipes/batch.json           # 批量（顶层 videos 数组）

配方格式（相对路径按配方文件所在目录解析，`~` 会展开）：

{
  "name": "门店避坑片",
  "size": [1080, 1920],
  "draft_folder": "~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft",
  "vars": { "店名": "老陈瓷砖" },
  "clips": [
    { "source": "a.mp4", "start": 0, "end": 3, "target": 0 },
    { "source": "b.jpg", "target": 3, "duration": 2 }
  ],
  "texts": [
    { "text": "{{店名}}", "style": "shop_sign", "start": 0.3, "end": 2.5, "pos": "top", "intro": "Fade_In" }
  ],
  "sfx": [
    { "path": "whoosh.wav", "at": 0.3, "volume": 0.35, "fade_in": 0.1 }
  ],
  "bgm": { "path": "bgm.mp3", "volume": 0.12 }
}

字段说明：
  clips[].source    视频(mp4/mov)或图片(jpg/png)，本机绝对路径或相对配方目录
  clips[].start/end 源素材内的入点/出点（秒）；图片用 duration
  clips[].target    落在时间线第几秒；不填则紧接上一条
  clips[].matte     "person" = 把这层的人像抠出来叠在最上面（文字就在人后面），无需剪映操作
                    也可写成 {"mode":"person","start":0,"end":10} 只抠其中一段（秒，源文件内）
                    例：10 分钟片子只在开头 10 秒让字在人后 → "matte": {"start":0,"end":10}
  texts[].style     引擎预设：hook_yellow / subtitle_white / warn_orange / shop_sign / title_gold / plain
  texts[].intro     Fade_In / Slide_Up / Mini_Zoom
  texts[].pos       lower_third（默认）/ center / top
  sfx[].at          音效落在第几秒
  bgm               垫乐，音量默认 0.12

铁律：素材给绝对路径（或相对于配方的路径），引擎保存草稿时会自己拷进草稿目录。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.environ.get('BASE', 'http://127.0.0.1:9001')
VIDEO_EXT = {'.mp4', '.mov', '.m4v', '.webm', '.mkv'}
IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.webp', '.bmp'}


# ────────────────────────── HTTP ──────────────────────────
def call(path: str, payload: dict | None = None, method: str = 'POST'):
    url = BASE + path
    data = None if payload is None else json.dumps(payload).encode('utf8')
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode('utf8'))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode('utf8', 'ignore')[:300]
        raise RuntimeError(f'{path} → HTTP {exc.code}: {body}') from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f'{path} → 引擎没响应（{exc.reason}）。先启动 9001。') from None


# ────────────────────────── 配方处理 ──────────────────────────
def substitute(value, variables: dict):
    """把 {{变量}} 换成实际值，递归处理 dict/list/str。"""
    if isinstance(value, str):
        def repl(m):
            key = m.group(1).strip()
            if key not in variables:
                raise KeyError(f'配方里用了未定义的变量 {{{{{key}}}}}')
            return str(variables[key])
        return re.sub(r'\{\{\s*([^{}]+?)\s*\}\}', repl, value)
    if isinstance(value, list):
        return [substitute(v, variables) for v in value]
    if isinstance(value, dict):
        return {k: substitute(v, variables) for k, v in value.items()}
    return value


def resolve(path: str, base_dir: Path) -> str:
    if not path:
        return path
    p = Path(os.path.expanduser(str(path)))
    return str(p if p.is_absolute() else (base_dir / p).resolve())


def kind_of(path: str) -> str:
    ext = Path(path).suffix.lower()
    if ext in VIDEO_EXT:
        return 'video'
    if ext in IMAGE_EXT:
        return 'image'
    raise ValueError(f'不认识的素材类型：{path}')


# ────────────────────────── 出片 ──────────────────────────
def build(recipe: dict, base_dir: Path, dry_run: bool = False) -> dict:
    recipe = substitute(recipe, recipe.get('vars') or {})
    name = recipe.get('name') or '未命名'
    width, height = (recipe.get('size') or [1080, 1920])[:2]
    draft_folder = resolve(recipe.get('draft_folder') or '', base_dir)

    clips = recipe.get('clips') or []
    texts = recipe.get('texts') or []
    sfx = recipe.get('sfx') or []
    bgm = recipe.get('bgm') or None

    plan = []
    cursor = 0.0
    for c in clips:
        src = resolve(c['source'], base_dir)
        target = float(c.get('target', cursor))
        if kind_of(src) == 'video':
            start = float(c.get('start', 0))
            end = float(c['end']) if c.get('end') is not None else start + 3.0
            dur = end - start
        else:
            start, dur = 0.0, float(c.get('duration', 3.0))
        cursor = target + dur
        _span = _matte_span(c)
        note = f'（抠像叠顶层 {_span[0]:.1f}–{_span[1]:.1f}s）' if _span else ''
        plan.append(f'片段 {Path(src).name}  {target:.1f}s 起，{dur:.1f}s{note}')

    for t in texts:
        plan.append(f'花字 「{t["text"]}」  {float(t.get("start", 0)):.1f}s，{t.get("style", "hook_yellow")}')
    for s in sfx:
        plan.append(f'音效 {Path(resolve(s["path"], base_dir)).name}  {float(s.get("at", 0)):.1f}s')
    if bgm:
        plan.append(f'垫乐 {Path(resolve(bgm["path"], base_dir)).name}')

    # 出片前先验素材，缺文件立刻报错（不要让引擎在缺素材时"成功"出一条空片）
    missing = []
    for c in clips:
        src = resolve(c['source'], base_dir)
        if not os.path.exists(src):
            missing.append(src)
    for s in sfx:
        f = resolve(s['path'], base_dir)
        if not os.path.exists(f):
            missing.append(f)
    if bgm:
        f = resolve(bgm['path'], base_dir)
        if not os.path.exists(f):
            missing.append(f)
    if missing:
        raise FileNotFoundError('配方引用的文件不存在：' + chr(10) + chr(10).join(missing))

    if dry_run:
        return {'name': name, 'dry_run': True, 'plan': plan}

    if not draft_folder:
        raise ValueError('配方缺 draft_folder（剪映草稿目录）')

    created = call('/create_draft', {'width': width, 'height': height, 'draft_folder': draft_folder})
    draft_id = created['output']['draft_id']

    warnings = []
    for c in clips:
        src = resolve(c['source'], base_dir)
        target = float(c.get('target', 0))
        if kind_of(src) == 'video':
            body = {'draft_id': draft_id, 'draft_folder': draft_folder, 'video_url': src,
                    'start': float(c.get('start', 0)), 'end': c.get('end'),
                    'target_start': target, 'width': width, 'height': height}
            res = call('/add_video', body)
        else:
            dur = float(c.get('duration', 3.0))
            body = {'draft_id': draft_id, 'draft_folder': draft_folder, 'image_url': src,
                    'start': target, 'end': target + dur, 'width': width, 'height': height}
            res = call('/add_image', body)
        if not res.get('success'):
            warnings.append(f'片段失败 {Path(src).name}: {res.get("error") or res}')

    for t in texts:
        body = {
            'text': t['text'], 'style': t.get('style', 'hook_yellow'),
            'draft_id': draft_id, 'draft_folder': draft_folder,
            'start': float(t.get('start', 0)), 'end': t.get('end'),
            'pos': t.get('pos', 'lower_third'),
            'intro': t.get('intro'), 'intro_duration': float(t.get('intro_duration', 0.45)),
            'font_size': int(t.get('font_size', 96)), 'max_width': int(t.get('max_width', 940)),
        }
        if t.get('end') is None:
            body['end'] = float(t.get('start', 0)) + 3.0
        res = call('/xcy/add_styled_text', body)
        if not res.get('success'):
            warnings.append(f'花字失败「{t["text"]}」: {res.get("error")}')

    for s in sfx:
        res = call('/xcy/add_local_audio', {
            'path': resolve(s['path'], base_dir), 'draft_id': draft_id, 'draft_folder': draft_folder,
            'target_start': float(s.get('at', 0)), 'volume': float(s.get('volume', 0.4)),
            'fade_in': float(s.get('fade_in', 0.05)), 'fade_out': float(s.get('fade_out', 0.1)),
            'track_name': s.get('track_name', 'sfx'),
        })
        if not res.get('success'):
            warnings.append(f'音效失败 {Path(s["path"]).name}: {res.get("error")}')

    if bgm:
        res = call('/xcy/add_local_audio', {
            'path': resolve(bgm['path'], base_dir), 'draft_id': draft_id, 'draft_folder': draft_folder,
            'target_start': float(bgm.get('target_start', 0)),
            'volume': float(bgm.get('volume', 0.12)),
            'fade_in': float(bgm.get('fade_in', 0.5)), 'fade_out': float(bgm.get('fade_out', 0.8)),
            'track_name': 'bgm',
        })
        if not res.get('success'):
            warnings.append(f'垫乐失败: {res.get("error")}')

    alpha_paths = []
    for c in clips:
        span = _matte_span(c)
        if span is None:
            continue
        src = resolve(c['source'], base_dir)
        m_start, m_end = span
        clip_start = float(c.get('start', 0))
        # 透明层文件本身的 0 秒 = 源片的 m_start，所以叠加时从 0 开始、长度取区间长，
        # 时间线位置 = 这层片段的起点 + 区间在片段内的偏移。
        target = float(c.get('target', 0)) + max(0.0, m_start - clip_start)
        alpha = call('/xcy/person_alpha', {
            'path': src, 'model': c.get('matte_model', 'u2net'),
            'start': m_start, 'end': m_end,
        })
        if not alpha.get('success'):
            warnings.append(f"抠像失败 {Path(src).name}: {alpha.get('error')}")
            continue
        res = call('/add_video', {
            'draft_id': draft_id, 'draft_folder': draft_folder,
            'video_url': alpha['path'], 'start': 0,
            'end': round(m_end - m_start, 3), 'target_start': target,
            'width': width, 'height': height, 'track_name': 'person_top',
        })
        if not res.get('success'):
            warnings.append(f'透明人像叠加失败: {res.get("error")}')
        else:
            alpha_paths.append(alpha['path'])

    saved = call('/save_draft', {'draft_id': draft_id, 'draft_folder': draft_folder,
                                 'auto_deploy': False, 'auto_reload': False})
    if not saved.get('success'):
        warnings.append(f'保存失败: {saved.get("output", {}).get("error") if isinstance(saved.get("output"), dict) else saved}')

    # 透明人像素材：引擎统一按 video_<hash>.mp4 落盘，但内容是 ProRes 4444 的 mov，
    # 扩展名不对剪映认不出透明通道，这里改名并回写草稿里的引用。
    alpha_paths = [a for a in alpha_paths if a]
    if alpha_paths:
        try:
            fixed = _fix_alpha_ext(draft_folder, draft_id, alpha_paths)
            if fixed:
                print(f'  （已修正 {fixed} 个透明素材扩展名）')
        except Exception as exc:  # noqa: BLE001
            warnings.append(f'透明素材改名失败：{exc}')

    # 需要成片就顺手渲一份（老板口径：默认直接出 mp4，草稿只是副产物）
    render_info = None
    if recipe.get('also_render'):
        try:
            import xcy_render
            render_cfg = recipe.get('render') or {}
            out = os.path.expanduser(str(
                render_cfg.get('out') or (Path.home() / 'Movies' / 'xcy-out' / f'{name}.mp4')))
            render_info = xcy_render.render_recipe(
                recipe, str(out), base_dir,
                preset=str(render_cfg.get('preset') or 'final'),
                hardware=bool(render_cfg.get('hardware', True)),
            )
        except Exception as exc:  # noqa: BLE001
            warnings.append(f'顺带渲染失败：{exc}')

    return {'name': name, 'dry_run': False, 'draft_id': draft_id, 'render': render_info,
            'draft_folder': draft_folder, 'plan': plan, 'warnings': warnings}


def _matte_span(c: dict):
    """这层要不要抠像、抠源片哪一段。返回 (起, 止) 秒，None = 不抠。

    matte 可以是 "person"（整层），也可以是 {"mode":"person","start":0,"end":10}。
    start/end 是**源文件里**的秒数，会夹到该片段自己的区间内。
    """
    m = c.get('matte')
    if not m:
        return None
    if m == 'person':
        cs = float(c.get('start', 0))
        ce = float(c['end']) if c.get('end') is not None else cs + 3.0
        return (cs, ce)
    if not isinstance(m, dict):
        return None
    if str(m.get('mode', 'person')) != 'person':
        return None
    cs = float(c.get('start', 0))
    ce = float(c['end']) if c.get('end') is not None else cs + 3.0
    ms = max(float(m.get('start', cs)), cs)
    me = min(float(m.get('end', ce)), ce)
    if me - ms <= 0.05:
        return None
    return (ms, me)


def _fix_alpha_ext(draft_folder: str, draft_id: str, alpha_paths: list[str]) -> int:
    """把 assets 里被命名成 .mp4 的透明素材改成 .mov，并同步草稿引用。"""
    import sys
    from pathlib import Path as _P

    sys.path.insert(0, str(_P(__file__).resolve().parent))
    from util import build_draft_asset_path, url_to_hash

    info = _P(draft_folder) / draft_id / 'draft_info.json'
    if not info.exists():
        return 0
    data = json.loads(info.read_text(encoding='utf8'))
    fixed = 0

    for alpha in alpha_paths:
        old_path = build_draft_asset_path(draft_folder, draft_id, 'video',
                                          f'video_{url_to_hash(alpha)}.mp4')
        if not os.path.exists(old_path):
            continue
        new_path = old_path[:-4] + '.mov'
        if not os.path.exists(new_path):
            os.replace(old_path, new_path)
        for v in data.get('materials', {}).get('videos', []):
            if v.get('path') == old_path:
                v['path'] = new_path
                if v.get('material_name', '').endswith('.mp4'):
                    v['material_name'] = v['material_name'][:-4] + '.mov'
                fixed += 1

    if fixed:
        info.write_text(json.dumps(data, ensure_ascii=False), encoding='utf8')
    return fixed


def main():
    ap = argparse.ArgumentParser(description='配方出片：JSON → 剪映草稿')
    ap.add_argument('recipe', help='配方 JSON 路径')
    ap.add_argument('--dry-run', action='store_true', help='只打印计划，不建草稿')
    args = ap.parse_args()

    path = Path(args.recipe).expanduser().resolve()
    if not path.exists():
        print(f'找不到配方：{path}')
        return 1
    raw = json.loads(path.read_text(encoding='utf8'))
    base_dir = path.parent

    jobs = raw['videos'] if isinstance(raw.get('videos'), list) else [raw]
    failed = 0
    for i, job in enumerate(jobs, 1):
        try:
            result = build(job, base_dir, args.dry_run)
        except Exception as exc:  # noqa: BLE001
            print(f'\n[{i}/{len(jobs)}] 失败：{exc}')
            failed += 1
            continue

        print(f'\n[{i}/{len(jobs)}] {result["name"]}')
        for line in result['plan']:
            print('  ·', line)
        if result['dry_run']:
            print('  （dry-run，未建草稿）')
            continue
        print('  草稿:', result['draft_id'])
        for w in result['warnings']:
            print('  ⚠', w)
        if not result['warnings']:
            print('  完成')

    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
