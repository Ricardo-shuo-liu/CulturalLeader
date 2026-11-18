from __future__ import annotations

import random

from PIL import Image, ImageDraw

from ..scene_spec import SceneSpec
from .colors import WARM, WATER, pick, ramp


def draw_water(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    spec: SceneSpec,
    palette: list[str],
    rng: random.Random,
) -> None:
    if spec.environment not in {"river_valley", "lake", "canal", "coast"}:
        return
    width, height = img.size
    horizon = int(height * spec.composition.horizon)
    top = min(height - 2, horizon + 8)
    bottom = height - 1
    colors = ramp(palette, WATER)
    if spec.time == "night":
        colors = ramp(palette, ("#1b2f38", "#254452", "#315866", "#3f6e7a"))
    elif spec.time in {"dawn", "dusk"}:
        colors = ramp(palette, ("#254452", "#315866", "#3f6e7a", "#54848c", "#6d9ba0"))

    bands = 5
    for band in range(bands):
        y0 = top + int((bottom - top) * band / bands)
        y1 = top + int((bottom - top) * (band + 1) / bands)
        color = colors[min(len(colors) - 1, band)]
        draw.rectangle((0, y0, width - 1, y1), fill=color)
        # 交界处用 2×2 抖动，避免硬条带
        if band + 1 < bands:
            next_color = colors[min(len(colors) - 1, band + 1)]
            for x in range(0, width, 2):
                if (x // 2 + band) % 3 == 0:
                    draw.rectangle((x, y1 - 1, min(width - 1, x + 1), y1), fill=next_color)

    # 水面短横高光：不做规则圆点。
    glint_light = pick(palette, ("#8bb4b0", "#6d9ba0", "#54848c"))
    glint_warm = pick(palette, WARM[7:9])
    for index in range(64):
        x = rng.randrange(0, width)
        y = rng.randrange(top + 4, max(top + 5, bottom - 4))
        length = rng.randint(3, 12)
        color = glint_warm if index % 7 == 0 else glint_light
        draw.rectangle((x, y, min(width - 1, x + length), y), fill=color)

    # 夕阳/晨光倒影：暖色短竖线，集中在一片水域。
    if spec.time in {"dawn", "dusk"}:
        cx = int(width * 0.68)
        for y in range(top + 8, bottom - 8, 7):
            span = 3 + (y - top) // 42
            draw.rectangle((cx - span, y, cx + span, y), fill=pick(palette, ("#d18f67", "#e6a96f", "#f4c27e")))
