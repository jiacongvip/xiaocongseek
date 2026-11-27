"""xcy_trendy.py —— 网感口播原生本地渲染模板（高级红 / 黑金杂志 / 极简白青）

把 trendykoubo 规范（双行反色大标题 + 思源粗宋中英双语 + 8–12 字左上/右下错落分层
+ 关键词主题色厚反色描边放大弹动 + 去气口 + 金句缩放 + 转场 + 提示音 + BGM 压人声）
直接编译成 Xiaocongcut 本地配方，一次渲染直出 mp4，无需外部云端草稿服务。
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

THEMES: dict[str, dict[str, str]] = {
    'trendy_red': {
        'id': 'trendy_red',
        'label': '网感口播 · 高级红',
        'top_style': 'trendy_red_top',
        'bottom_style': 'trendy_red_bottom',
        'sub_style': 'trendy_red',
    },
    'trendy_gold': {
        'id': 'trendy_gold',
        'label': '黑金杂志',
        'top_style': 'trendy_gold_top',
        'bottom_style': 'trendy_gold_bottom',
        'sub_style': 'trendy_gold',
    },
    'trendy_cyan': {
        'id': 'trendy_cyan',
        'label': '极简白青',
        'top_style': 'trendy_cyan_top',
        'bottom_style': 'trendy_cyan_bottom',
        'sub_style': 'trendy_cyan',
    },
}

TRANSITION_MAP = {
    '向右': 'slide_right',
    '向左': 'slide_left',
    '竖向模糊': 'dissolve',
    '叠化': 'dissolve',
    '淡入': 'fade',
    'slide_right': 'slide_right',
    'slide_left': 'slide_left',
    'slide_up': 'slide_up',
    'slide_down': 'slide_down',
    'dissolve': 'dissolve',
    'fade': 'fade',
}

TONE_SFX_MAP = {
    'emphasis': 'ding',
    'result': 'stamp',
}

_PUNC_RE = re.compile(r'[\s，。！？、,.!?；;：:“”""\'\'（）()《》\-—…·]+')


def resolve_theme(name: str | None) -> dict[str, str]:
    key = str(name or 'trendy_red').strip().lower()
    if key in ('red', 'advanced_red', '高级红', '网感口播'):
        key = 'trendy_red'
    elif key in ('gold', 'black_gold', '黑金', '黑金杂志'):
        key = 'trendy_gold'
    elif key in ('cyan', 'minimal_cyan', '极简青', '极简白青'):
        key = 'trendy_cyan'
    return dict(THEMES.get(key) or THEMES['trendy_red'])


def _sfx_path(sfx_name: str) -> str:
    here = Path(__file__).resolve().parent
    for base in (here / 'sfx', here.parent / 'sfx', here.parent.parent / 'assets' / 'sfx'):
        for ext in ('.wav', '.mp3', '.ogg'):
            cand = base / f'{sfx_name}{ext}'
            if cand.exists():
                return str(cand)
    return ''


def _probe_video(path: str) -> dict[str, Any]:
    try:
        import xcy_render as R
        info = R.probe(path)
        if isinstance(info, dict):
            return info
    except Exception:
        pass
    return {'width': 1080, 'height': 1920, 'duration': 30.0}


def _normalize_subtitle_items(
    raw_items: list[dict[str, Any]],
    total_dur: float,
    asr_segments: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        txt = str(item.get('text') or '').strip()
        if not txt:
            continue
        eff_len = len(_PUNC_RE.sub('', txt))
        row: dict[str, Any] = {
            'text': txt,
            'layered': bool(item.get('layered')) if item.get('layered') is not None else (eff_len >= 8),
        }
        en = str(item.get('en') or item.get('translation') or '').strip()
        if en:
            row['en'] = en
        if 'keyword' in item:
            row['keyword'] = str(item.get('keyword') or '').strip()
        if item.get('start') is not None and item.get('end') is not None:
            try:
                s = max(0.0, float(item['start']))
                e = max(s + 0.1, float(item['end']))
                row['start'] = round(s, 3)
                row['end'] = round(e, 3)
            except (TypeError, ValueError):
                pass
        cleaned.append(row)

    if not cleaned:
        return []

    # 若未自带精确时间戳，按字符占比（或 ASR 语音区间）自动分配单调不重叠时间段
    missing_time = [r for r in cleaned if 'start' not in r or 'end' not in r]
    if missing_time:
        t0 = 0.0
        t1 = max(1.0, float(total_dur or 15.0))
        if asr_segments:
            try:
                t0 = max(0.0, float(asr_segments[0].get('start', 0.0)))
                t1 = max(t0 + 1.0, float(asr_segments[-1].get('end', t1)))
            except (TypeError, ValueError, KeyError):
                pass
        weights = [max(1, len(_PUNC_RE.sub('', r['text']))) for r in cleaned]
        total_w = float(sum(weights))
        cursor = t0
        span = max(0.5, t1 - t0)
        for r, w in zip(cleaned, weights):
            seg_d = span * (w / total_w)
            if 'start' not in r:
                r['start'] = round(cursor, 3)
            if 'end' not in r:
                r['end'] = round(min(t1, cursor + seg_d), 3)
            cursor += seg_d

    # 按时间排序并裁剪相邻重叠，避免双语字幕互相打架
    cleaned.sort(key=lambda r: (r['start'], r['end']))
    for i in range(len(cleaned) - 1):
        if cleaned[i]['end'] > cleaned[i + 1]['start']:
            cleaned[i]['end'] = round(max(cleaned[i]['start'] + 0.08, cleaned[i + 1]['start']), 3)
    return cleaned


def build_trendy_recipe(spec: dict[str, Any]) -> dict[str, Any]:
    """将网感口播语义规划编译为标准 Xiaocongcut 配方。"""
    theme = resolve_theme(spec.get('theme') or spec.get('style'))
    video_path = os.path.expanduser(str(spec.get('video_path') or spec.get('video') or '').strip())
    raw_clips = spec.get('clips') if isinstance(spec.get('clips'), list) else []
    if not video_path and raw_clips:
        first = raw_clips[0]
        video_path = os.path.expanduser(str(first.get('source') if isinstance(first, dict) else first).strip())
    if not video_path or not os.path.exists(video_path):
        raise FileNotFoundError(f'视频素材不存在：{video_path or "(空)"}')

    info = _probe_video(video_path)
    orig_dur = float(info.get('duration') or 30.0)
    orient = str(spec.get('orientation') or 'portrait').lower()
    if orient in ('landscape', '16:9'):
        size = [1920, 1080]
    elif orient == 'auto' and float(info.get('width') or 0) > float(info.get('height') or 0):
        size = [1920, 1080]
    else:
        size = [1080, 1920]

    # 1) 片段与转场
    tr_by_seg: dict[int, dict[str, Any]] = {}
    for tr in (spec.get('transitions') or []):
        if not isinstance(tr, dict):
            continue
        try:
            si = int(tr.get('seg_index'))
        except (TypeError, ValueError):
            continue
        mapped = TRANSITION_MAP.get(str(tr.get('type') or '').strip())
        if mapped:
            tr_by_seg[si] = {'type': mapped, 'duration': min(0.8, max(0.15, float(tr.get('duration') or 0.4)))}

    clips: list[dict[str, Any]] = []
    if raw_clips:
        for ci, item in enumerate(raw_clips):
            if isinstance(item, str):
                c: dict[str, Any] = {'source': os.path.expanduser(item.strip())}
            elif isinstance(item, dict) and item.get('source'):
                c = {**item, 'source': os.path.expanduser(str(item['source']).strip())}
            else:
                continue
            if ci in tr_by_seg and ci > 0 and 'transition_in' not in c and 'transition' not in c:
                c['transition'] = tr_by_seg[ci]
            clips.append(c)
    else:
        clips = [{'source': video_path}]

    # 估算成片时长
    est_dur = 0.0
    for c in clips:
        if c.get('start') is not None and c.get('end') is not None:
            est_dur += max(0.1, float(c['end']) - float(c['start']))
        elif c.get('duration') is not None:
            est_dur += max(0.1, float(c['duration']))
        else:
            est_dur += orig_dur
    total_dur = max(1.0, est_dur)

    # 2) 前 5 秒双行反色大标题（网感口播高级红招牌开头）
    texts: list[dict[str, Any]] = []
    title_cfg = spec.get('title') if isinstance(spec.get('title'), dict) else {}
    top_title = str(title_cfg.get('top_title') or spec.get('top_title') or '').strip()
    bottom_title = str(title_cfg.get('bottom_title') or spec.get('bottom_title') or '').strip()
    title_end = round(min(float(title_cfg.get('duration') or 5.0), total_dur), 3)
    if top_title:
        texts.append({
            'text': top_title,
            'style': theme['top_style'],
            'start': 0.0,
            'end': title_end,
            'font_size': 92 if size[0] <= 1080 else 76,
            'pos': {'an': 9, 'x': 0.92, 'y': 0.11},
            'intro': 'Fade_In',
        })
    if bottom_title:
        texts.append({
            'text': bottom_title,
            'style': theme['bottom_style'],
            'start': 0.0,
            'end': title_end,
            'font_size': 98 if size[0] <= 1080 else 82,
            'pos': {'an': 9, 'x': 0.92, 'y': 0.185},
            'intro': 'Fade_In',
        })
    if isinstance(spec.get('texts'), list):
        texts.extend([t for t in spec['texts'] if isinstance(t, dict) and t.get('text')])

    # 3) 中英双语 + 错落分层 + 关键词放大弹动字幕
    sub_items_raw = spec.get('subtitle_items') if isinstance(spec.get('subtitle_items'), list) else []
    asr_segs = spec.get('asr_segments') if isinstance(spec.get('asr_segments'), list) else None
    sub_items = _normalize_subtitle_items(sub_items_raw, total_dur, asr_segs)
    if sub_items:
        subtitles: dict[str, Any] = {
            'mode': 'inline',
            'style': theme['sub_style'],
            'avoid_face': False,
            'segments': sub_items,
        }
    else:
        subtitles = {
            'mode': 'auto',
            'source': 'clips[0]',
            'style': theme['sub_style'],
            'avoid_face': True,
            'language': 'zh',
            'max_chars': 12,
            'highlight': {'mode': 'auto'},
        }

    # 4) 金句强调缩放（若按单段剪辑且触发了 zoom，在该句区间给一段轻推拉节奏）
    zoom_cfg = spec.get('zoom') if isinstance(spec.get('zoom'), dict) else None
    if zoom_cfg and sub_items and len(clips) == 1 and 'start' not in clips[0] and 'end' not in clips[0]:
        try:
            zi = int(zoom_cfg.get('trigger_sub_index'))
            if 0 <= zi < len(sub_items):
                z_start = float(sub_items[zi]['start'])
                z_end = float(sub_items[zi]['end'])
                scale = min(1.35, max(1.08, float(zoom_cfg.get('scale') or 1.18)))
                if z_start > 0.4 and z_end < total_dur - 0.4:
                    clips = [
                        {'source': video_path, 'start': 0.0, 'end': round(z_start, 3)},
                        {'source': video_path, 'start': round(z_start, 3), 'end': round(z_end, 3), 'scale': scale},
                        {'source': video_path, 'start': round(z_end, 3), 'end': round(total_dur, 3)},
                    ]
        except (TypeError, ValueError):
            pass

    # 5) 语气提示音（emphasis / result）
    sfx: list[dict[str, Any]] = []
    seen_tones: set[str] = set()
    for tp in (spec.get('tone_presets') or []):
        if not isinstance(tp, dict):
            continue
        tone = str(tp.get('tone_type') or '').strip().lower()
        if tone not in TONE_SFX_MAP or tone in seen_tones:
            continue
        p = _sfx_path(TONE_SFX_MAP[tone])
        if not p:
            continue
        at = 0.0
        try:
            ti = int(tp.get('trigger_sub_index'))
            if 0 <= ti < len(sub_items):
                at = float(sub_items[ti]['start'])
        except (TypeError, ValueError):
            pass
        seen_tones.add(tone)
        sfx.append({'path': p, 'at': round(max(0.0, at), 3), 'volume': 0.35})

    # 6) 人声增强 + 低音量氛围 BGM
    audio: dict[str, Any] = {}
    voice_fx = str(spec.get('voice_fx') or 'clean').lower()
    if voice_fx in ('off', 'clean', 'strong'):
        audio['voice_fx'] = voice_fx
    bgm = spec.get('bgm', 'auto')
    if bgm and str(bgm).lower() not in ('off', 'none', 'false'):
        vol = float(spec.get('bgm_volume') if spec.get('bgm_volume') is not None else 0.10)
        if str(bgm).lower() == 'auto':
            audio['bgm'] = {'mode': 'auto', 'volume': vol, 'duck': True}
        else:
            audio['bgm'] = {'path': os.path.expanduser(str(bgm)), 'volume': vol, 'duck': True}

    name = str(spec.get('name') or spec.get('title_name') or top_title or f'网感口播_{int(time.time())}').strip()
    recipe: dict[str, Any] = {
        'name': name,
        'theme': theme['id'],
        'size': size,
        'clips': clips,
        'subtitles': subtitles,
    }
    if texts:
        recipe['texts'] = texts
    if sfx:
        recipe['sfx'] = sfx
    if audio:
        recipe['audio'] = audio

    # 去气口开关（当未手动拆段且用户未传自定义字幕时间轴时，交给引擎自动去停顿切镜）
    remove_silence = spec.get('remove_silence', True)
    if remove_silence and not sub_items and len(clips) == 1:
        recipe['rhythm'] = {'cut_on_pause': True}

    lut = str(spec.get('lut') or '').strip()
    if lut and lut.lower() not in ('off', 'none'):
        recipe['look'] = {'lut': lut, 'strength': float(spec.get('lut_strength') or 0.7)}

    return recipe


def save_trendy_project(recipe: dict[str, Any]) -> str:
    """把配方存进 recipes/ 目录，方便用户在「剪辑」时间线里随时打开二次微调。"""
    recipes_dir = Path(__file__).resolve().parent / 'recipes'
    recipes_dir.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r'[^0-9A-Za-z\u4e00-\u9fff_-]+', '_', str(recipe.get('name') or 'trendy')).strip('_')[:32] or 'trendy'
    path = recipes_dir / f'{slug}_{int(time.time())}.json'
    path.write_text(json.dumps(recipe, ensure_ascii=False, indent=2), encoding='utf8')
    return str(path)


_JY_THEME_COLORS: dict[str, dict[str, Any]] = {
    'trendy_red': {
        'accent_hex': '#A81C23',
        'accent_rgb': (168 / 255.0, 28 / 255.0, 35 / 255.0),
        'top_font': '优设标题黑',
        'bottom_font': '思源粗宋',
        'sub_font': '思源粗宋',
        'kw_border_rgb': (1.0, 1.0, 1.0),
    },
    'trendy_gold': {
        'accent_hex': '#D4AF37',
        'accent_rgb': (212 / 255.0, 175 / 255.0, 55 / 255.0),
        'top_font': '优设标题黑',
        'bottom_font': '思源粗宋',
        'sub_font': '思源粗宋',
        'kw_border_rgb': (0.07, 0.07, 0.09),
    },
    'trendy_cyan': {
        'accent_hex': '#0EA5B7',
        'accent_rgb': (14 / 255.0, 165 / 255.0, 183 / 255.0),
        'top_font': '优设标题黑',
        'bottom_font': '经典雅黑',
        'sub_font': '经典雅黑',
        'kw_border_rgb': (1.0, 1.0, 1.0),
    },
}

_JY_TRANSITION_MAP = {
    'slide_right': '向右',
    'slide_left': '向左',
    'dissolve': '叠化',
    'fade': '叠化',
}


def _split_layered_zh(text: str) -> tuple[str, str]:
    s = str(text or '').strip()
    if len(s) < 8:
        return s, ''
    mid = len(s) // 2
    best = mid
    for sep in ('，', '、', ' ', '的', '了', '在', '把', '用', '让', '给'):
        idx = s.find(sep, max(2, mid - 2), min(len(s) - 2, mid + 3))
        if idx != -1:
            best = idx + (0 if sep in ('的', '把', '用', '让', '给') else 1)
            break
    top = s[:best].strip(' ，,、')
    bot = s[best:].strip(' ，,、')
    if not top or not bot:
        return s[:mid], s[mid:]
    return top, bot


def _default_jianying_draft_folder() -> str:
    candidates = [
        os.path.expanduser('~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft'),
        os.path.expanduser('~/Library/Containers/com.lemon.lvpro/Data/Documents/JianyingPro/User Data/Projects/com.lveditor.draft'),
        os.path.expanduser('~/Movies/CapCut/User Data/Projects/com.lveditor.draft'),
    ]
    for c in candidates:
        if os.path.isdir(c):
            return c
    return candidates[0]


def export_trendy_jianying_draft(
    recipe: dict[str, Any],
    draft_folder: str | None = None,
    project_name: str | None = None,
) -> dict[str, Any]:
    """把网感口播配方同步导出为可直接在剪映 Pro 打开的完整多轨草稿。"""
    try:
        from create_draft import get_or_create_draft
        from add_video_track import add_video_track
        from add_text_impl import add_text_impl
        from add_audio_track import add_audio_track
        from save_draft_impl import save_draft_impl
        from pyJianYingDraft.text_segment import TextStyleRange, Text_style, Text_border
    except Exception as exc:  # noqa: BLE001
        return {'ok': False, 'error': f'剪映草稿模块不可用：{exc}'}

    size = recipe.get('size') or [1080, 1920]
    w, h = int(size[0]), int(size[1])
    theme_id = str(recipe.get('theme') or 'trendy_red')
    palette = _JY_THEME_COLORS.get(theme_id) or _JY_THEME_COLORS['trendy_red']
    folder = os.path.expanduser(str(draft_folder or '').strip()) or _default_jianying_draft_folder()
    pname = str(project_name or recipe.get('name') or f'网感口播_{int(time.time())}').strip()

    try:
        draft_id, _script = get_or_create_draft(width=w, height=h)

        # 1) 视频主轨（含金句缩放与转场）
        cursor = 0.0
        for ci, clip in enumerate(recipe.get('clips') or []):
            src = str(clip.get('source') or '').strip()
            if not src or not os.path.exists(src):
                continue
            info = _probe_video(src)
            src_dur = float(info.get('duration') or 10.0)
            c_start = float(clip.get('start') or 0.0)
            c_end = float(clip.get('end')) if clip.get('end') is not None else src_dur
            if c_end <= c_start:
                c_end = min(src_dur, c_start + 0.5)
            scale = float(clip.get('scale') or 1.0)
            tr_obj = clip.get('transition') if isinstance(clip.get('transition'), dict) else None
            tr_name = _JY_TRANSITION_MAP.get(str(tr_obj.get('type') or '')) if tr_obj else None
            tr_dur = float(tr_obj.get('duration') or 0.4) if tr_obj else 0.4
            add_video_track(
                video_url=src,
                draft_folder=folder,
                width=w,
                height=h,
                start=c_start,
                end=c_end,
                target_start=cursor,
                draft_id=draft_id,
                scale_x=scale,
                scale_y=scale,
                track_name='main_video',
                duration=src_dur,
                transition=tr_name if ci > 0 else None,
                transition_duration=tr_dur,
            )
            cursor += max(0.05, c_end - c_start)

        total_dur = max(1.0, cursor)

        # 2) 前 5 秒双行反色大标题轨
        for ti, txt in enumerate(recipe.get('texts') or []):
            t_str = str(txt.get('text') or '').strip()
            if not t_str:
                continue
            t_start = float(txt.get('start') or 0.0)
            t_end = min(total_dur, float(txt.get('end') or 5.0))
            if t_end <= t_start:
                continue
            st_name = str(txt.get('style') or '')
            is_top = st_name.endswith('_top') or ti == 0
            add_text_impl(
                text=t_str,
                start=t_start,
                end=t_end,
                draft_id=draft_id,
                transform_x=0.22,
                transform_y=0.68 if is_top else 0.55,
                font=palette['top_font'] if is_top else palette['bottom_font'],
                font_color='#FFFFFF' if is_top else palette['accent_hex'],
                font_size=14.0 if is_top else 15.0,
                track_name='title_top' if is_top else 'title_bottom',
                border_color=palette['accent_hex'] if is_top else '#FFFFFF',
                border_width=24.0,
                shadow_enabled=True,
                width=w,
                height=h,
                bold=True,
            )

        # 3) 中英双语 + 错落分层 + 关键词放大高亮字幕轨
        subs_cfg = recipe.get('subtitles') if isinstance(recipe.get('subtitles'), dict) else {}
        segs = subs_cfg.get('segments') if isinstance(subs_cfg.get('segments'), list) else []
        for seg in segs:
            z_txt = str(seg.get('text') or '').strip()
            if not z_txt:
                continue
            s_t = max(0.0, float(seg.get('start') or 0.0))
            e_t = min(total_dur, float(seg.get('end') or (s_t + 1.5)))
            if e_t <= s_t + 0.05:
                continue
            kw = str(seg.get('keyword') or '').strip()
            layered = bool(seg.get('layered')) and len(_PUNC_RE.sub('', z_txt)) >= 8

            def _build_kw_ranges(line_text: str) -> list[Any] | None:
                if not kw or kw not in line_text:
                    return None
                idx = line_text.index(kw)
                return [TextStyleRange(
                    start=idx,
                    end=idx + len(kw),
                    style=Text_style(size=12.5, bold=True, color=palette['accent_rgb']),
                    border=Text_border(alpha=1.0, color=palette['kw_border_rgb'], width=28.0),
                )]

            if layered:
                top_line, bot_line = _split_layered_zh(z_txt)
                if top_line:
                    add_text_impl(
                        text=top_line,
                        start=s_t,
                        end=e_t,
                        draft_id=draft_id,
                        transform_x=-0.16,
                        transform_y=-0.50,
                        font=palette['sub_font'],
                        font_color='#FFFFFF',
                        font_size=9.5,
                        track_name='sub_zh_top',
                        border_color='#000000',
                        border_width=14.0,
                        shadow_enabled=True,
                        width=w,
                        height=h,
                        text_styles=_build_kw_ranges(top_line),
                    )
                if bot_line:
                    add_text_impl(
                        text=bot_line,
                        start=s_t,
                        end=e_t,
                        draft_id=draft_id,
                        transform_x=0.16,
                        transform_y=-0.62,
                        font=palette['sub_font'],
                        font_color='#FFFFFF',
                        font_size=9.5,
                        track_name='sub_zh_bottom',
                        border_color='#000000',
                        border_width=14.0,
                        shadow_enabled=True,
                        width=w,
                        height=h,
                        text_styles=_build_kw_ranges(bot_line),
                    )
            else:
                add_text_impl(
                    text=z_txt,
                    start=s_t,
                    end=e_t,
                    draft_id=draft_id,
                    transform_x=0.0,
                    transform_y=-0.56,
                    font=palette['sub_font'],
                    font_color='#FFFFFF',
                    font_size=9.8,
                    track_name='sub_zh_top',
                    border_color='#000000',
                    border_width=14.0,
                    shadow_enabled=True,
                    width=w,
                    height=h,
                    text_styles=_build_kw_ranges(z_txt),
                )

            en_txt = str(seg.get('en') or '').strip()
            if en_txt:
                add_text_impl(
                    text=en_txt,
                    start=s_t,
                    end=e_t,
                    draft_id=draft_id,
                    transform_x=0.0,
                    transform_y=-0.72,
                    font='经典雅黑',
                    font_color='#F2F2F2',
                    font_size=5.2,
                    track_name='sub_en',
                    border_color='#000000',
                    border_width=8.0,
                    shadow_enabled=True,
                    width=w,
                    height=h,
                )

        # 4) 提示音效轨
        for si, item in enumerate(recipe.get('sfx') or []):
            sp = str(item.get('path') or '').strip()
            if not sp or not os.path.exists(sp):
                continue
            at = max(0.0, float(item.get('at') or 0.0))
            vol = float(item.get('volume') or 0.35)
            add_audio_track(
                audio_url=sp,
                draft_folder=folder,
                start=0.0,
                target_start=at,
                draft_id=draft_id,
                volume=vol,
                track_name=f'sfx_{si % 2}',
                width=w,
                height=h,
            )

        # 5) 氛围 BGM 轨
        bgm_cfg = (recipe.get('audio') or {}).get('bgm') if isinstance(recipe.get('audio'), dict) else None
        if isinstance(bgm_cfg, dict):
            bgm_path = str(bgm_cfg.get('path') or '').strip()
            if not bgm_path and bgm_cfg.get('mode') == 'auto':
                try:
                    import xcy_audiofx
                    lib = xcy_audiofx.library()
                    if lib:
                        bgm_path = str(lib[0].get('path') or '')
                except Exception:
                    bgm_path = ''
            if bgm_path and os.path.exists(bgm_path):
                add_audio_track(
                    audio_url=bgm_path,
                    draft_folder=folder,
                    start=0.0,
                    end=total_dur,
                    target_start=0.0,
                    draft_id=draft_id,
                    volume=float(bgm_cfg.get('volume') or 0.10),
                    track_name='bgm',
                    width=w,
                    height=h,
                )

        saved = save_draft_impl(draft_id, draft_folder=folder, project_name=pname, auto_deploy=True)
        return {
            'ok': bool(saved.get('success')),
            'draft_id': draft_id,
            'project_name': pname,
            'draft_folder': folder,
            'draft_url': saved.get('draft_url') or '',
            'error': saved.get('error') or '',
        }
    except Exception as exc:  # noqa: BLE001
        return {'ok': False, 'error': f'导出剪映草稿失败：{exc}'}
