from __future__ import annotations

import math
import random

BAYER4 = (
    (0, 8, 2, 10),
    (12, 4, 14, 6),
    (3, 11, 1, 9),
    (15, 7, 13, 5),
)


def bayer4(x: int, y: int) -> int:
    return BAYER4[y % 4][x % 4]


def value_noise_1d(length: int, rng: random.Random, scale: int) -> list[float]:
    """一维 value noise，余弦插值；返回 0..1。"""

    length = max(1, int(length))
    scale = max(1, int(scale))
    node_count = max(2, length // scale + 2)
    nodes = [rng.random() for _ in range(node_count)]
    values: list[float] = []
    for x in range(length):
        position = x / scale
        index = int(position)
        fraction = position - index
        eased = 0.5 - 0.5 * math.cos(fraction * math.pi)
        left = nodes[min(index, node_count - 1)]
        right = nodes[min(index + 1, node_count - 1)]
        values.append(left + (right - left) * eased)
    return values


def dither_row(draw, y: int, width: int, base: str, accent: str, *, threshold: int = 4) -> None:
    """在 y 行画 base，并按 Bayer 阈值撒 accent 像素。"""

    draw.line((0, y, width - 1, y), fill=base)
    for x in range(width):
        if bayer4(x, y) < threshold:
            draw.point((x, y), fill=accent)


def rough_band(draw, x0: int, y0: int, x1: int, y1: int, color: str, rng: random.Random, density: int = 12) -> None:
    """低密度 2×2 色块，避免纯色块看起来像 UI。"""

    draw.rectangle((x0, y0, x1, y1), fill=color)
    count = max(1, ((x1 - x0) * (y1 - y0)) // max(1, density * 220))
    for _ in range(count):
        x = rng.randint(x0, max(x0, x1 - 1))
        y = rng.randint(y0, max(y0, y1 - 1))
        draw.rectangle((x, y, min(x + 1, x1), min(y + 1, y1)), fill=color)
