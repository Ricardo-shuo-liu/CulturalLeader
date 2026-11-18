"""Background parallax layers for Longmen Park (960x540 viewport)."""

from __future__ import annotations

import math
import random

from PIL import Image, ImageDraw

from gen_lib import (
    PROJECT, canvas, save, rect, poly, ellipse, put,
    value_noise, dither_pick, BAYER4,
    INK, INK2, INK3, INK4, DARK_EARTH, EARTH_D, EARTH, EARTH_M, EARTH_L,
    OCHRE_D, OCHRE, OCHRE_L, SAND, SAND_L, CREAM,
    GREEN_D, GREEN_DD, GREEN, GREEN_M, GREEN_L, GREEN_P, GREEN_PL, GREEN_PALE,
    WATER_D, WATER_DD, WATER, WATER_M, WATER_L, WATER_P, WATER_PALE,
    DUSK_D, DUSK, DUSK_M, DUSK_L,
    SUNSET_D, SUNSET, SUNSET_L, SUN_GOLD, SUN_LIGHT, SUN_HI,
    VERMILION_D,
)

W_VIEW = 960
H_LAYER = 576
WATER_TOP = 300
WATER_BOTTOM = 440
SHORE_Y = 380
WALK_TOP = 425
WALK_BOTTOM = 515
GRASS_TOP = 515


# ---------------------------------------------------------------------------
# Sky
# ---------------------------------------------------------------------------

def bg_sky() -> Image.Image:
    img = canvas(960, H_LAYER)
    d = ImageDraw.Draw(img)
    rng = random.Random(501)

    # banded dusk gradient with ordered dithering
    stops = [
        (0.00, DUSK_D), (0.16, DUSK), (0.32, DUSK_M), (0.47, DUSK_L),
        (0.60, SUNSET_D), (0.71, SUNSET), (0.81, SUNSET_L), (0.90, SUN_GOLD),
        (0.97, SUN_LIGHT),
    ]
    for y in range(0, 280):
        t = y / 280
        idx = 0
        while idx < len(stops) - 2 and stops[idx + 1][0] < t:
            idx += 1
        t0, c0 = stops[idx]
        t1, c1 = stops[idx + 1]
        span = max(1e-6, t1 - t0)
        local = (t - t0) / span
        color = c1 if dither_pick(0, y, local, BAYER4) else c0
        d.line([(0, y), (959, y)], fill=color)

    # sun with dithered halo
    sun_x, sun_y = 700, 118
    for y in range(36, 210):
        for x in range(610, 800):
            dx = x - sun_x
            dy = y - sun_y
            dist = math.hypot(dx, dy * 1.05)
            if dist < 22:
                put(img, x, y, SUN_HI)
            elif dist < 27:
                put(img, x, y, SUN_LIGHT)
            elif dist < 34:
                put(img, x, y, SUN_GOLD)
            elif dist < 48 and dither_pick(x, y, 1 - (dist - 34) / 14):
                put(img, x, y, SUN_GOLD)
            elif dist < 70 and dither_pick(x, y, 1 - (dist - 48) / 22):
                put(img, x, y, SUNSET_L)

    # clouds: horizontal wisps with dithered edges
    def cloud(cx: int, cy: int, width: int, height: int) -> None:
        parts = [
            (cx, cy, int(width * 0.52), height),
            (cx - int(width * 0.28), cy + int(height * 0.22), int(width * 0.38), int(height * 0.7)),
            (cx + int(width * 0.30), cy + int(height * 0.18), int(width * 0.42), int(height * 0.75)),
        ]
        for px, py, rw, rh in parts:
            d.ellipse([px - rw // 2, py - rh // 2, px + rw // 2, py + rh // 2], fill=SUNSET_L)
        for px, py, rw, rh in parts:
            d.ellipse([px - rw // 2 + 4, py - rh // 2 + 4, px + rw // 2 - 4, py + rh // 2 - 2], fill=SUN_GOLD)
        # soft underside
        for px, py, rw, rh in parts:
            d.ellipse([px - rw // 2 + 6, py + rh // 4, px + rw // 2 - 6, py + rh // 2], fill=SUNSET)

    cloud(170, 52, 180, 18)
    cloud(430, 88, 140, 14)
    cloud(790, 46, 160, 16)
    cloud(890, 106, 110, 12)

    # horizon haze
    for y in range(230, 280):
        for x in range(960):
            if dither_pick(x, y, (y - 230) / 50 * 0.5):
                put(img, x, y, SAND_L)
    return img


# ---------------------------------------------------------------------------
# Far hills
# ---------------------------------------------------------------------------

def bg_far_hills() -> Image.Image:
    img = canvas(1280, H_LAYER)
    d = ImageDraw.Draw(img)
    rng = random.Random(601)

    def ridge(base_y: int, amplitude: int, color_top, color_bottom, alpha_band: int) -> None:
        pts = [(0, base_y)]
        y = base_y
        for x in range(0, 1281, 24):
            y += rng.randrange(-amplitude, amplitude + 1)
            y = max(base_y - amplitude * 6, min(base_y + amplitude * 3, y))
            pts.append((x, y))
        pts += [(1280, H_LAYER), (0, H_LAYER)]
        poly(d, pts, color_bottom, INK2)
        # color banding inside the silhouette
        for yy in range(base_y - amplitude * 6, H_LAYER):
            t = (yy - (base_y - amplitude * 6)) / max(1, H_LAYER - (base_y - amplitude * 6))
            color = color_top if t < 0.45 else color_bottom
            d.line([(0, yy), (1279, yy)], fill=color)
        # dithered ridge edge
        for i in range(len(pts) - 2):
            x0, y0 = pts[i]
            x1, y1 = pts[i + 1]
            for x in range(x0, x1):
                t = (x - x0) / max(1, x1 - x0)
                yy = int(y0 + (y1 - y0) * t)
                for k in range(alpha_band):
                    if dither_pick(x, yy + k, 0.5 - k * 0.2):
                        put(img, x, yy + k, color_top)

    # back ridge
    ridge(110, 4, DUSK_D, DUSK_D, 3)
    # front ridge
    ridge(132, 3, DUSK, DUSK_M, 4)
    return img


# ---------------------------------------------------------------------------
# Cliff with grottoes
# ---------------------------------------------------------------------------

def draw_niche(d: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, glow: float) -> None:
    r = w // 2
    # stone frame
    d.pieslice([x - r - 3, y - 3, x + r + 3, y + h + 3], 180, 360, fill=OCHRE_D)
    d.rectangle([x - r - 3, y + h // 2, x + r + 3, y + h + 3], fill=OCHRE_D)
    # cavity
    d.pieslice([x - r, y, x + r, y + h], 180, 360, fill=INK2)
    d.rectangle([x - r, y + h // 2, x + r, y + h], fill=INK2)
    # small buddha
    bh = int(h * 0.62)
    bw = max(4, int(w * 0.34))
    base = y + h
    halo = OCHRE if glow > 0.5 else OCHRE_D
    d.ellipse([x - bw, base - bh - 4, x + bw, base - bh + 4], fill=halo)
    d.rectangle([x - bw // 2, base - bh, x + bw // 2, base - 2], fill=OCHRE_L)
    d.rectangle([x - 2, base - bh - 2, x + 2, base - bh + 1], fill=SAND)
    d.rectangle([x - bw // 2 - 1, base - 3, x + bw // 2 + 1, base], fill=OCHRE_D)


def bg_cliff() -> Image.Image:
    img = canvas(2112, H_LAYER)
    d = ImageDraw.Draw(img)
    rng = random.Random(701)

    # ridge line
    ridge = []
    y = 104
    for x in range(0, 2113, 24):
        y += rng.randrange(-7, 8)
        y = max(150, min(215, y))
        if abs(x - 890) < 160:
            y = min(y, 158)
        ridge.append((x, y))

    body = ridge + [(2112, WATER_TOP + 100), (0, WATER_TOP + 100)]
    poly(d, body, EARTH_M, INK2)

    # vertical rock gradient
    for yy in range(140, WATER_TOP + 100):
        t = (yy - 140) / (WATER_TOP + 100 - 140)
        if t < 0.22:
            color = OCHRE_D
        elif t < 0.45:
            color = EARTH_M
        elif t < 0.7:
            color = EARTH
        elif t < 0.9:
            color = EARTH_D
        else:
            color = DARK_EARTH
        # horizontal bands only inside the silhouette (masked by alpha)
        d.line([(0, yy), (2111, yy)], fill=color)

    # keep only pixels inside the rock silhouette: rebuild alpha using a mask
    mask = Image.new("L", (2112, H_LAYER), 0)
    md = ImageDraw.Draw(mask)
    md.polygon(body, fill=255)
    solid = Image.new("RGBA", (2112, H_LAYER), (0, 0, 0, 0))
    solid.paste(img, (0, 0), mask)
    img = solid
    d = ImageDraw.Draw(img)

    # large rock shading blobs
    for _ in range(90):
        x = rng.randrange(0, 2112)
        yy = rng.randrange(100, WATER_TOP + 20)
        bw = rng.randrange(16, 64)
        bh = rng.randrange(10, 36)
        color = OCHRE_D if rng.random() > 0.5 else EARTH_D
        d.rectangle([x, yy, min(2111, x + bw), min(WATER_TOP + 39, yy + bh)], fill=color)

    # horizontal strata
    strata_y = 120
    while strata_y < WATER_TOP + 30:
        points = []
        x = 0
        while x < 2112:
            points.append((x, strata_y + rng.randrange(-3, 4)))
            x += rng.randrange(28, 60)
        d.line(points, fill=EARTH_D, width=1)
        strata_y += rng.randrange(16, 28)

    # random cracks
    for _ in range(110):
        x = rng.randrange(0, 2112)
        yy = rng.randrange(90, WATER_TOP)
        length = rng.randrange(8, 28)
        dx = rng.choice((-1, 0, 0, 1))
        for _ in range(length):
            put(img, x, yy, DARK_EARTH)
            x += dx
            yy += 1
            if yy > WATER_TOP + 20:
                break

    # chisel marks
    for _ in range(2600):
        x = rng.randrange(0, 2112)
        yy = rng.randrange(80, WATER_TOP + 20)
        put(img, x, yy, OCHRE_D if rng.random() > 0.5 else EARTH_D)

    # vegetation on the ridge
    for _ in range(520):
        x = rng.randrange(0, 2112)
        ry = None
        for i in range(len(ridge) - 1):
            if ridge[i][0] <= x <= ridge[i + 1][0]:
                t = (x - ridge[i][0]) / max(1, ridge[i + 1][0] - ridge[i][0])
                ry = int(ridge[i][1] + (ridge[i + 1][1] - ridge[i][1]) * t)
                break
        if ry is None:
            continue
        yy = ry - 3 + rng.randrange(0, 8)
        bw = rng.randrange(2, 6)
        bh = rng.randrange(3, 10)
        d.rectangle([x, yy, x + bw, yy + bh], fill=GREEN_DD if rng.random() > 0.5 else GREEN_D)

    # niches grouped by cave area
    groups = [
        (60, 250, 16, 10, 22, 180, 336),    # 潜溪寺
        (300, 470, 4, 28, 46, 190, 318),    # 宾阳三洞
        (520, 760, 26, 8, 16, 170, 336),    # 摩崖小龛
        (1050, 1360, 40, 6, 12, 170, 338),  # 万佛洞
        (1400, 1640, 22, 8, 18, 180, 334),  # 古阳洞
        (1690, 1950, 14, 10, 24, 186, 326), # 看经寺
    ]
    for gx0, gx1, count, wmin, wmax, ymin, ymax in groups:
        for _ in range(count):
            x = rng.randrange(gx0, gx1)
            w = rng.randrange(wmin, wmax)
            h = int(w * 1.3)
            yy = rng.randrange(ymin, ymax - h)
            draw_niche(d, x, yy, w, h, rng.random())

    # Fengxian temple: giant niche and Buddha
    fx = 890
    base = 340
    fw = 168
    fh = 186
    top = base - fh
    d.pieslice([fx - fw // 2 - 10, top - 10, fx + fw // 2 + 10, top + fw + 10], 180, 360, fill=OCHRE_D)
    d.rectangle([fx - fw // 2 - 10, top + fw // 2, fx + fw // 2 + 10, base], fill=OCHRE_D)
    d.pieslice([fx - fw // 2, top, fx + fw // 2, top + fw], 180, 360, fill=INK4)
    d.rectangle([fx - fw // 2, top + fw // 2, fx + fw // 2, base], fill=INK4)
    for yy in range(top + 16, base):
        t = (yy - top) / fh
        if dither_pick(0, yy, 0.3 * (1 - t)):
            d.line([(fx - fw // 2 + 6, yy), (fx + fw // 2 - 6, yy)], fill=INK3)

    # halo
    halo_y = base - 100
    for radius, color in ((44, OCHRE_D), (38, OCHRE), (32, SUN_GOLD), (25, SUNSET_L)):
        d.ellipse([fx - radius, halo_y - radius, fx + radius, halo_y + radius], outline=color, width=2)
    for i in range(20):
        ang = i / 20 * math.pi * 2
        d.line([
            (fx + math.cos(ang) * 44, halo_y + math.sin(ang) * 44),
            (fx + math.cos(ang) * 52, halo_y + math.sin(ang) * 52),
        ], fill=OCHRE_L)

    # head
    d.rectangle([fx - 16, base - 118, fx + 16, base - 96], fill=SAND_L)
    d.rectangle([fx - 17, base - 124, fx + 17, base - 118], fill=OCHRE_L)
    d.rectangle([fx - 12, base - 128, fx + 12, base - 124], fill=OCHRE_D)
    d.rectangle([fx - 9, base - 112, fx - 6, base - 109], fill=EARTH_D)
    d.rectangle([fx + 6, base - 112, fx + 9, base - 109], fill=EARTH_D)
    d.rectangle([fx - 1, base - 108, fx + 1, base - 104], fill=OCHRE_D)   # nose
    d.rectangle([fx - 5, base - 103, fx + 5, base - 102], fill=VERMILION_D)  # mouth
    d.rectangle([fx - 14, base - 99, fx + 14, base - 98], fill=OCHRE_D)    # chin shadow
    d.rectangle([fx - 12, base - 116, fx - 8, base - 115], fill=SAND_L)    # brow light
    d.rectangle([fx - 20, base - 114, fx - 16, base - 104], fill=OCHRE)
    d.rectangle([fx + 16, base - 114, fx + 20, base - 104], fill=OCHRE)
    # neck + shoulders
    d.rectangle([fx - 6, base - 96, fx + 6, base - 90], fill=OCHRE)
    d.polygon([
        (fx - 20, base - 30), (fx - 16, base - 92),
        (fx + 16, base - 92), (fx + 20, base - 30),
    ], fill=SAND)
    for k in range(6):
        d.line([(fx - 16 + k, base - 40 - k * 9), (fx + 16 - k, base - 40 - k * 9)], fill=OCHRE_D)
    d.rectangle([fx - 7, base - 66, fx + 7, base - 52], fill=OCHRE_L)
    # lap + lotus seat
    d.polygon([(fx - 34, base - 14), (fx - 24, base - 38), (fx + 24, base - 38), (fx + 34, base - 14)], fill=SAND)
    d.line([(fx - 26, base - 22), (fx + 26, base - 22)], fill=OCHRE_D)
    d.rectangle([fx - 40, base - 14, fx + 40, base - 6], fill=OCHRE_L)
    d.rectangle([fx - 36, base - 6, fx + 36, base + 2], fill=EARTH_M)
    d.line([(fx - 40, base - 10), (fx + 40, base - 10)], fill=OCHRE_D)

    # attendants
    for dx, hh in ((-58, 50), (-46, 42), (46, 42), (58, 50)):
        ax = fx + dx
        d.pieslice([ax - 9, base - hh - 16, ax + 9, base - hh + 2], 180, 360, fill=OCHRE_D)
        d.rectangle([ax - 6, base - hh, ax + 6, base - 10], fill=OCHRE)
        d.rectangle([ax - 4, base - hh - 6, ax + 4, base - hh], fill=SAND_L)
        d.rectangle([ax - 8, base - 10, ax + 8, base - 4], fill=OCHRE_D)

    d.rectangle([fx - fw // 2 - 14, base + 2, fx + fw // 2 + 14, base + 10], fill=EARTH_D)

    # keep everything strictly inside the rock silhouette
    final = Image.new("RGBA", (2112, H_LAYER), (0, 0, 0, 0))
    final.paste(img, (0, 0), mask)
    return final


# ---------------------------------------------------------------------------
# River
# ---------------------------------------------------------------------------

def bg_river() -> Image.Image:
    img = canvas(2560, H_LAYER)
    d = ImageDraw.Draw(img)
    rng = random.Random(801)

    # water body with vertical banding (far water darker)
    bands = [
        (WATER_TOP, WATER_DD), (WATER_TOP + 24, WATER_D),
        (WATER_TOP + 52, WATER), (WATER_TOP + 82, WATER_M),
        (WATER_TOP + 108, WATER_L), (WATER_BOTTOM - 8, WATER_M),
    ]
    for i in range(len(bands) - 1):
        y0, c0 = bands[i]
        y1, c1 = bands[i + 1]
        for yy in range(y0, y1):
            t = (yy - y0) / max(1, y1 - y0)
            for x in range(0, 2560, 4):
                local = min(1, max(0, t + ((x * 13 + yy * 7) % 9 - 4) / 26))
                color = c1 if dither_pick(x, yy, local, BAYER4) else c0
                d.line([(x, yy), (x + 3, yy)], fill=color)

    # far-bank waterline
    d.line([(0, WATER_TOP), (2559, WATER_TOP)], fill=SAND_L)
    d.line([(0, WATER_TOP + 1), (2559, WATER_TOP + 1)], fill=OCHRE_L)

    # cliff reflections: horizontal broken dashes near the far bank
    for i in range(240):
        x = rng.randrange(0, 2560)
        yy = WATER_TOP + rng.randrange(2, 54)
        width = rng.randrange(4, 18)
        color = OCHRE_D if rng.random() > 0.5 else EARTH_D
        d.rectangle([x, yy, min(2559, x + width), yy], fill=color)

    # sun reflection column
    sx = 700
    for i in range(70):
        yy = WATER_TOP + 6 + i * 2
        width = 18 + rng.randrange(-6, 7)
        d.rectangle([sx - width // 2 + rng.randrange(-6, 7), yy, sx + width // 2, yy], fill=SUNSET_L if i % 3 else SUN_GOLD)

    # static glints
    for _ in range(160):
        x = rng.randrange(0, 2560)
        yy = WATER_TOP + rng.randrange(6, 130)
        d.rectangle([x, yy, x + rng.randrange(2, 6), yy], fill=WATER_PALE if rng.random() > 0.4 else SUNSET_L)

    # near-bank shallow light
    for yy in range(WATER_BOTTOM - 26, WATER_BOTTOM):
        if dither_pick(0, yy, (yy - (WATER_BOTTOM - 26)) / 26 * 0.4):
            d.line([(0, yy), (2559, yy)], fill=WATER_PALE)
    return img


# ---------------------------------------------------------------------------
# Promenade
# ---------------------------------------------------------------------------

def bg_promenade() -> Image.Image:
    img = canvas(3200, H_LAYER)
    d = ImageDraw.Draw(img)
    rng = random.Random(901)

    # stone embankment (3 coursess)
    d.rectangle([0, SHORE_Y - 8, 3199, WALK_TOP - 1], fill=EARTH_M)
    row_y = SHORE_Y - 8
    row = 0
    while row_y < WALK_TOP - 8:
        row_height = rng.randrange(14, 22)
        x = -rng.randrange(0, 30)
        while x < 3200:
            width = rng.randrange(38, 78)
            shade = rng.choice((EARTH, EARTH_M, EARTH_L, OCHRE_D))
            x0 = max(0, x + 1)
            x1 = min(3199, x + width - 2)
            if x1 > x0:
                d.rectangle([x0, row_y + 1, x1, row_y + row_height - 2], fill=shade)
                d.line([(x0, row_y + 1), (x1, row_y + 1)], fill=OCHRE)
                d.line([(x0, row_y + row_height - 2), (x1, row_y + row_height - 2)], fill=EARTH_D)
            x += width
        row_y += row_height
        row += 1
    # embankment lip
    d.rectangle([0, SHORE_Y - 10, 3199, SHORE_Y - 6], fill=OCHRE_L)
    d.rectangle([0, SHORE_Y - 6, 3199, SHORE_Y - 4], fill=SAND)
    d.rectangle([0, WALK_TOP - 6, 3199, WALK_TOP - 1], fill=EARTH_D)

    # walkway: large irregular flagstones (no visible tile repetition)
    noise = value_noise(3200 // 12, (WALK_BOTTOM - WALK_TOP) // 6 + 2, 6, 902)
    for gy in range(len(noise)):
        for gx in range(len(noise[0])):
            v = noise[gy][gx]
            color = EARTH_M if v < 0.4 else (EARTH_L if v < 0.72 else OCHRE_D)
            x0 = gx * 12
            y0 = WALK_TOP + gy * 6
            d.rectangle([x0, y0, x0 + 11, y0 + 5], fill=color)
    # large flagstone joints
    y = WALK_TOP
    row = 0
    while y < WALK_BOTTOM:
        h = rng.randrange(34, 52)
        x = -rng.randrange(0, 80)
        while x < 3200:
            w = rng.randrange(70, 130)
            c = rng.choice((EARTH_L, EARTH_M, OCHRE_D))
            d.rectangle([max(0, x + 2), y + 2, min(3199, x + w - 2), min(WALK_BOTTOM - 1, y + h - 2)], fill=c)
            d.line([(max(0, x + 2), y + 2), (min(3199, x + w - 2), y + 2)], fill=SAND)
            d.line([(max(0, x + 2), min(WALK_BOTTOM - 2, y + h - 2)), (min(3199, x + w - 2), min(WALK_BOTTOM - 2, y + h - 2))], fill=EARTH_D)
            # wear marks
            for _ in range(rng.randrange(2, 7)):
                px = rng.randrange(max(0, x + 4), max(1, min(3199, x + w - 4)))
                py = rng.randrange(y + 4, max(y + 5, min(WALK_BOTTOM - 3, y + h - 4)))
                put(img, px, py, EARTH_D if rng.random() > 0.45 else SAND)
            x += w
        y += h
        row += 1
    # fallen leaves
    for _ in range(520):
        x = rng.randrange(0, 3200)
        yy = rng.randrange(WALK_TOP, WALK_BOTTOM)
        put(img, x, yy, OCHRE_D if rng.random() > 0.4 else SUNSET_L)

    # grass strip
    grass = Image.open(PROJECT / "assets" / "tiles" / "tile_grass.png")
    for x in range(0, 3200, 64):
        img.paste(grass, (x, GRASS_TOP), grass)
    for _ in range(200):
        x = rng.randrange(0, 3200)
        yy = GRASS_TOP + rng.randrange(0, 56)
        put(img, x, yy, GREEN_PL)
    return img


# ---------------------------------------------------------------------------
# Foreground framing
# ---------------------------------------------------------------------------

def bg_foreground() -> Image.Image:
    img = canvas(3776, H_LAYER)
    d = ImageDraw.Draw(img)
    rng = random.Random(1001)

    # hanging willow strands from the top edge
    for i in range(7):
        x = 160 + i * 520 + rng.randrange(0, 140)
        length = rng.randrange(80, 150)
        for k in range(length):
            xx = x + int(9 * math.sin(k / 26 + i * 1.7))
            put(img, xx, k, GREEN_D if k % 4 else GREEN_M)
            if k % 9 == 0:
                put(img, xx + 1, k, GREEN_M)
                put(img, xx + 2, k + 1, GREEN)
    # top canopy corners
    for cx in (40, 3700):
        for _ in range(14):
            x = cx + rng.randrange(-50, 50)
            yy = rng.randrange(-30, 26)
            bw = rng.randrange(8, 26)
            bh = rng.randrange(6, 18)
            d.rectangle([x, yy, x + bw, yy + bh], fill=GREEN_DD if rng.random() > 0.4 else GREEN_D)
    # bottom grass tufts
    for _ in range(260):
        x = rng.randrange(0, 3776)
        h = rng.randrange(4, 14)
        color = GREEN_DD if rng.random() > 0.5 else GREEN_D
        d.rectangle([x, H_LAYER - h, x + 1, H_LAYER], fill=color)
    return img


def main() -> None:
    for name, fn in (
        ("bg_sky", bg_sky),
        ("bg_far_hills", bg_far_hills),
        ("bg_cliff", bg_cliff),
        ("bg_river", bg_river),
        ("bg_promenade", bg_promenade),
        ("bg_foreground", bg_foreground),
    ):
        img = fn()
        save(img, "backgrounds", name)
        print("[backgrounds]", name, img.size)


if __name__ == "__main__":
    main()
