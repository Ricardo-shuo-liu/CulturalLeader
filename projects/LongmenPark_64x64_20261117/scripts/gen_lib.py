"""Longmen Park pixel asset library.

All colors come from spec_lock.md (InkGongbi48). Hard edges only:
no anti-aliasing, no partial alpha, no gradient fills.
"""

from __future__ import annotations

import math
import random
import re
from pathlib import Path

from PIL import Image, ImageDraw

PROJECT = Path(__file__).resolve().parents[1]
ASSETS = PROJECT / "assets"
SPEC = PROJECT / "spec_lock.md"


def load_palette() -> list[str]:
    text = SPEC.read_text(encoding="utf-8")
    match = re.search(r"## palette\n(.*?)\n## style", text, re.S)
    if not match:
        raise RuntimeError("palette section not found in spec_lock.md")
    return re.findall(r"- (#[0-9a-fA-F]{6})", match.group(1))


HEXES = [h.upper() for h in load_palette()]


def C(hex_value: str) -> tuple[int, int, int, int]:
    h = hex_value.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


# Named aliases — every value must be one of the declared palette entries.
INK = C("#0e0f12")
INK2 = C("#1a1c20")
INK3 = C("#26282b")
INK4 = C("#33322f")
DARK_EARTH = C("#403b34")
EARTH_D = C("#4a4038")
EARTH = C("#5a4c3e")
EARTH_M = C("#6b5947")
EARTH_L = C("#7d6852")
OCHRE_D = C("#91785e")
OCHRE = C("#a68a68")
OCHRE_L = C("#bda077")
SAND = C("#d4ba90")
SAND_L = C("#e8d2ae")
CREAM = C("#f2e5c8")
GREEN_D = C("#24352c")
GREEN_DD = C("#2e4636")
GREEN = C("#3a5742")
GREEN_M = C("#48694e")
GREEN_L = C("#5b7f5c")
GREEN_P = C("#73966e")
GREEN_PL = C("#8fae82")
GREEN_PALE = C("#aac49a")
WATER_D = C("#1b2f38")
WATER_DD = C("#254452")
WATER = C("#315866")
WATER_M = C("#3f6e7a")
WATER_L = C("#54848c")
WATER_P = C("#6d9ba0")
WATER_PALE = C("#8bb4b0")
DUSK_D = C("#3d3350")
DUSK = C("#54405c")
DUSK_M = C("#744f5e")
DUSK_L = C("#96655f")
SUNSET_D = C("#b87a62")
SUNSET = C("#d18f67")
SUNSET_L = C("#e6a96f")
SUN_GOLD = C("#f4c27e")
SUN_LIGHT = C("#ffd9a0")
SUN_HI = C("#fff0cc")
SKIN = C("#e8c49c")
SKIN_D = C("#c99a72")
INDIGO = C("#3f6a8a")
INDIGO_D = C("#2e4d66")
VERMILION = C("#b5503f")
VERMILION_D = C("#8f3a30")
PACK = C("#7a5436")
PANTS = C("#2c3a4a")


def canvas(width: int, height: int) -> Image.Image:
    return Image.new("RGBA", (width, height), (0, 0, 0, 0))


def save(img: Image.Image, category: str, name: str) -> Path:
    folder = ASSETS / category
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{name}.png"
    img.save(path, "PNG")
    return path


def rect(d: ImageDraw.ImageDraw, x0: int, y0: int, x1: int, y1: int, color, outline=None) -> None:
    """Inclusive rectangle; optional 1px outline drawn outside the fill."""
    if outline is not None:
        d.rectangle([x0 - 1, y0 - 1, x1 + 1, y1 + 1], fill=outline)
    d.rectangle([x0, y0, x1, y1], fill=color)


def poly(d: ImageDraw.ImageDraw, points, color, outline=None) -> None:
    if outline is not None:
        d.polygon(points, fill=outline)
    d.polygon(points, fill=color)


def ellipse(d: ImageDraw.ImageDraw, x0: int, y0: int, x1: int, y1: int, color, outline=None) -> None:
    if outline is not None:
        d.ellipse([x0 - 1, y0 - 1, x1 + 1, y1 + 1], fill=outline)
    d.ellipse([x0, y0, x1, y1], fill=color)


def put(img: Image.Image, x: int, y: int, color) -> None:
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), color)


BAYER2 = ((0, 2), (3, 1))
BAYER4 = (
    (0, 8, 2, 10),
    (12, 4, 14, 6),
    (3, 11, 1, 9),
    (15, 7, 13, 5),
)


def dither_pick(x: int, y: int, threshold: float, matrix=BAYER4) -> bool:
    """Ordered dither: returns True when the second color should be used."""
    n = len(matrix)
    value = (matrix[y % n][x % n] + 0.5) / (n * n)
    return value < threshold


def value_noise(width: int, height: int, cells: int, seed: int, wrap: bool = True) -> list[list[float]]:
    """Low-frequency value noise with cosine interpolation (seamless when wrap=True)."""
    rng = random.Random(seed)
    grid_w = max(2, cells)
    grid_h = max(2, cells)
    nodes = [[rng.random() for _ in range(grid_w)] for _ in range(grid_h)]
    if wrap:
        for row in nodes:
            row[-1] = row[0]
        nodes[-1] = list(nodes[0])
    out = [[0.0] * width for _ in range(height)]
    for y in range(height):
        fy = (y / height) * (grid_h - 1)
        iy = int(fy)
        ty = fy - iy
        ty = ty * ty * (3 - 2 * ty)
        ny = min(iy + 1, grid_h - 1)
        for x in range(width):
            fx = (x / width) * (grid_w - 1)
            ix = int(fx)
            tx = fx - ix
            tx = tx * tx * (3 - 2 * tx)
            nx = min(ix + 1, grid_w - 1)
            a = nodes[iy][ix]
            b = nodes[iy][nx]
            c = nodes[ny][ix]
            d = nodes[ny][nx]
            out[y][x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
    return out


def combine_noise(a: list[list[float]], b: list[list[float]], weight: float = 0.5) -> list[list[float]]:
    return [[a[y][x] * (1 - weight) + b[y][x] * weight for x in range(len(a[0]))] for y in range(len(a))]


# ---------------------------------------------------------------------------
# Character
# ---------------------------------------------------------------------------

def draw_player(kind: str, frame: int) -> Image.Image:
    """64x64 side-view traveler facing right (left is a runtime mirror)."""
    img = canvas(64, 64)
    d = ImageDraw.Draw(img)

    if kind == "walk":
        leg_f = (3, 1, -2, -3, -1, 2)[frame]
        leg_b = (-3, -1, 2, 3, 1, -2)[frame]
        bob = (0, -1, -2, -1, 0, -1)[frame]
        arm = (-2, 0, 2, 2, 0, -2)[frame]
        scarf = (0, 1, 2, 1, 0, -1)[frame]
        lean = (0, 1, 1, 0, -1, 0)[frame]
    elif kind == "idle":
        leg_f = (0, 0, 0, 0)[frame]
        leg_b = (0, 0, 0, 0)[frame]
        bob = (0, -1, 0, 0)[frame]
        arm = (0, 0, 1, 0)[frame]
        scarf = (0, 1, 0, -1)[frame]
        lean = 0
    else:  # interact
        leg_f = (1, 1, 0, 0)[frame]
        leg_b = (-1, -1, 0, 0)[frame]
        bob = (0, -1, -1, 0)[frame]
        arm = (0, -3, -6, -3)[frame]
        scarf = (0, 1, 0, -1)[frame]
        lean = 0

    cx = 33 + lean
    base = 62 + bob

    # back arm (behind torso)
    ax = cx - 8
    ay = base - 26 + (2 if kind == "walk" else 0)
    rect(d, ax - 3, ay, ax + 1, ay + 11, INDIGO_D, INK)
    rect(d, ax - 3, ay + 10, ax + 1, ay + 14, SKIN_D, INK)

    # backpack
    pack_top = base - 29
    pack_bottom = base - 14
    poly(d, [
        (cx - 14, pack_bottom), (cx - 12, pack_top), (cx - 5, pack_top + 1),
        (cx - 3, pack_bottom),
    ], PACK, INK)
    rect(d, cx - 12, pack_top + 7, cx - 4, pack_top + 9, EARTH, INK)
    rect(d, cx - 11, pack_top + 2, cx - 7, pack_top + 4, OCHRE_D)
    rect(d, cx - 12, pack_bottom - 4, cx - 4, pack_bottom - 3, EARTH)

    # back leg
    bx = cx - 4 + leg_b
    rect(d, bx - 4, base - 11, bx, base - 2, PANTS, INK)
    rect(d, bx - 5, base - 2, bx + 1, base, DARK_EARTH, INK)

    # torso / coat (trapezoid)
    shoulder_y = base - 29
    hem_y = base - 12
    poly(d, [
        (cx - 8, hem_y), (cx - 7, shoulder_y + 1), (cx + 6, shoulder_y),
        (cx + 8, hem_y),
    ], INDIGO, INK)
    # coat shading
    poly(d, [
        (cx + 3, shoulder_y + 1), (cx + 6, shoulder_y), (cx + 8, hem_y),
        (cx + 4, hem_y),
    ], INDIGO_D)
    poly(d, [
        (cx - 7, shoulder_y + 1), (cx - 5, shoulder_y + 1), (cx - 5, hem_y - 2),
        (cx - 8, hem_y),
    ], WATER_L)
    # belt
    rect(d, cx - 7, hem_y - 4, cx + 7, hem_y - 3, EARTH, INK)
    rect(d, cx + 1, hem_y - 4, cx + 3, hem_y - 3, SAND)
    # strap
    d.line([(cx - 5, shoulder_y + 1), (cx + 4, hem_y - 1)], fill=EARTH, width=2)

    # front leg
    fx = cx + 2 + leg_f
    rect(d, fx - 3, base - 12, fx + 1, base - 2, PANTS, INK)
    rect(d, fx - 4, base - 2, fx + 3, base, DARK_EARTH, INK)
    rect(d, fx - 4, base, fx + 3, base, INK)

    # scarf tails (behind head, off to the left)
    tail_y = base - 29 + scarf
    poly(d, [
        (cx - 6, tail_y), (cx - 14, tail_y + 2), (cx - 17, tail_y + 5),
        (cx - 15, tail_y + 7), (cx - 6, tail_y + 5),
    ], VERMILION, INK)
    rect(d, cx - 13, tail_y + 2, cx - 9, tail_y + 3, VERMILION_D)

    # neck + scarf wrap
    rect(d, cx - 2, base - 34, cx + 2, base - 30, SKIN_D, INK)
    rect(d, cx - 7, base - 33, cx + 6, base - 29, VERMILION, INK)
    rect(d, cx - 5, base - 32, cx + 4, base - 31, VERMILION_D)

    # head
    head_y = base - 47
    ellipse(d, cx - 6, head_y, cx + 6, head_y + 14, SKIN, INK)
    # hair at the back
    poly(d, [
        (cx - 6, head_y + 2), (cx - 7, head_y + 9), (cx - 5, head_y + 13),
        (cx - 3, head_y + 9), (cx - 3, head_y + 2),
    ], INK2)
    # face shading
    rect(d, cx + 3, head_y + 4, cx + 6, head_y + 12, SKIN_D)
    # eye / brow
    rect(d, cx + 3, head_y + 6, cx + 4, head_y + 6, INK)
    rect(d, cx + 2, head_y + 4, cx + 5, head_y + 4, OCHRE_D)
    rect(d, cx + 2, head_y + 10, cx + 4, head_y + 10, VERMILION_D)
    # ear
    rect(d, cx - 4, head_y + 7, cx - 3, head_y + 9, SKIN_D)

    # straw hat
    rect(d, cx - 8, head_y - 2, cx + 7, head_y + 1, OCHRE_L, INK)
    poly(d, [
        (cx - 5, head_y - 2), (cx - 4, head_y - 7), (cx + 4, head_y - 7),
        (cx + 5, head_y - 2),
    ], OCHRE, INK)
    rect(d, cx - 4, head_y - 6, cx + 4, head_y - 6, SAND)
    rect(d, cx - 8, head_y + 1, cx + 7, head_y + 1, OCHRE_D)

    # front arm
    fx_arm = cx + 6
    fy_arm = base - 27 + arm
    rect(d, fx_arm, fy_arm, fx_arm + 4, fy_arm + 10, INDIGO, INK)
    rect(d, fx_arm + 3, fy_arm + 2, fx_arm + 4, fy_arm + 9, INDIGO_D)
    rect(d, fx_arm + 1, fy_arm + 11, fx_arm + 4, fy_arm + 13, SKIN, INK)
    if kind == "interact" and frame >= 1:
        # raised hand
        rect(d, fx_arm + 1, fy_arm - 3, fx_arm + 4, fy_arm - 1, SKIN, INK)

    return img


def build_character_sheets() -> None:
    animations = [
        ("player_idle", "idle", 4),
        ("player_walk", "walk", 6),
        ("player_interact", "interact", 4),
    ]
    for name, kind, frames in animations:
        images = []
        for i in range(frames):
            img = draw_player(kind, i)
            save(img, "characters", f"{name}_{i}")
            images.append(img)
        sheet = Image.new("RGBA", (64 * frames, 64), (0, 0, 0, 0))
        for i, img in enumerate(images):
            sheet.paste(img, (i * 64, 0))
        sheet.save(PROJECT / "sheets" / f"{name}_sheet.png", "PNG")
        print(f"[characters] {name}: {frames} frames")


if __name__ == "__main__":
    build_character_sheets()
