from __future__ import annotations

import glob
import random
from collections.abc import Callable
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .draw.landmarks import LANDMARK_DRAWERS
from .draw.props import draw_props
from .draw.sky import draw_sky
from .draw.terrain import draw_terrain
from .draw.water import draw_water
from .draw.weather import draw_weather
from .palette import load_palette
from .scene_spec import SceneSpec

ProgressFn = Callable[[int, str], None]


def _notify(progress: ProgressFn | None, percent: int, detail: str) -> None:
    if progress is not None:
        progress(percent, detail)


def draw_scene(spec: SceneSpec, progress: ProgressFn | None = None) -> Image.Image:
    """按图层绘制 960×540 像素场景；确定性由 spec.seed 控制。"""

    palette = load_palette()
    img = Image.new("RGBA", (960, 540), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    rng = random.Random(spec.seed)

    _notify(progress, 5, "正在铺开天空")
    draw_sky(img, draw, spec, palette, rng)
    _notify(progress, 25, "正在推远山与岸线")
    draw_terrain(img, draw, spec, palette, rng)
    _notify(progress, 40, "正在铺水面")
    draw_water(img, draw, spec, palette, rng)
    _notify(progress, 60, "正在立起主地标")
    drawer = LANDMARK_DRAWERS.get(spec.landmark_type, LANDMARK_DRAWERS["cliff_buddha"])
    drawer(img, draw, spec, palette, rng)
    _notify(progress, 80, "正在添前景与人物尺度")
    draw_props(img, draw, spec, palette, rng)
    _notify(progress, 90, "正在落天气与暗角")
    draw_weather(img, draw, spec, palette, rng)
    _notify(progress, 100, "场景完成")
    return img


def to_2x(img: Image.Image) -> Image.Image:
    return img.resize((img.width * 2, img.height * 2), Image.Resampling.NEAREST)


@lru_cache(maxsize=8)
def _font(size: int) -> ImageFont.FreeTypeFont | None:
    candidates = (
        "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSerifCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/arphic/uming.ttc",
    )
    for value in candidates:
        if Path(value).exists():
            try:
                return ImageFont.truetype(value, size)
            except OSError:
                continue
    for pattern in ("/usr/share/fonts/**/*CJK*.ttc", "/usr/share/fonts/**/*CJK*.otf", "/usr/share/fonts/**/*.ttc"):
        for value in glob.glob(pattern, recursive=True):
            try:
                return ImageFont.truetype(value, size)
            except OSError:
                continue
    return None


def _seal(draw: ImageDraw.ImageDraw, x: int, y: int, size: int) -> None:
    draw.rectangle((x, y, x + size, y + size), fill="#b8443a")
    draw.rectangle((x + 5, y + 5, x + size - 5, y + size - 5), outline="#efe6d2", width=2)
    # 抽象印纹：几笔金文式折线，不依赖字体。
    cx = x + size // 2
    cy = y + size // 2
    draw.line((cx - size // 4, cy - size // 6, cx + size // 4, cy - size // 6), fill="#efe6d2", width=2)
    draw.line((cx, cy - size // 6, cx, cy + size // 5), fill="#efe6d2", width=2)
    draw.line((cx - size // 5, cy + size // 6, cx + size // 5, cy + size // 6), fill="#efe6d2", width=2)


def make_postcard(scene: Image.Image, spec: SceneSpec) -> Image.Image:
    """2112×1432 明信片：2× 场景 + 纸边框 + 题签 + 朱砂印。"""

    if scene.size != (1920, 1080):
        scene = scene.resize((1920, 1080), Image.Resampling.NEAREST)
    card = Image.new("RGBA", (2112, 1432), "#efe6d2")
    draw = ImageDraw.Draw(card)
    # 场景投影，再贴 2× 场景；贴图覆盖 (96,96)，不画边线压住场景。
    draw.rectangle((88, 88, 2023, 1174), fill="#bda077")
    card.paste(scene, (96, 96), scene)
    draw.line((96, 1188, 2016, 1188), fill="#d8b46a", width=2)

    title_font = _font(54)
    sub_font = _font(26)
    date_font = _font(20)
    title = spec.title or spec.place
    subtitle = spec.subtitle or ""
    date_text = (spec.created_at or datetime.now().isoformat())[:10].replace("-", ".")
    if title_font:
        draw.text((128, 1210), title, font=title_font, fill="#1a1c20")
    if sub_font and subtitle:
        draw.text((128, 1284), subtitle, font=sub_font, fill="#5a4c3e")
    if date_font:
        draw.text((128, 1332), date_text, font=date_font, fill="#7d6852")
    _seal(draw, 1900, 1210, 88)
    return card
