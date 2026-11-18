"""Tiles, props, UI and effects for Longmen Park."""

from __future__ import annotations

import math
import random

from PIL import Image, ImageDraw

from gen_lib import (
    ASSETS, PROJECT, canvas, save, rect, poly, ellipse, put,
    value_noise, dither_pick, C,
    INK, INK2, INK3, INK4, DARK_EARTH, EARTH_D, EARTH, EARTH_M, EARTH_L,
    OCHRE_D, OCHRE, OCHRE_L, SAND, SAND_L, CREAM,
    GREEN_D, GREEN_DD, GREEN, GREEN_M, GREEN_L, GREEN_P, GREEN_PL, GREEN_PALE,
    WATER_D, WATER_DD, WATER, WATER_M, WATER_L, WATER_P, WATER_PALE,
    DUSK_D, DUSK, DUSK_M, DUSK_L,
    SUNSET_D, SUNSET, SUNSET_L, SUN_GOLD, SUN_LIGHT, SUN_HI,
    VERMILION, VERMILION_D, PACK, PANTS, SKIN, SKIN_D,
)

# ---------------------------------------------------------------------------
# Tiles (64x64, seamless)
# ---------------------------------------------------------------------------

def tile_grass() -> Image.Image:
    img = canvas(64, 64)
    d = ImageDraw.Draw(img)
    n1 = value_noise(64, 64, 4, 101)
    n2 = value_noise(64, 64, 11, 102)
    rng = random.Random(103)
    palette = [GREEN_DD, GREEN, GREEN_M, GREEN_L, GREEN_P]
    for y in range(64):
        for x in range(64):
            v = n1[y][x] * 0.72 + n2[y][x] * 0.28
            idx = min(3, int(v * 4))
            if dither_pick(x, y, (v * 4) - idx):
                idx = min(4, idx + 1)
            put(img, x, y, palette[idx])
    # sparse blades (<= 1%)
    for _ in range(32):
        x = rng.randrange(64)
        y = rng.randrange(64)
        put(img, x, y, GREEN_P)
        put(img, x, y - 1, GREEN_PL)
    return img


def tile_path_stone(variant: int = 0) -> Image.Image:
    img = canvas(64, 64)
    n1 = value_noise(64, 64, 3, 201 + variant * 17)
    n2 = value_noise(64, 64, 8, 202 + variant * 23)
    n3 = value_noise(64, 64, 14, 204 + variant * 31)
    rng = random.Random(203 + variant * 41)
    palette = [EARTH_M, EARTH_L, OCHRE_D, SAND]
    for y in range(64):
        for x in range(64):
            v = n1[y][x] * 0.54 + n2[y][x] * 0.3 + n3[y][x] * 0.16
            idx = min(2, int(v * 4))
            if dither_pick(x, y, (v * 4) - idx):
                idx = min(3, idx + 1)
            if x < 2 or y < 2 or x > 61 or y > 61:
                idx = min(idx, 2)
            put(img, x, y, palette[idx])
    # a few short seams (feature density <= 1%)
    for _ in range(4):
        x = rng.randrange(6, 56)
        y = rng.randrange(6, 56)
        length = rng.randrange(8, 16)
        dx = rng.choice((-1, 0, 1))
        dy = rng.choice((0, 1))
        for _ in range(length):
            put(img, x, y, EARTH_D)
            x += dx
            y += dy
            if x < 0 or x > 63 or y > 63:
                break
    for _ in range(6):
        x = rng.randrange(64)
        y = rng.randrange(64)
        put(img, x, y, SAND)
        put(img, x + 1, y, OCHRE_D)
    return img


def tile_stone_wall() -> Image.Image:
    img = canvas(64, 64)
    d = ImageDraw.Draw(img)
    rng = random.Random(301)
    noise = value_noise(64, 64, 3, 302)
    d.rectangle([0, 0, 63, 63], fill=EARTH_D)
    row_y = 0
    while row_y < 64:
        height = rng.randrange(14, 19)
        x = -rng.randrange(0, 24)
        while x < 64:
            width = rng.randrange(24, 42)
            avg = noise[min(63, max(0, row_y + height // 2))][min(63, max(0, x + width // 2))]
            base = EARTH_M if avg < 0.42 else (EARTH_L if avg < 0.68 else OCHRE_D)
            d.rectangle([x + 1, row_y + 1, x + width - 2, row_y + height - 2], fill=base)
            if rng.random() > 0.45:
                d.line([(x + 2, row_y + 1), (x + width - 3, row_y + 1)], fill=OCHRE)
            if rng.random() > 0.6:
                d.line([(x + 2, row_y + height - 2), (x + width - 3, row_y + height - 2)], fill=EARTH)
            for _ in range(3):
                px = rng.randrange(x + 3, max(x + 4, x + width - 4))
                py = rng.randrange(row_y + 3, max(row_y + 4, row_y + height - 4))
                put(img, px, py, EARTH_D if rng.random() > 0.5 else OCHRE_D)
            x += width
        row_y += height
    # large-scale weathering
    for _ in range(120):
        px = rng.randrange(64)
        py = rng.randrange(64)
        put(img, px, py, EARTH_D if noise[py][px] < 0.4 else OCHRE_D)
    return img


# ---------------------------------------------------------------------------
# Props
# ---------------------------------------------------------------------------

def prop_pine() -> Image.Image:
    img = canvas(128, 192)
    d = ImageDraw.Draw(img)
    rng = random.Random(401)

    # trunk with a slight lean
    poly(d, [(60, 190), (62, 118), (68, 116), (70, 190)], PACK, INK)
    d.line([(64, 122), (64, 186)], fill=EARTH_M)
    for _ in range(10):
        put(img, rng.randrange(62, 69), rng.randrange(124, 188), EARTH)

    def tier(cx: int, cy: int, half_w: int, height: int, main, lit, dark) -> None:
        # jagged cloud-like pine tier: wide bottom, uneven top
        bottom = []
        for i in range(9):
            x = cx - half_w + round(i * (2 * half_w) / 8)
            y = cy + (0 if i % 2 == 0 else 3) + rng.randrange(-1, 2)
            bottom.append((x, y))
        top = []
        for i in range(9):
            x = cx + half_w - round(i * (2 * half_w) / 8)
            y = cy - height + (0 if i % 2 == 0 else 4) + rng.randrange(-1, 2)
            top.append((x, y))
        poly(d, top + bottom, main, INK)
        # lit left half
        lit_pts = [(cx - 2, cy - height + 2)]
        for i in range(5):
            x = cx - half_w + 4 + round(i * (half_w - 4) / 4)
            y = cy - height + 6 + (0 if i % 2 == 0 else 5)
            lit_pts.append((x, y))
        lit_pts += [(cx - half_w + 6, cy + 1), (cx, cy + 2)]
        poly(d, lit_pts, lit)
        # needle clusters
        for _ in range(46):
            px = rng.randrange(cx - half_w + 4, cx + half_w - 4)
            py = rng.randrange(cy - height + 4, cy + 2)
            put(img, px, py, rng.choice((lit, dark, GREEN_L)))
        d.line([(cx - half_w + 4, cy - 2), (cx + half_w - 4, cy - 2)], fill=dark)

    tier(64, 58, 34, 24, GREEN_DD, GREEN_M, GREEN_D)
    tier(50, 82, 30, 22, GREEN_DD, GREEN_M, GREEN_D)
    tier(80, 86, 30, 22, GREEN_DD, GREEN_M, GREEN_D)
    tier(64, 112, 40, 26, GREEN_DD, GREEN_L, GREEN)
    tier(44, 128, 26, 18, GREEN_DD, GREEN_M, GREEN_D)
    tier(84, 130, 26, 18, GREEN_DD, GREEN_M, GREEN_D)
    return img


def prop_willow() -> Image.Image:
    img = canvas(128, 192)
    d = ImageDraw.Draw(img)
    rng = random.Random(402)
    rect(d, 60, 120, 68, 190, PACK, INK)
    # crown
    ellipse(d, 30, 46, 98, 116, GREEN, INK)
    ellipse(d, 22, 62, 72, 110, GREEN_M)
    ellipse(d, 58, 54, 108, 104, GREEN_L)
    ellipse(d, 40, 40, 88, 86, GREEN_P)
    for _ in range(70):
        px = rng.randrange(30, 100)
        py = rng.randrange(46, 112)
        put(img, px, py, rng.choice((GREEN_L, GREEN_PL, GREEN_P)))
    # hanging branches
    for i in range(14):
        x = 26 + i * 6 + rng.randrange(-2, 3)
        length = rng.randrange(34, 74)
        for k in range(length):
            yy = 96 + k
            xx = x + int(2 * math.sin(k / 9 + i))
            put(img, xx, yy, GREEN_P if k % 3 else GREEN_PL)
            if k % 7 == 0:
                put(img, xx + 1, yy, GREEN_PL)
    return img


def prop_lamp() -> Image.Image:
    img = canvas(64, 128)
    d = ImageDraw.Draw(img)
    # base
    rect(d, 22, 118, 42, 126, EARTH_M, INK)
    rect(d, 26, 108, 38, 118, EARTH_L, INK)
    # post
    rect(d, 29, 58, 35, 108, EARTH_M, INK)
    rect(d, 31, 58, 32, 108, EARTH_L)
    # lamp housing
    rect(d, 18, 30, 46, 58, EARTH_L, INK)
    rect(d, 22, 34, 42, 52, SUN_LIGHT, INK)
    rect(d, 24, 36, 40, 50, SUN_HI)
    d.line([(32, 34), (32, 52)], fill=SAND)
    # roof
    poly(d, [(14, 30), (50, 30), (44, 20), (20, 20)], EARTH_D, INK)
    rect(d, 26, 14, 38, 20, EARTH, INK)
    rect(d, 30, 8, 34, 14, EARTH_D, INK)
    return img


def prop_bench() -> Image.Image:
    img = canvas(64, 64)
    d = ImageDraw.Draw(img)
    rect(d, 6, 40, 58, 43, PACK, INK)
    rect(d, 6, 33, 58, 36, OCHRE_D, INK)
    rect(d, 6, 26, 58, 29, EARTH_M, INK)
    rect(d, 10, 43, 13, 56, INK3, INK)
    rect(d, 51, 43, 54, 56, INK3, INK)
    rect(d, 8, 43, 12, 48, EARTH, INK)
    rect(d, 52, 43, 56, 48, EARTH, INK)
    return img


def prop_sign() -> Image.Image:
    img = canvas(64, 64)
    d = ImageDraw.Draw(img)
    rect(d, 30, 30, 34, 62, PACK, INK)
    rect(d, 8, 12, 56, 36, OCHRE_L, INK)
    rect(d, 11, 15, 53, 33, SAND)
    d.line([(16, 20), (40, 20)], fill=INK3)
    d.line([(16, 24), (48, 24)], fill=EARTH_M)
    d.line([(16, 28), (34, 28)], fill=EARTH_M)
    rect(d, 8, 36, 56, 38, OCHRE_D, INK)
    return img


def prop_bridge() -> Image.Image:
    img = canvas(512, 192)
    d = ImageDraw.Draw(img)
    rng = random.Random(405)

    # bridge body
    d.rectangle([8, 108, 504, 190], fill=EARTH_M, outline=INK)
    # stone courses
    row_y = 110
    while row_y < 190:
        x = 8 - rng.randrange(0, 20)
        while x < 504:
            width = rng.randrange(20, 34)
            shade = rng.choice((EARTH, EARTH_M, EARTH_L, OCHRE_D))
            x0 = max(8, x + 1)
            x1 = min(504, x + width - 2)
            if x1 > x0:
                d.rectangle([x0, row_y + 1, x1, row_y + 10], fill=shade)
                d.line([(x0, row_y + 1), (x1, row_y + 1)], fill=OCHRE)
            x += width
        row_y += 12

    # deck
    poly(d, [(8, 100), (86, 54), (426, 54), (504, 100), (504, 110), (8, 110)], EARTH_M, INK)
    d.line([(12, 101), (88, 58)], fill=OCHRE_L, width=2)
    d.line([(424, 58), (500, 101)], fill=OCHRE_L, width=2)
    d.line([(18, 106), (494, 106)], fill=EARTH_D, width=2)
    d.line([(30, 92), (482, 92)], fill=EARTH_D)

    # railings
    for x in range(32, 486, 28):
        top = 58 if 90 < x < 422 else 64
        d.rectangle([x, top - 18, x + 5, top + 22], fill=OCHRE_L, outline=INK)
        d.rectangle([x + 1, top - 17, x + 3, top + 21], fill=SAND)
    d.line([(24, 66), (488, 66)], fill=OCHRE_D, width=3)
    d.line([(26, 48), (486, 48)], fill=OCHRE, width=3)

    # arches (cut transparent half-circles through the body)
    mask = Image.new("L", (512, 192), 255)
    md = ImageDraw.Draw(mask)
    for ax in (160, 352):
        md.ellipse([ax - 62, 104, ax + 62, 228], fill=0)
        md.rectangle([ax - 62, 166, ax + 62, 192], fill=0)
    img.putalpha(Image.composite(img.getchannel("A"), Image.new("L", img.size, 0), mask))

    # voussoir ring around each arch
    for ax in (160, 352):
        d.arc([ax - 64, 102, ax + 64, 230], 180, 360, fill=OCHRE_L, width=3)
        d.arc([ax - 58, 108, ax + 58, 224], 180, 360, fill=OCHRE, width=2)
    return img


def prop_gate() -> Image.Image:
    img = canvas(192, 256)
    d = ImageDraw.Draw(img)
    # steps
    for i in range(3):
        rect(d, 20 + i * 6, 226 - i * 8, 172 - i * 6, 238 - i * 8, EARTH_L if i % 2 else EARTH_M, INK)
    # pillars
    rect(d, 38, 96, 54, 226, VERMILION_D, INK)
    rect(d, 138, 96, 154, 226, VERMILION_D, INK)
    rect(d, 41, 100, 45, 220, VERMILION)
    rect(d, 141, 100, 145, 220, VERMILION)
    # beams
    rect(d, 24, 78, 168, 96, VERMILION_D, INK)
    rect(d, 28, 82, 164, 90, VERMILION)
    # plaque
    rect(d, 72, 92, 120, 118, OCHRE_L, INK)
    rect(d, 76, 96, 116, 114, SAND)
    d.line([(84, 104), (108, 104)], fill=VERMILION_D, width=2)
    d.line([(84, 109), (100, 109)], fill=EARTH_D, width=2)
    # roof (two tiers)
    poly(d, [(10, 78), (182, 78), (156, 52), (36, 52)], INK3, INK)
    poly(d, [(20, 54), (172, 54), (150, 40), (42, 40)], INK2, INK)
    poly(d, [(28, 44), (164, 44), (146, 26), (46, 26)], INK3, INK)
    rect(d, 46, 22, 146, 28, INK2, INK)
    # roof highlights
    d.line([(30, 50), (162, 50)], fill=EARTH_M)
    d.line([(46, 34), (146, 34)], fill=EARTH_M)
    # railings / lattice
    for i in range(4):
        rect(d, 58 + i * 20, 126, 62 + i * 20, 166, OCHRE_D, INK)
    return img


def prop_moon_gate() -> Image.Image:
    img = canvas(128, 192)
    d = ImageDraw.Draw(img)
    # wall
    rect(d, 8, 74, 120, 186, EARTH_M, INK)
    rect(d, 12, 78, 116, 182, EARTH_L)
    # wall stone joints
    for yy in range(92, 182, 16):
        d.line([(12, yy), (116, yy)], fill=EARTH_D)
    # roof
    poly(d, [(2, 74), (126, 74), (104, 52), (24, 52)], INK3, INK)
    poly(d, [(18, 54), (110, 54), (96, 40), (32, 40)], INK2, INK)
    rect(d, 32, 36, 96, 42, INK3, INK)
    d.line([(24, 66), (104, 66)], fill=EARTH_M)
    # moon opening (transparent)
    mask = Image.new("L", (128, 192), 255)
    md = ImageDraw.Draw(mask)
    md.ellipse([30, 92, 98, 160], fill=0)
    md.rectangle([30, 126, 98, 186], fill=0)
    img.putalpha(Image.composite(img.getchannel("A"), Image.new("L", img.size, 0), mask))
    # rim highlight around opening
    d.arc([28, 90, 100, 162], 180, 360, fill=CREAM)
    d.line([(28, 126), (28, 186)], fill=CREAM)
    d.line([(100, 126), (100, 186)], fill=CREAM)
    # bamboo on the right
    for i in range(5):
        x = 106 + i * 4
        d.line([(x, 96), (x + 2, 150)], fill=GREEN_M if i % 2 else GREEN_L)
        for k in range(4):
            d.line([(x + 1, 106 + k * 10), (x + 6, 102 + k * 10)], fill=GREEN_P)
    return img


def prop_railing() -> Image.Image:
    img = canvas(64, 64)
    d = ImageDraw.Draw(img)
    # tileable: post at x=8, rails span full width
    rect(d, 0, 24, 63, 27, OCHRE, INK)
    rect(d, 0, 32, 63, 35, EARTH_L, INK)
    rect(d, 6, 16, 14, 56, OCHRE, INK)
    rect(d, 8, 16, 12, 56, OCHRE_L)
    rect(d, 5, 14, 15, 18, OCHRE_D, INK)
    rect(d, 0, 27, 63, 27, OCHRE_L)
    return img


def prop_stone_step() -> Image.Image:
    img = canvas(128, 64)
    d = ImageDraw.Draw(img)
    for i in range(4):
        y = 16 + i * 12
        rect(d, i * 4, y, 127 - i * 4, y + 12, EARTH_L if i % 2 else EARTH_M, INK)
        rect(d, i * 4 + 2, y + 2, 125 - i * 4, y + 3, SAND)
    return img


# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------

def ui_panel() -> Image.Image:
    img = canvas(48, 48)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 47, 47], fill=INK)
    d.rectangle([1, 1, 46, 46], fill=INK2)
    d.rectangle([2, 2, 45, 45], outline=OCHRE_L)
    # corner accents
    for (x, y) in ((2, 2), (43, 2), (2, 43), (43, 43)):
        d.rectangle([x, y, x + 2, y + 2], fill=SAND)
    return img


def _icon_box() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = canvas(16, 16)
    return img, ImageDraw.Draw(img)


def ui_icons() -> list[tuple[str, Image.Image]]:
    icons = []

    img, d = _icon_box()
    d.arc([1, 4, 14, 16], 180, 360, fill=OCHRE_L)
    d.line([(1, 10), (14, 10)], fill=SAND)
    d.line([(2, 12), (13, 12)], fill=OCHRE)
    d.line([(4, 7), (4, 10)], fill=OCHRE_L)
    d.line([(7, 7), (7, 10)], fill=OCHRE_L)
    d.line([(10, 7), (10, 10)], fill=OCHRE_L)
    icons.append(("ui_icon_bridge", img))

    img, d = _icon_box()
    d.ellipse([4, 1, 12, 9], outline=SUN_GOLD)
    d.ellipse([5, 2, 11, 8], outline=SUN_LIGHT)
    d.rectangle([6, 6, 10, 13], fill=SUN_GOLD)
    d.rectangle([4, 13, 12, 15], fill=OCHRE_L)
    d.point((7, 4), fill=INK)
    d.point((9, 4), fill=INK)
    icons.append(("ui_icon_buddha", img))

    img, d = _icon_box()
    d.arc([2, 2, 14, 14], 180, 360, fill=EARTH_L)
    d.rectangle([2, 8, 14, 15], fill=EARTH_M)
    d.ellipse([5, 7, 11, 13], fill=INK)
    d.rectangle([6, 9, 10, 14], fill=SUN_GOLD)
    d.ellipse([7, 8, 9, 10], fill=SUN_LIGHT)
    icons.append(("ui_icon_cave", img))

    img, d = _icon_box()
    d.polygon([(2, 7), (8, 2), (14, 7)], fill=INK3)
    d.rectangle([4, 7, 12, 14], fill=VERMILION_D)
    d.rectangle([5, 8, 7, 14], fill=VERMILION)
    d.rectangle([9, 8, 11, 14], fill=VERMILION)
    d.rectangle([3, 6, 13, 7], fill=OCHRE_L)
    icons.append(("ui_icon_temple", img))

    img, d = _icon_box()
    d.ellipse([2, 2, 14, 14], fill=EARTH_L)
    d.ellipse([5, 5, 11, 11], fill=INK)
    d.rectangle([5, 8, 11, 14], fill=INK)
    d.line([(2, 14), (14, 14)], fill=GREEN_M)
    d.line([(12, 3), (14, 8)], fill=GREEN_L)
    icons.append(("ui_icon_garden", img))

    return icons


def ui_stamp() -> Image.Image:
    img = canvas(24, 24)
    d = ImageDraw.Draw(img)
    d.rectangle([1, 1, 22, 22], outline=VERMILION)
    d.rectangle([3, 3, 20, 20], outline=VERMILION_D)
    # simplified seal character
    d.line([(8, 8), (8, 16)], fill=VERMILION)
    d.line([(8, 8), (15, 8)], fill=VERMILION)
    d.line([(8, 12), (13, 12)], fill=VERMILION)
    d.line([(11, 8), (11, 16)], fill=VERMILION)
    d.line([(8, 16), (15, 16)], fill=VERMILION)
    return img


# ---------------------------------------------------------------------------
# Effects
# ---------------------------------------------------------------------------

def fx_glow() -> Image.Image:
    img = canvas(64, 64)
    rings = [
        (30, SUNSET_D), (25, SUNSET), (20, SUNSET_L),
        (15, SUN_GOLD), (10, SUN_LIGHT), (5, SUN_HI),
    ]
    cx = cy = 32
    for radius, color in rings:
        for y in range(64):
            for x in range(64):
                if (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius:
                    put(img, x, y, color)
    return img


def fx_petal() -> Image.Image:
    img = canvas(8, 8)
    d = ImageDraw.Draw(img)
    d.polygon([(4, 1), (7, 4), (4, 7), (1, 4)], fill=SUNSET_L)
    d.point((3, 3), fill=SUN_GOLD)
    d.point((4, 4), fill=VERMILION)
    return img


def fx_ripple() -> Image.Image:
    img = canvas(32, 16)
    d = ImageDraw.Draw(img)
    d.arc([2, 2, 30, 14], 200, 340, fill=WATER_PALE)
    d.arc([6, 5, 26, 13], 200, 340, fill=WATER_P)
    d.arc([10, 8, 22, 12], 200, 340, fill=WATER_PALE)
    return img


def fx_bird() -> Image.Image:
    img = canvas(16, 8)
    d = ImageDraw.Draw(img)
    d.line([(1, 4), (6, 1)], fill=INK)
    d.line([(6, 1), (8, 4)], fill=INK)
    d.line([(8, 4), (10, 1)], fill=INK)
    d.line([(10, 1), (15, 4)], fill=INK)
    return img


# ---------------------------------------------------------------------------

def main() -> None:
    for name, img in (
        ("tile_path_stone", tile_path_stone(0)),
        ("tile_path_stone_02", tile_path_stone(1)),
        ("tile_path_stone_03", tile_path_stone(2)),
        ("tile_grass", tile_grass()),
        ("tile_stone_wall", tile_stone_wall()),
    ):
        save(img, "tiles", name)
        print("[tiles]", name)

    for name, img in (
        ("prop_pine_01", prop_pine()),
        ("prop_willow_01", prop_willow()),
        ("prop_lamp", prop_lamp()),
        ("prop_bench", prop_bench()),
        ("prop_sign", prop_sign()),
        ("prop_bridge", prop_bridge()),
        ("prop_gate", prop_gate()),
        ("prop_moon_gate", prop_moon_gate()),
        ("prop_railing", prop_railing()),
        ("prop_stone_step", prop_stone_step()),
    ):
        save(img, "items", name)
        print("[items]", name)

    save(ui_panel(), "ui", "ui_panel_9slice")
    for name, img in ui_icons():
        save(img, "ui", name)
    save(ui_stamp(), "ui", "ui_stamp")
    print("[ui] panel + icons + stamp")

    for name, img in (
        ("fx_glow", fx_glow()),
        ("fx_petal", fx_petal()),
        ("fx_ripple", fx_ripple()),
        ("fx_bird", fx_bird()),
    ):
        save(img, "effects", name)
        print("[effects]", name)


if __name__ == "__main__":
    main()
