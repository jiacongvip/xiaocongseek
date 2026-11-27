#!/usr/bin/env python3
"""Offline local styled Chinese text renderer (no Xiaocongcut cloud / effect_effect_id).

Renders transparent PNG with self-owned style presets.
Uses system/open fonts only. Never fetches paid CapCut flower-text packs.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
FONTS_DIR = HERE / "fonts"

STYLES = {
  "basic_stroke": {
    "label": "基础描边",
    "features": ["stroke"],
    "note": "白芯+单色描边；原生草稿可接近保真（solid+border）",
  },
  "cream_brush_title": {
    "label": "奶白毛笔标题",
    "features": ["brush_font", "cream_fill", "thin_brown_stroke", "shadow"],
    "note": "开源毛笔字+近实心奶黄填充+细棕描边；对齐参考片标题，非剪映原生",
  },
  "cream_italic_subtitle": {
    "label": "奶白斜体字幕",
    "features": ["cream_fill", "italic", "brown_stroke", "shadow"],
    "note": "黑体斜切+近实心奶黄+中等棕描边；对齐参考片底字幕",
  },
    "cream_pop_italic": {
    "label": "奶油粗斜短视频",
    "features": ["cream_fill", "italic", "thick_brown_stroke", "shadow"],
    "note": "原创：亮奶油填充+粗斜切+足量棕描边，短视频字幕感",
  },
  "tech_cyan_white": {
    "label": "清爽蓝白科技",
    "features": ["white_fill", "cyan_stroke", "glow", "shadow"],
    "note": "原创：白芯+青描边+淡青外发光，科技感",
  },
  "warm_gold_solid": {
    "label": "暖金厚实标题",
    "features": ["bright_gold_fill", "dark_stroke", "shadow"],
    "note": "原创：字框局部亮金填充+深棕厚描边，标题感（非灰黑填色）",
  },
  "energy_red_white": {
    "label": "红白活力标题",
    "features": ["white_fill", "red_stroke", "shadow"],
    "note": "原创：白芯+朱红描边，活力标题（非促销话术）",
  },
  "mint_paper_tag": {
    "label": "薄荷纸签黑字",
    "features": ["mint_badge", "black_fill", "soft_shadow"],
    "note": "原创：薄荷色纸签底+黑体字，标签感",
  },
  "gold_italic_subtitle": {
    "label": "金色斜体字幕(已修正为奶白斜体别名)",
    "features": ["cream_fill", "italic", "brown_stroke", "shadow"],
    "note": "历史名保留；实现已改为 cream_italic_subtitle，避免旧调用继续出灰黑填色",
  },
  "gradient_gold": {
    "label": "渐变金",
    "features": ["gradient", "stroke"],
    "note": "金色纵向渐变填充 + 深色描边",
  },
  "emboss_3d": {
    "label": "立体浮雕",
    "features": ["emboss_3d", "stroke"],
    "note": "多层偏移阴影做出立体感",
  },
  "multi_stroke": {
    "label": "多层描边",
    "features": ["multi_stroke"],
    "note": "白芯 + 多层彩色描边",
  },
  "glow_neon": {
    "label": "霓虹发光",
    "features": ["glow", "stroke"],
    "note": "外发光 + 亮色描边",
  },
  "gradient_cyan": {
    "label": "渐变青",
    "features": ["gradient", "stroke"],
    "note": "青蓝渐变 + 描边",
  },
  "hook_yellow": {
    "label": "黄底大字",
    "features": ["yellow_badge", "black_fill"],
    "note": "黄底黑字，前三秒钩子。客户就说黄底大字。",
  },
  "subtitle_white": {
    "label": "白字黑边",
    "features": ["white_fill", "thick_black_stroke", "shadow"],
    "note": "白字粗黑边，贴在画面下方。客户就说白字黑边。",
  },
  "shop_sign": {
    "label": "店招红金",
    "features": ["red_fill", "gold_stroke", "shadow"],
    "note": "红字金边，适合店名。客户就说店招红金。",
  },
  "warn_orange": {
    "label": "橙色提醒",
    "features": ["orange_fill", "dark_stroke", "shadow"],
    "note": "橙字深边，适合提醒一句。客户就说橙色提醒。",
  },
  # ---- 图形类：不是纯文字，是"容器 + 文字"，配包装动效用 ----
  "stamp_seal": {
    "label": "印章",
    "features": ["seal_frame", "rotate", "red"],
    "note": "红色双线印章框+字+轻微旋转，配 stamp 音效砸下。客户就说「盖个章」。",
  },
  "info_card": {
    "label": "深色卡片",
    "features": ["dark_card", "accent_bar", "white_fill"],
    "note": "深色圆角卡+左侧黄条+白字，配 whoosh 滑入。讲解片的承载单元。",
  },
  "check_mark": {
    "label": "对勾",
    "features": ["green_circle", "check_glyph"],
    "note": "绿圆+白勾，纯图形（忽略传入文字），配 check 音效。",
  },
  "big_number": {
    "label": "数字放大",
    "features": ["huge_font", "heavy_stroke", "shadow"],
    "note": "超大数字+极粗描边，配 count 音效滚动。只放数字或极短词。",
  },
  "sheen_text": {
    "label": "银灰金属字",
    "features": ["metal_gradient", "dark_stroke", "shadow"],
    "note": "上亮下暗的银灰金属字，和白字有明显区分。配 sparkle 音效。注意：静态图做不出横扫光，别承诺。",
  },
}

STYLE_ALIASES = {
  "黄底大字": "hook_yellow",
  "白字黑边": "subtitle_white",
  "店招红金": "shop_sign",
  "橙色提醒": "warn_orange",
  "印章": "stamp_seal",
  "深色卡片": "info_card",
  "对勾": "check_mark",
  "数字放大": "big_number",
  "银灰金属字": "sheen_text",
  "高光字": "sheen_text",
  # 14 个设计款原本只能用英文 id 调，模型不会主动用；补中文名
  "基础描边": "basic_stroke",
  "手写笔刷": "cream_brush_title",
  "毛笔标题": "cream_brush_title",
  "奶白毛笔标题": "cream_brush_title",
  "斜体字幕": "cream_italic_subtitle",
  "奶白斜体字幕": "cream_italic_subtitle",
  "粗斜字幕": "cream_pop_italic",
  "奶油粗斜": "cream_pop_italic",
  "蓝白科技": "tech_cyan_white",
  "科技蓝白": "tech_cyan_white",
  "暖金标题": "warm_gold_solid",
  "暖金厚实": "warm_gold_solid",
  "红白标题": "energy_red_white",
  "活力标题": "energy_red_white",
  "薄荷纸签": "mint_paper_tag",
  "薄荷标签": "mint_paper_tag",
  "金色斜体字幕": "gold_italic_subtitle",
  "渐变金": "gradient_gold",
  "立体字": "emboss_3d",
  "3D 立体字": "emboss_3d",
  "多重描边": "multi_stroke",
  "霓虹字": "glow_neon",
  "渐变青": "gradient_cyan",
}

# 纯图形样式：不需要文字，text 可以留空
GRAPHIC_STYLES = {"check_mark"}

ENTRANCES = {
  "none": "无入场（静态）",
  "fade_in": "淡入",
  "slide_up": "上滑入场",
  "pop": "轻微弹出（缩放感由淡入+位移近似）",
  "pop_spring": "弹性弹入（快速放大过冲后回落，数帧级）",
}

# Measured REF fill ~ median RGB (234,223,186) cream; JPEG/bg bleed — not exact master HEX
CREAM_TOP = (255, 246, 210)
CREAM_BOT = (248, 232, 185)
STROKE_BROWN = (110, 68, 36)
STROKE_BROWN_SOFT = (78, 48, 24)


def find_font(style: str = "") -> str:
  override = os.environ.get("LOCAL_STYLED_TEXT_FONT", "").strip()
  if override and Path(override).exists():
    return override
  brush = [
    str(FONTS_DIR / "LongCang-Regular.ttf"),
    str(FONTS_DIR / "MaShanZheng-Regular.ttf"),
    str(FONTS_DIR / "ZhiMangXing-Regular.ttf"),
  ]
  sans = [
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    str(Path.home() / "Library/Fonts/NotoSansSC-Regular.otf"),
  ]
  if style in ("cream_brush_title",):
    for c in brush + sans:
      if c and Path(c).exists():
        return c
  for c in sans + brush:
    if c and Path(c).exists():
      return c
  raise FileNotFoundError("未找到可用中文字体。请安装字体或设置 LOCAL_STYLED_TEXT_FONT")


def load_font(size: int, style: str = "") -> ImageFont.FreeTypeFont:
  path = find_font(style)
  index = 0
  if path.endswith("Songti.ttc"):
    index = 0  # Songti SC Black
  try:
    return ImageFont.truetype(path, size=size, index=index)
  except Exception:
    return ImageFont.truetype(path, size=size)


def text_bbox(draw: ImageDraw.ImageDraw, text: str, font) -> tuple[int, int, int, int]:
  return draw.textbbox((0, 0), text, font=font)


def make_gradient(size: tuple[int, int], c1: tuple[int, int, int], c2: tuple[int, int, int]) -> Image.Image:
  w, h = size
  base = Image.new("RGBA", (w, h), (0, 0, 0, 0))
  px = base.load()
  for y in range(h):
    t = y / max(h - 1, 1)
    r = int(c1[0] * (1 - t) + c2[0] * t)
    g = int(c1[1] * (1 - t) + c2[1] * t)
    b = int(c1[2] * (1 - t) + c2[2] * t)
    for x in range(w):
      px[x, y] = (r, g, b, 255)
  return base


def fill_text_with_image(mask: Image.Image, fill: Image.Image) -> Image.Image:
  out = Image.new("RGBA", mask.size, (0, 0, 0, 0))
  out.paste(fill, (0, 0), mask)
  return out


def cream_fill_from_mask(mask: Image.Image, c1=CREAM_TOP, c2=CREAM_BOT) -> Image.Image:
  """Glyph-bbox-local mild cream gradient (NOT canvas-tall). Fixes gray/muddy fill."""
  bb = mask.getbbox()
  if not bb:
    return Image.new("RGBA", mask.size, (0, 0, 0, 0))
  l, t, r, b = bb
  gw, gh = max(1, r - l), max(1, b - t)
  local = make_gradient((gw, gh), c1, c2)
  full = Image.new("RGBA", mask.size, (0, 0, 0, 0))
  full.paste(local, (l, t))
  return fill_text_with_image(mask, full)


def crop_to_ink(img: Image.Image, pad: int = 24) -> Image.Image:
  if img.mode != "RGBA":
    img = img.convert("RGBA")
  alpha = img.split()[-1]
  bbox = alpha.getbbox()
  if not bbox:
    return img
  l, t, r, b = bbox
  l = max(0, l - pad)
  t = max(0, t - pad)
  r = min(img.width, r + pad)
  b = min(img.height, b + pad)
  return img.crop((l, t, r, b))


def shear_italic(img: Image.Image, shear: float = 0.22) -> Image.Image:
  if img.mode != "RGBA":
    img = img.convert("RGBA")
  w, h = img.size
  pad = int(abs(shear) * h) + 12
  base = Image.new("RGBA", (w + 2 * pad, h), (0, 0, 0, 0))
  base.paste(img, (pad, 0), img)
  bw, bh = base.size
  a, b, c = 1.0, -shear, shear * h
  d, e, f = 0.0, 1.0, 0.0
  return base.transform((bw, bh), Image.AFFINE, (a, b, c, d, e, f), resample=Image.BICUBIC)


def fit_max_width(img: Image.Image, max_w: int) -> Image.Image:
  if max_w <= 0 or img.width <= max_w:
    return img
  ratio = max_w / float(img.width)
  nh = max(1, int(round(img.height * ratio)))
  return img.resize((max_w, nh), Image.LANCZOS)


def apply_drop_shadow(fg: Image.Image, offset=(5, 6), blur: int = 4, alpha: int = 150) -> Image.Image:
  if fg.mode != "RGBA":
    fg = fg.convert("RGBA")
  pad = max(offset) + blur * 2 + 4
  canvas = Image.new("RGBA", (fg.width + pad * 2, fg.height + pad * 2), (0, 0, 0, 0))
  shadow = Image.new("RGBA", fg.size, (0, 0, 0, 0))
  _r, _g, _b, a = fg.split()
  sil = Image.merge("RGBA", (Image.new("L", fg.size, 0), Image.new("L", fg.size, 0), Image.new("L", fg.size, 0), a))
  shadow.paste(sil, (0, 0), sil)
  px = shadow.load()
  for y in range(shadow.height):
    for x in range(shadow.width):
      rr, gg, bb, aa = px[x, y]
      if aa:
        px[x, y] = (10, 8, 5, min(255, int(aa * alpha / 255)))
  shadow = shadow.filter(ImageFilter.GaussianBlur(radius=blur))
  ox, oy = offset
  canvas.alpha_composite(shadow, (pad + ox, pad + oy))
  canvas.alpha_composite(fg, (pad, pad))
  return canvas


def render_style(text: str, style: str, width: int = 1080, height: int = 600, font_size: int = 96) -> Image.Image:
  style = STYLE_ALIASES.get((style or "").strip(), (style or "").strip())
  if style not in STYLES:
    raise ValueError(f"未知样式: {style}；可选: {', '.join(STYLES)}")

  # Alias: old gold path was wrong (canvas-grad + ultra-thick black → gray fill)
  effective = "cream_italic_subtitle" if style == "gold_italic_subtitle" else style

  text = (text or "").strip()
  # 纯图形样式（对勾）不需要文字，别逼调用方编一个字出来
  if not text and effective not in GRAPHIC_STYLES:
    raise ValueError("文字不能为空")
  if len(text) > 40:
    raise ValueError("单次最多 40 个字，请缩短后重试")

  canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
  font = load_font(font_size, effective)
  for _ in range(12):
    probe = ImageDraw.Draw(Image.new("RGBA", (width, height), (0, 0, 0, 0)))
    l0, t0, r0, b0 = text_bbox(probe, text, font)
    if (r0 - l0) <= int(width * 0.92) or font_size <= 36:
      break
    font_size = max(36, font_size - 6)
    font = load_font(font_size, effective)
  probe = ImageDraw.Draw(canvas)
  l, t, r, b = text_bbox(probe, text, font)
  tw, th = r - l, b - t
  x = (width - tw) // 2 - l
  y = (height - th) // 2 - t

  def stroke_layers(img: Image.Image, color: tuple[int, int, int, int], radius: int):
    d = ImageDraw.Draw(img)
    for dx in range(-radius, radius + 1):
      for dy in range(-radius, radius + 1):
        if dx * dx + dy * dy <= radius * radius:
          d.text((x + dx, y + dy), text, font=font, fill=color)

  if effective == "basic_stroke":
    stroke_layers(canvas, (0, 0, 0, 255), 6)
    ImageDraw.Draw(canvas).text((x, y), text, font=font, fill=(255, 255, 255, 255))

  elif effective == "cream_brush_title":
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    # thin-medium brown stroke — preserve brush detail
    rad = max(2, min(5, font_size // 18))
    stroke_layers(layer, STROKE_BROWN_SOFT + (255,), rad + 1)
    stroke_layers(layer, STROKE_BROWN + (255,), rad)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).text((x, y), text, font=font, fill=255)
    layer.alpha_composite(cream_fill_from_mask(mask))
    layer = crop_to_ink(layer, pad=max(16, font_size // 5))
    layer = apply_drop_shadow(layer, offset=(4, 5), blur=4, alpha=140)
    return layer

  elif effective == "cream_italic_subtitle":
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    # medium brown stroke — NOT ultra-thick near-black
    rad = max(3, min(6, font_size // 14))
    stroke_layers(layer, STROKE_BROWN_SOFT + (255,), rad + 1)
    stroke_layers(layer, STROKE_BROWN + (255,), rad)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).text((x, y), text, font=font, fill=255)
    layer.alpha_composite(cream_fill_from_mask(mask))
    layer = crop_to_ink(layer, pad=max(16, font_size // 5))
    layer = shear_italic(layer, shear=0.28)
    layer = apply_drop_shadow(layer, offset=(5, 6), blur=4, alpha=150)
    return layer

  elif effective == "cream_pop_italic":
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rad = max(3, min(5, font_size // 20))
    stroke_layers(layer, (70, 42, 18, 255), rad + 1)
    stroke_layers(layer, (120, 75, 40, 255), rad)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).text((x, y), text, font=font, fill=255)
    layer.alpha_composite(cream_fill_from_mask(mask, (255, 250, 230), (255, 240, 200)))
    layer = crop_to_ink(layer, pad=max(16, font_size // 5))
    layer = shear_italic(layer, shear=0.30)
    layer = apply_drop_shadow(layer, offset=(6, 7), blur=5, alpha=160)
    return layer

  elif effective == "tech_cyan_white":
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    # soft cyan glow
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(glow).text((x, y), text, font=font, fill=(80, 220, 255, 255))
    for radius in (14, 9, 5):
      layer.alpha_composite(glow.filter(ImageFilter.GaussianBlur(radius=radius)))
    rad = max(3, min(6, font_size // 16))
    stroke_layers(layer, (20, 120, 160, 255), rad + 1)
    stroke_layers(layer, (40, 190, 230, 255), rad)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).text((x, y), text, font=font, fill=255)
    layer.alpha_composite(cream_fill_from_mask(mask, (255, 255, 255), (230, 248, 255)))
    layer = crop_to_ink(layer, pad=max(18, font_size // 5))
    layer = apply_drop_shadow(layer, offset=(4, 5), blur=4, alpha=120)
    return layer

  elif effective == "warm_gold_solid":
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    # thin chocolate outline so bright gold face stays dominant
    rad = max(2, min(4, font_size // 28))
    stroke_layers(layer, (90, 50, 12, 255), rad + 1)
    stroke_layers(layer, (150, 95, 30, 255), rad)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).text((x, y), text, font=font, fill=255)
    layer.alpha_composite(cream_fill_from_mask(mask, (255, 248, 190), (255, 210, 80)))
    # no Draw.text / partial-alpha sheen: both overwrite or premultiply and muddy the gold face
    layer = crop_to_ink(layer, pad=max(16, font_size // 5))
    layer = apply_drop_shadow(layer, offset=(5, 6), blur=4, alpha=150)
    return layer

  elif effective == "energy_red_white":
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rad = max(3, min(6, font_size // 16))
    stroke_layers(layer, (140, 20, 30, 255), rad + 1)
    stroke_layers(layer, (220, 45, 55, 255), rad)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).text((x, y), text, font=font, fill=255)
    layer.alpha_composite(cream_fill_from_mask(mask, (255, 255, 255), (255, 245, 245)))
    layer = crop_to_ink(layer, pad=max(16, font_size // 5))
    layer = apply_drop_shadow(layer, offset=(5, 6), blur=4, alpha=150)
    return layer

  elif effective == "mint_paper_tag":
    # badge behind glyphs
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    l0, t0, r0, b0 = text_bbox(probe, text, font)
    tw, th = r0 - l0, b0 - t0
    pad_x, pad_y = max(28, font_size // 3), max(18, font_size // 5)
    bw, bh = tw + pad_x * 2, th + pad_y * 2
    badge = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(badge)
    # mint paper with soft edge
    mint = (186, 230, 200, 255)
    mint_edge = (150, 205, 170, 255)
    d.rounded_rectangle((2, 2, bw - 3, bh - 3), radius=max(8, font_size // 8), fill=mint, outline=mint_edge, width=3)
    # slight paper noise via second lighter inset
    d.rounded_rectangle((6, 6, bw - 7, bh - 7), radius=max(6, font_size // 10), outline=(210, 240, 220, 180), width=1)
    # black text
    tx = pad_x - l0
    ty = pad_y - t0
    # thin dark outline for legibility
    for dx in range(-2, 3):
      for dy in range(-2, 3):
        if dx * dx + dy * dy <= 4:
          ImageDraw.Draw(badge).text((tx + dx, ty + dy), text, font=font, fill=(40, 55, 45, 90))
    ImageDraw.Draw(badge).text((tx, ty), text, font=font, fill=(22, 28, 26, 255))
    badge = apply_drop_shadow(badge, offset=(5, 6), blur=5, alpha=140)
    return badge

  elif effective == "hook_yellow":
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    l0, t0, r0, b0 = text_bbox(probe, text, font)
    tw, th = r0 - l0, b0 - t0
    pad_x, pad_y = max(32, font_size // 3), max(16, font_size // 6)
    bw, bh = tw + pad_x * 2, th + pad_y * 2
    badge = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(badge)
    d.rounded_rectangle((2, 2, bw - 3, bh - 3), radius=max(10, font_size // 7), fill=(255, 214, 40, 255), outline=(40, 28, 8, 255), width=4)
    tx = pad_x - l0
    ty = pad_y - t0
    for dx in range(-2, 3):
      for dy in range(-2, 3):
        if dx * dx + dy * dy <= 5:
          ImageDraw.Draw(badge).text((tx + dx, ty + dy), text, font=font, fill=(40, 24, 0, 255))
    ImageDraw.Draw(badge).text((tx, ty), text, font=font, fill=(18, 12, 8, 255))
    return apply_drop_shadow(badge, offset=(5, 6), blur=4, alpha=150)

  elif effective == "subtitle_white":
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rad = max(6, min(10, font_size // 10))
    stroke_layers(layer, (0, 0, 0, 255), rad)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).text((x, y), text, font=font, fill=255)
    layer.alpha_composite(cream_fill_from_mask(mask, (255, 255, 255), (245, 245, 245)))
    layer = crop_to_ink(layer, pad=max(16, font_size // 5))
    return apply_drop_shadow(layer, offset=(3, 4), blur=2, alpha=170)

  elif effective == "shop_sign":
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rad = max(4, min(7, font_size // 14))
    stroke_layers(layer, (90, 50, 8, 255), rad + 2)
    stroke_layers(layer, (255, 206, 64, 255), rad)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).text((x, y), text, font=font, fill=255)
    layer.alpha_composite(cream_fill_from_mask(mask, (230, 48, 42), (150, 16, 22)))
    layer = crop_to_ink(layer, pad=max(16, font_size // 5))
    return apply_drop_shadow(layer, offset=(5, 6), blur=4, alpha=150)

  elif effective == "warn_orange":
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rad = max(4, min(7, font_size // 14))
    stroke_layers(layer, (90, 32, 0, 255), rad + 1)
    stroke_layers(layer, (40, 18, 0, 255), rad)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).text((x, y), text, font=font, fill=255)
    layer.alpha_composite(cream_fill_from_mask(mask, (255, 186, 48), (255, 96, 16)))
    layer = crop_to_ink(layer, pad=max(16, font_size // 5))
    return apply_drop_shadow(layer, offset=(4, 5), blur=3, alpha=150)

  elif effective == "gradient_gold":
    stroke_layers(canvas, (90, 50, 10, 255), 5)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).text((x, y), text, font=font, fill=255)
    canvas.alpha_composite(cream_fill_from_mask(mask, (255, 240, 180), (210, 150, 40)))
    ImageDraw.Draw(canvas).text((x - 2, y - 2), text, font=font, fill=(255, 255, 255, 90))

  elif effective == "emboss_3d":
    for (ox, oy), col in [((3, 3), (0, 0, 0, 160)), ((1, 1), (40, 40, 40, 200)), ((-1, -1), (255, 255, 255, 120))]:
      ImageDraw.Draw(canvas).text((x + ox, y + oy), text, font=font, fill=col)
    ImageDraw.Draw(canvas).text((x, y), text, font=font, fill=(240, 220, 180, 255))

  elif effective == "multi_stroke":
    for rad, color in [(8, (20, 20, 20, 255)), (5, (200, 80, 40, 255)), (2, (255, 220, 100, 255))]:
      stroke_layers(canvas, color, rad)
    ImageDraw.Draw(canvas).text((x, y), text, font=font, fill=(255, 255, 255, 255))

  elif effective == "glow_neon":
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(glow).text((x, y), text, font=font, fill=(80, 255, 220, 255))
    for radius in (12, 8, 4):
      layer = glow.filter(ImageFilter.GaussianBlur(radius=radius))
      canvas.alpha_composite(layer)
    stroke_layers(canvas, (0, 180, 160, 255), 3)
    ImageDraw.Draw(canvas).text((x, y), text, font=font, fill=(230, 255, 250, 255))

  elif effective == "gradient_cyan":
    stroke_layers(canvas, (0, 40, 80, 255), 5)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).text((x, y), text, font=font, fill=255)
    canvas.alpha_composite(cream_fill_from_mask(mask, (180, 255, 255), (40, 120, 220)))

  # ==================== 图形类（配包装动效） ====================
  # 这几个不是"换个字色"，是"容器 + 字"。共同点：尺寸由文字撑开，最后整块旋转/投影。
  # 都返回已裁剪的图，main() 会再 crop 一次（pad 见白名单，不在白名单里用 font_size//4）。

  elif effective == "stamp_seal":
    # 红双线印章框 + 字 + 轻微倾斜。倾斜是刻意的：正得发假的章不像手盖的。
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    l0, t0, r0, b0 = text_bbox(probe, text, font)
    tw, th = r0 - l0, b0 - t0
    pad_x = max(46, int(font_size * 0.62))
    pad_y = max(30, int(font_size * 0.42))
    bw, bh = tw + pad_x * 2, th + pad_y * 2
    seal = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(seal)
    red = (188, 44, 40, 240)
    red_faint = (188, 44, 40, 120)
    w1 = max(4, font_size // 12)
    radius = max(12, font_size // 5)
    d.rounded_rectangle((w1, w1, bw - w1 - 1, bh - w1 - 1), radius=radius, outline=red, width=w1)
    inset = w1 + max(6, font_size // 14)
    d.rounded_rectangle(
      (inset, inset, bw - inset - 1, bh - inset - 1),
      radius=max(8, radius - 4), outline=red_faint, width=max(2, w1 // 2),
    )
    d.text((pad_x - l0, pad_y - t0), text, font=font, fill=red)
    return seal.rotate(-6, expand=True, resample=Image.BICUBIC)

  elif effective == "info_card":
    # 深色圆角卡 + 左侧黄条 + 白字。包装片里承载"一条信息"的最小单元。
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    l0, t0, r0, b0 = text_bbox(probe, text, font)
    tw, th = r0 - l0, b0 - t0
    bar = max(7, font_size // 14)
    pad_x = max(30, font_size // 3)
    pad_y = max(26, font_size // 3)
    bar_x = pad_x // 2
    bw = tw + pad_x * 2 + bar
    bh = th + pad_y * 2
    card = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle((0, 0, bw - 1, bh - 1), radius=max(16, font_size // 6), fill=(26, 26, 28, 238))
    d.rounded_rectangle(
      (bar_x, pad_y // 2, bar_x + bar, bh - pad_y // 2),
      radius=bar // 2, fill=(255, 210, 63, 255),
    )
    d.text((bar_x + bar + pad_x // 2 - l0, pad_y - t0), text, font=font, fill=(255, 255, 255, 255))
    return apply_drop_shadow(card, offset=(0, 8), blur=12, alpha=110)

  elif effective == "check_mark":
    # 绿圆 + 白勾。纯图形，忽略传入文字（GRAPHIC_STYLES 放行空文本）。
    size = min(width, height) - 8
    size = max(int(font_size * 1.8), min(size, int(min(width, height) * 0.7)))
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((2, 2, size - 3, size - 3), fill=(46, 168, 96, 255))
    lw = max(6, size // 11)
    p1 = (size * 0.28, size * 0.52)
    p2 = (size * 0.44, size * 0.69)
    p3 = (size * 0.74, size * 0.33)
    d.line([p1, p2, p3], fill=(255, 255, 255, 255), width=lw, joint="curve")
    rr = lw // 2
    for p in (p1, p2, p3):
      d.ellipse((p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr), fill=(255, 255, 255, 255))
    return apply_drop_shadow(img, offset=(0, 6), blur=8, alpha=100)

  elif effective == "big_number":
    # 数字放大：字号再放 1.8 倍，深底描边 + 黄内衬 + 投影。
    # 不能复用 stroke_layers：它闭包绑的是外面的 font，这里换了字号。
    big_size = int(font_size * 1.8)
    bfont = load_font(big_size, effective)
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    l0, t0, r0, b0 = text_bbox(probe, text, bfont)
    bx = (width - (r0 - l0)) // 2 - l0
    by = (height - (b0 - t0)) // 2 - t0
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rad = max(10, min(18, big_size // 9))
    for dx in range(-rad, rad + 1):
      for dy in range(-rad, rad + 1):
        if dx * dx + dy * dy <= rad * rad:
          d.text((bx + dx, by + dy), text, font=bfont, fill=(14, 14, 16, 255))
    inner = max(3, rad - 7)
    for dx in range(-inner, inner + 1):
      for dy in range(-inner, inner + 1):
        if dx * dx + dy * dy <= inner * inner:
          d.text((bx + dx, by + dy), text, font=bfont, fill=(255, 210, 63, 255))
    d.text((bx, by), text, font=bfont, fill=(255, 255, 255, 255))
    layer = crop_to_ink(layer, pad=max(20, font_size // 4))
    return apply_drop_shadow(layer, offset=(0, 8), blur=10, alpha=140)

  elif effective == "sheen_text":
    # 银灰金属字：上亮下暗的纵向渐变，像拉丝金属。
    # 注意：**这不是扫光**。扫光要高光条逐帧划过，草稿里的 overlay 是一张静态 PNG，
    # 做不出来；想做只能接逐帧渲染引擎。别跟客户说"字会扫光"。
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rad = max(5, min(9, font_size // 12))
    stroke_layers(layer, (18, 18, 20, 255), rad)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).text((x, y), text, font=font, fill=255)
    # 上端接近纯白、下端压到中灰，纵向拉出金属反光
    layer.alpha_composite(cream_fill_from_mask(mask, (252, 253, 255), (140, 148, 164)))
    layer = crop_to_ink(layer, pad=max(18, font_size // 5))
    return apply_drop_shadow(layer, offset=(4, 5), blur=4, alpha=150)

  return canvas


def write_preview_video(png: Path, out_mp4: Path, entrance: str, seconds: float = 2.0):
  import subprocess
  ffmpeg = os.environ.get("LOCAL_STYLED_TEXT_FFMPEG") or "ffmpeg"
  if entrance == "fade_in":
    overlay = "overlay=(W-w)/2:(H-h)/2:format=auto"
    fade = f"fade=t=in:st=0:d=0.45:alpha=1"
    fc = f"[1:v]format=rgba,{fade}[t];[0:v][t]{overlay}"
  elif entrance == "slide_up":
    fc = (
      "[1:v]format=rgba[t];"
      "[0:v][t]overlay=(W-w)/2:'H*0.15+if(lt(t,0.45),(H*0.35)*(1-t/0.45),0)':format=auto"
    )
  elif entrance == "pop":
    fc = (
      "[1:v]format=rgba,fade=t=in:st=0:d=0.25:alpha=1[t];"
      "[0:v][t]overlay=(W-w)/2:(H-h)/2:format=auto"
    )
  elif entrance == "pop_spring":
    fc = (
      "[1:v]format=rgba,"
      "scale=iw*if(lt(t\\,0.10)\\,0.70+4.8*t\\,if(lt(t\\,0.18)\\,1.18\\,if(lt(t\\,0.28)\\,1.18-1.8*(t-0.18)\\,1.0))):"
      "ih*if(lt(t\\,0.10)\\,0.70+4.8*t\\,if(lt(t\\,0.18)\\,1.18\\,if(lt(t\\,0.28)\\,1.18-1.8*(t-0.18)\\,1.0))):eval=frame,"
      "fade=t=in:st=0:d=0.08:alpha=1[t];"
      "[0:v][t]overlay=(W-w)/2:(H-h)/2:format=auto"
    )
  else:
    fc = "[0:v][1:v]overlay=(W-w)/2:(H-h)/2:format=auto"
  cmd = [
    ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", f"color=c=0x101820:s=1080x1920:d={seconds}",
    "-loop", "1", "-i", str(png),
    "-filter_complex", fc,
    "-t", str(seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", str(out_mp4),
  ]
  p = subprocess.run(cmd, capture_output=True, text=True)
  if p.returncode != 0:
    raise RuntimeError((p.stderr or p.stdout or "ffmpeg failed")[-500:])


def main():
  ap = argparse.ArgumentParser()
  ap.add_argument("--list-styles", action="store_true")
  ap.add_argument("--text", default="")
  ap.add_argument("--style", default="gradient_gold")
  ap.add_argument("--entrance", default="fade_in")
  ap.add_argument("--out-png", default="")
  ap.add_argument("--out-mp4", default="")
  ap.add_argument("--width", type=int, default=1080)
  ap.add_argument("--height", type=int, default=600)
  ap.add_argument("--font-size", type=int, default=96)
  ap.add_argument("--max-out-width", type=int, default=0, help="Downscale final PNG if wider (safe area vs video width/spring)")
  ap.add_argument("--check", action="store_true")
  args = ap.parse_args()

  if args.list_styles:
    print(json.dumps({"styles": STYLES, "entrances": ENTRANCES, "font_title": find_font("cream_brush_title"), "font_sub": find_font("cream_italic_subtitle")}, ensure_ascii=False, indent=2))
    return 0

  if args.check:
    font = find_font("cream_italic_subtitle")
    import importlib.util
    ok_pil = importlib.util.find_spec("PIL") is not None
    import shutil
    ff = shutil.which(os.environ.get("LOCAL_STYLED_TEXT_FFMPEG") or "ffmpeg")
    print(json.dumps({"ok": bool(ok_pil and font and ff), "pillow": ok_pil, "font": font, "font_title": find_font("cream_brush_title"), "ffmpeg": ff}, ensure_ascii=False))
    return 0 if (ok_pil and font and ff) else 2

  img = render_style(args.text, args.style, args.width, args.height, args.font_size)
  if args.style not in ("cream_brush_title", "cream_italic_subtitle", "gold_italic_subtitle", "cream_pop_italic", "tech_cyan_white", "warm_gold_solid", "energy_red_white", "mint_paper_tag"):
    img = crop_to_ink(img, pad=max(16, args.font_size // 4))
  else:
    img = crop_to_ink(img, pad=max(14, args.font_size // 6))
  if args.max_out_width and args.max_out_width > 0:
    img = fit_max_width(img, int(args.max_out_width))
  out_png = Path(args.out_png)
  out_png.parent.mkdir(parents=True, exist_ok=True)
  img.save(out_png)

  if args.out_mp4:
    write_preview_video(out_png, Path(args.out_mp4), args.entrance)
  print(json.dumps({"ok": True, "success": True, "png": str(out_png), "size": list(img.size), "style": args.style, "font": find_font("cream_brush_title" if args.style == "cream_brush_title" else "cream_italic_subtitle")}, ensure_ascii=False))
  return 0


if __name__ == "__main__":
  try:
    raise SystemExit(main())
  except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(1)
