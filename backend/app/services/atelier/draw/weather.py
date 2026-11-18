from __future__ import annotations

import random

from PIL import Image, ImageDraw

from ..scene_spec import SceneSpec
from .colors import EARTH, INK, WARM, WATER, pick


def draw_weather(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    spec: SceneSpec,
    palette: list[str],
    rng: random.Random,
) -> None:
    width, height = img.size
    horizon = int(height * spec.composition.horizon)

    if spec.weather == "mist":
        mist = pick(palette, (EARTH[9], EARTH[10], WARM[9]))
        for _ in range(7):
            y = rng.randint(max(30, horizon - 80), min(height - 80, horizon + 90))
            x0 = rng.randint(-80, width // 2)
            x1 = rng.randint(width // 2, width + 80)
            draw.rectangle((x0, y, x1, y + rng.randint(2, 5)), fill=mist)
            for x in range(max(0, x0), min(width, x1), 2):
                if rng.random() < 0.35:
                    draw.rectangle((x, y + 2, x + 1, y + 3), fill=mist)
    elif spec.weather == "rain":
        rain = pick(palette, (WATER[4], WATER[5], WATER[6]))
        for _ in range(85):
            x = rng.randint(0, width - 1)
            y = rng.randint(30, height - 20)
            draw.line((x, y, x - 2, y + rng.randint(5, 12)), fill=rain)
    elif spec.weather == "snow":
        snow = pick(palette, (WARM[9], WARM[8], "#fff0cc"))
        for _ in range(90):
            x = rng.randint(0, width - 2)
            y = rng.randint(20, height - 20)
            draw.rectangle((x, y, x + 1, y + 1), fill=snow)

    if "petals" in spec.props and spec.weather != "snow":
        petal = pick(palette, (WARM[7], WARM[8], WARM[5]))
        for _ in range(28):
            x = rng.randint(0, width - 2)
            y = rng.randint(60, height - 50)
            draw.rectangle((x, y, x + 1, y + 1), fill=petal)

    # 暗角：稀疏 2×2 墨点，避免渐变与亚像素。
    dark = pick(palette, (INK[0], INK[1]))
    for _ in range(220):
        x = rng.randint(0, width - 2)
        y = rng.randint(0, height - 2)
        dx = abs(x - width / 2) / (width / 2)
        dy = abs(y - height / 2) / (height / 2)
        if max(dx, dy) > 0.78 and rng.random() < 0.7:
            draw.rectangle((x, y, x + 1, y + 1), fill=dark)
