from __future__ import annotations

import random

from PIL import Image, ImageDraw

from ..scene_spec import SceneSpec
from .colors import TIME_RAMPS, WARM, pick, ramp
from .noise import bayer4


def _dithered_rows(draw: ImageDraw.ImageDraw, width: int, horizon: int, colors: list[str]) -> None:
    """少量大色带，只在交界两行做低密度抖动，避免半调网纹。"""

    if horizon <= 0 or not colors:
        return
    bands = len(colors)
    for band in range(bands):
        y0 = int(horizon * band / bands)
        y1 = int(horizon * (band + 1) / bands)
        if y1 <= y0:
            continue
        draw.rectangle((0, y0, width - 1, y1 - 1), fill=colors[band])
        if band + 1 < bands:
            accent = colors[band + 1]
            for y in range(max(y0, y1 - 2), y1):
                for x in range(width):
                    if bayer4(x, y) < 2:
                        draw.point((x, y), fill=accent)


def draw_sky(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    spec: SceneSpec,
    palette: list[str],
    rng: random.Random,
) -> None:
    width, height = img.size
    horizon = max(1, int(height * spec.composition.horizon))
    colors = ramp(palette, TIME_RAMPS.get(spec.time, TIME_RAMPS["dusk"]))
    _dithered_rows(draw, width, horizon, colors)

    # 薄雾/云只做地平线附近的低对比色带，不画成横向色条。
    haze = pick(palette, (WARM[9], WARM[8], "#f2e5c8"))
    for index in range(2):
        y = horizon - 16 - index * 10
        left = rng.randint(0, width // 3)
        right = rng.randint(width // 2, width)
        draw.rectangle((left, y, right, y + 2), fill=haze)
        for x in range(left, right, 3):
            if bayer4(x, y) < 4:
                draw.point((x, y + 3), fill=haze)

    if spec.time == "night":
        star = pick(palette, ("#fff0cc", "#f2e5c8"))
        for _ in range(18):
            x = rng.randint(0, width - 1)
            y = rng.randint(6, max(10, horizon - 40))
            draw.point((x, y), fill=star)

    # 日/月：暖色同心盘，不用渐变。
    if spec.time == "night":
        cx = int(width * 0.72)
        cy = int(horizon * 0.36)
        moon = pick(palette, ("#fff0cc", "#e8d2ae", "#f2e5c8"))
        halo = pick(palette, ("#8bb4b0", "#6d9ba0", "#d4ba90"))
        draw.ellipse((cx - 22, cy - 22, cx + 22, cy + 22), fill=halo)
        draw.ellipse((cx - 16, cy - 16, cx + 16, cy + 16), fill=moon)
    else:
        cx = int(width * (0.68 + rng.uniform(-0.08, 0.08)))
        cy = horizon - rng.randint(24, 68)
        outer = pick(palette, ("#b87a62", "#d18f67", "#e6a96f"))
        middle = pick(palette, ("#e6a96f", "#f4c27e", "#ffd9a0"))
        core = pick(palette, ("#ffd9a0", "#fff0cc", "#f4c27e"))
        draw.ellipse((cx - 42, cy - 42, cx + 42, cy + 42), fill=outer)
        draw.ellipse((cx - 30, cy - 30, cx + 30, cy + 30), fill=middle)
        draw.ellipse((cx - 18, cy - 18, cx + 18, cy + 18), fill=core)
