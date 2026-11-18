from __future__ import annotations

import random

from PIL import Image, ImageDraw

from ..scene_spec import SceneSpec
from .colors import EARTH, GREEN, pick, ramp
from .noise import bayer4, value_noise_1d


def _ridge(
    draw: ImageDraw.ImageDraw,
    width: int,
    base_y: int,
    amplitude: int,
    scale: int,
    color: str,
    rng: random.Random,
    *,
    top_dither: str | None = None,
) -> None:
    noise = value_noise_1d(width, rng, scale)
    for x in range(width):
        top = base_y - int(noise[x] * amplitude)
        draw.line((x, top, x, base_y + 2), fill=color)
        if top_dither and bayer4(x, top) < 4:
            draw.point((x, top), fill=top_dither)


def draw_terrain(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    spec: SceneSpec,
    palette: list[str],
    rng: random.Random,
) -> None:
    width, height = img.size
    horizon = max(1, int(height * spec.composition.horizon))
    dark = ramp(palette, EARTH[:5])
    stone = ramp(palette, EARTH[2:8])
    ground = pick(palette, ("#5a4c3e", "#6b5947", "#4a4038"))
    ground_dark = pick(palette, ("#403b34", "#33322f", "#4a4038"))
    ground_light = pick(palette, ("#7d6852", "#91785e", "#a68a68"))

    # 远山：两层不同尺度，避免规则正弦。
    _ridge(draw, width, horizon - 22, 78, 170, dark[1], rng, top_dither=dark[0])
    _ridge(draw, width, horizon - 4, 46, 90, stone[2], rng)

    # 地面/岸线：填满地平线以下，后续水面和地标覆盖。
    draw.rectangle((0, horizon, width - 1, height - 1), fill=ground)
    for y in range(horizon, height):
        if (y - horizon) % 18 == 0 and rng.random() < 0.5:
            draw.line((0, y, width - 1, y), fill=ground_dark)
    for _ in range(90):
        x = rng.randrange(0, width, 2)
        y = rng.randrange(horizon, height, 2)
        color = ground_light if rng.random() < 0.45 else ground_dark
        draw.rectangle((x, y, min(width - 1, x + 1), min(height - 1, y + 1)), fill=color)

    # 岸边草带：只在有水的环境出现。
    if spec.environment in {"river_valley", "lake", "canal", "coast"}:
        green = ramp(palette, GREEN[1:6])
        bank = horizon + int((height - horizon) * 0.72)
        for y in range(bank, min(height, bank + 26)):
            color = green[1] if y < bank + 10 else green[0]
            draw.line((0, y, width - 1, y), fill=color)
        for _ in range(70):
            x = rng.randrange(0, width, 2)
            y = rng.randrange(bank, min(height, bank + 24))
            draw.rectangle((x, y, min(width - 1, x + 1), min(height - 1, y + 1)), fill=green[2])
