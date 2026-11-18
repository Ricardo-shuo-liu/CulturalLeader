from __future__ import annotations

import random

from PIL import Image, ImageDraw

from ..scene_spec import SceneSpec
from .colors import EARTH, GREEN, INK, WARM, WATER, accent_color, pick


def _pine(draw: ImageDraw.ImageDraw, x: int, y: int, height_px: int, color: str, dark: str) -> None:
    for index in range(3):
        half = max(4, height_px // (4 + index))
        top = y - height_px + index * (height_px // 4)
        draw.polygon(((x - half, top + height_px // 3), (x, top), (x + half, top + height_px // 3)), fill=color)
    draw.rectangle((x - 2, y - height_px // 5, x + 2, y), fill=dark)


def _willow(draw: ImageDraw.ImageDraw, x: int, y: int, height_px: int, color: str, trunk: str, rng: random.Random) -> None:
    draw.line((x, y, x, y - height_px), fill=trunk)
    for index in range(6):
        side = -1 if index % 2 == 0 else 1
        length = rng.randint(height_px // 4, height_px // 2)
        draw.line(
            (x, y - height_px + index * 5, x + side * rng.randint(12, 30), y - height_px + index * 5 + length),
            fill=color,
        )


def draw_props(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    spec: SceneSpec,
    palette: list[str],
    rng: random.Random,
) -> None:
    width, height = img.size
    horizon = int(height * spec.composition.horizon)
    props = set(spec.props)
    if not props:
        if spec.environment == "canal":
            props = {"willows", "boat", "lanterns"}
        elif spec.environment == "lake":
            props = {"willows", "boat"}
        elif spec.environment == "urban":
            props = {"lanterns", "birds"}
        else:
            props = {"pines", "birds"}

    ground = pick(palette, (GREEN[1], GREEN[2], EARTH[4]))
    ground_dark = pick(palette, (GREEN[0], GREEN[1], INK[1]))
    pine = pick(palette, (GREEN[2], GREEN[3], GREEN[1]))
    willow = pick(palette, (GREEN[4], GREEN[3], GREEN[5]))
    trunk = pick(palette, (EARTH[3], EARTH[4]))
    bird = pick(palette, (INK[1], INK[0]))
    lantern = pick(palette, (WARM[7], WARM[6], "#ffd9a0"))
    boat = pick(palette, (EARTH[3], EARTH[2], INK[1]))
    seal = accent_color(palette, spec.accent_role)

    # 前景草坡/岸线，给画面一个落脚点。
    draw.rectangle((0, height - 34, width - 1, height - 1), fill=ground_dark)
    for _ in range(120):
        x = rng.randrange(0, width, 2)
        y = rng.randrange(height - 34, height, 2)
        draw.rectangle((x, y, min(width - 1, x + 1), min(height - 1, y + 1)), fill=ground if rng.random() < 0.55 else ground_dark)

    if "pines" in props:
        for index in range(3):
            x = int(width * (0.08 + index * 0.05)) + rng.randint(-10, 10)
            _pine(draw, x, height - 38, rng.randint(60, 110), pine, trunk)
    if "willows" in props:
        for index in range(3):
            side = -1 if index % 2 == 0 else 1
            x = int(width * (0.5 + side * (0.38 + index * 0.05)))
            _willow(draw, x, height - 34, rng.randint(70, 120), willow, trunk, rng)
    if "birds" in props:
        bird_y = max(40, horizon - rng.randint(70, 150))
        for index in range(4):
            x = rng.randint(80, width - 80)
            y = bird_y + index * 14
            draw.line((x - 5, y, x, y - 3), fill=bird)
            draw.line((x, y - 3, x + 5, y), fill=bird)
    if "boat" in props and spec.environment in {"river_valley", "lake", "canal", "coast"}:
        bx = rng.randint(int(width * 0.25), int(width * 0.75))
        by = horizon + int((height - horizon) * 0.42)
        draw.polygon(((bx - 28, by), (bx + 28, by), (bx + 18, by + 9), (bx - 18, by + 9)), fill=boat)
        draw.line((bx, by - 26, bx, by), fill=trunk)
        draw.polygon(((bx, by - 26), (bx + 20, by - 12), (bx, by - 6)), fill=lantern)
    if "lanterns" in props:
        for side in (-1, 1):
            lx = int(width * (0.14 if side < 0 else 0.86))
            ly = height - 40
            draw.rectangle((lx - 1, ly - 26, lx + 1, ly), fill=trunk)
            draw.rectangle((lx - 8, ly - 34, lx + 8, ly - 20), fill=lantern)
            draw.rectangle((lx - 10, ly - 36, lx + 10, ly - 34), fill=INK[1])
            draw.rectangle((lx - 2, ly - 18, lx + 2, ly - 16), fill=seal)
    if "petals" in props:
        for _ in range(26):
            x = rng.randint(0, width - 1)
            y = rng.randint(80, height - 60)
            color = pick(palette, (WARM[7], WARM[8], WARM[5]))
            draw.rectangle((x, y, min(width - 1, x + 1), y + 1), fill=color)
