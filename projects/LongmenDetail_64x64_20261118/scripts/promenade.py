"""bg_promenade_v2 (3200x576) — riverside walkway for the parallax layer.

v2 goals: irregular flagstones with staggered joints, varied stone courses on
the embankment, moss in the crevices, and stone balustrade bases. The old
horizontal bands, repeated grass tile and salt-and-pepper wear dots are gone.

All colours come from spec_lock.md (InkGongbi48). Hard edges only.
"""

from __future__ import annotations

import math
import random

from PIL import Image, ImageDraw

from gen_lib import (
    canvas, save, put, dither_pick,
    INK3, INK4, DARK_EARTH, EARTH_D, EARTH, EARTH_M, EARTH_L,
    OCHRE_D, OCHRE, OCHRE_L, SAND, SAND_L,
    GREEN_D, GREEN_DD, GREEN, GREEN_M, GREEN_L,
)

W, H = 3200, 576
WALL_TOP = 368
WALK_TOP = 424
WALK_BOTTOM = 516
GRASS_BOTTOM = 576


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def bilerp_noise(width: int, height: int, gx: int, gy: int, seed: int) -> list[list[float]]:
    rng = random.Random(seed)
    nodes = [[rng.random() for _ in range(gx + 1)] for _ in range(gy + 1)]
    out = [[0.0] * width for _ in range(height)]
    for y in range(height):
        fy = y / max(1, height - 1) * gy
        iy = int(fy)
        ty = fy - iy
        ty = ty * ty * (3 - 2 * ty)
        ny = min(iy + 1, gy)
        row0, row1 = nodes[iy], nodes[ny]
        orow = out[y]
        for x in range(width):
            fx = x / max(1, width - 1) * gx
            ix = int(fx)
            tx = fx - ix
            tx = tx * tx * (3 - 2 * tx)
            nx = min(ix + 1, gx)
            a = row0[ix] * (1 - tx) + row0[nx] * tx
            b = row1[ix] * (1 - tx) + row1[nx] * tx
            orow[x] = a * (1 - ty) + b * ty
    return out


def stone(d: ImageDraw.ImageDraw, x0: int, y0: int, x1: int, y1: int,
          fill, rng: random.Random, light=OCHRE_D, dark=EARTH_D) -> tuple:
    j = 2
    p0 = (x0 + rng.randrange(-j, j + 1), y0 + rng.randrange(-j, j + 1))
    p1 = (x1 + rng.randrange(-j, j + 1), y0 + rng.randrange(-j, j + 1))
    p2 = (x1 + rng.randrange(-j, j + 1), y1 + rng.randrange(-j, j + 1))
    p3 = (x0 + rng.randrange(-j, j + 1), y1 + rng.randrange(-j, j + 1))
    d.polygon([p0, p1, p2, p3], fill=fill)
    d.line([p0, p1], fill=light)
    d.line([p0, p3], fill=light)
    d.line([p1, p2], fill=dark)
    d.line([p3, p2], fill=dark)
    return (p0, p1, p2, p3)


# ---------------------------------------------------------------------------
# embankment wall
# ---------------------------------------------------------------------------

def draw_wall(d: ImageDraw.ImageDraw, rng: random.Random) -> None:
    d.rectangle([0, WALL_TOP, W - 1, WALK_TOP - 2], fill=DARK_EARTH)
    y = WALL_TOP
    row = 0
    while y < WALK_TOP - 10:
        h = rng.randrange(20, 30)
        x = -rng.randrange(0, 120)
        while x < W:
            w = rng.randrange(60, 150)
            fill = rng.choice((EARTH, EARTH_M, EARTH_L, EARTH_D, EARTH_M))
            x0, y0 = max(0, x + 2), y + 1
            x1, y1 = min(W - 1, x + w - 2), min(WALK_TOP - 3, y + h - 2)
            if x1 - x0 > 6 and y1 - y0 > 4:
                stone(d, x0, y0, x1, y1, fill, rng,
                      light=OCHRE_D if fill in (EARTH, EARTH_M) else SAND,
                      dark=DARK_EARTH)
                # damp stain / moss at the waterline
                if row == 0 and rng.random() < 0.45:
                    for _ in range(rng.randrange(2, 7)):
                        mx = rng.randrange(x0, x1)
                        my = rng.randrange(y0, y0 + max(2, (y1 - y0) // 2))
                        put_moss(d, mx, my, rng)
            x += w
        y += h
        row += 1

    # waterline: dark damp band with moss, broken
    for x in range(0, W, 3):
        if rng.random() < 0.55:
            put_moss(d, x, WALL_TOP + rng.randrange(0, 3), rng)
    for x in range(0, W, 7):
        if rng.random() < 0.35:
            d.line([(x, WALL_TOP), (x + rng.randrange(3, 9), WALL_TOP)],
                   fill=INK4 if rng.random() < 0.5 else DARK_EARTH)


def put_moss(d: ImageDraw.ImageDraw, x: int, y: int, rng: random.Random) -> None:
    d.point((x, y), fill=rng.choice((GREEN_DD, GREEN_D, GREEN_D, GREEN)))
    if rng.random() < 0.3:
        d.point((x, y - 1), fill=GREEN_M)


# ---------------------------------------------------------------------------
# curb + balustrade bases
# ---------------------------------------------------------------------------

def draw_curb(d: ImageDraw.ImageDraw, rng: random.Random) -> None:
    y0, y1 = WALK_TOP - 8, WALK_TOP + 2
    x = -rng.randrange(0, 60)
    while x < W:
        w = rng.randrange(60, 140)
        color = rng.choice((EARTH_M, EARTH_L, OCHRE_D))
        x0, x1 = max(0, x + 2), min(W - 1, x + w - 2)
        if x1 - x0 > 10:
            stone(d, x0, y0, x1, y1, color, rng,
                  light=OCHRE if color is EARTH_L else OCHRE_D,
                  dark=EARTH_D)
            if rng.random() < 0.18:
                d.line([(x0 + 4, y0 + 1), (x1 - 4, y0 + 1)], fill=EARTH_D)
            # worn top
            for _ in range(rng.randrange(1, 4)):
                d.line([(rng.randrange(x0, x1), y0 + 1),
                        (rng.randrange(x0, x1), y0 + 1)], fill=OCHRE_L)
            # moss in the joints
            if rng.random() < 0.5:
                put_moss(d, x0 + rng.randrange(0, 3), y1 - 1, rng)
        x += w + rng.randrange(2, 8)


def draw_bases(d: ImageDraw.ImageDraw, rng: random.Random) -> None:
    x = 120 + rng.randrange(0, 80)
    while x < W - 60:
        w = rng.randrange(36, 46)
        h = rng.randrange(20, 27)
        top = WALK_TOP - h - 2
        # plinth
        stone(d, x - w // 2, top, x + w // 2, WALK_TOP + 1, EARTH_L, rng,
              light=SAND, dark=EARTH_D)
        # carved recess and worn top
        d.rectangle([x - w // 2 + 5, top + 4, x + w // 2 - 5, top + h - 4], fill=EARTH_M)
        d.line([(x - w // 2 + 5, top + 4), (x + w // 2 - 5, top + 4)], fill=OCHRE)
        d.line([(x - w // 2 + 5, top + h - 4), (x + w // 2 - 5, top + h - 4)], fill=DARK_EARTH)
        d.rectangle([x - 4, top + 6, x + 4, top + h - 6], fill=EARTH_D)
        d.line([(x - 4, top + 6), (x + 4, top + h - 6)], fill=DARK_EARTH)
        # moss at the foot
        for _ in range(rng.randrange(2, 8)):
            put_moss(d, x + rng.randrange(-w // 2, w // 2), WALK_TOP - rng.randrange(0, 3), rng)
        x += rng.randrange(220, 340)


# ---------------------------------------------------------------------------
# flagstone walkway
# ---------------------------------------------------------------------------

def draw_walkway(d: ImageDraw.ImageDraw, img: Image.Image, rng: random.Random) -> None:
    d.rectangle([0, WALK_TOP, W - 1, WALK_BOTTOM], fill=DARK_EARTH)
    cw, ch = 108, 56
    cols = W // cw + 3
    rows = (WALK_BOTTOM - WALK_TOP) // ch + 3
    seeds = []
    fills = []
    for gy in range(rows):
        srow, frow = [], []
        for gx in range(cols):
            srow.append((gx * cw + rng.uniform(-34, 34),
                         WALK_TOP - ch + gy * ch + rng.uniform(-18, 18)))
            frow.append(rng.choice((EARTH_M, EARTH_L, OCHRE_D, EARTH, EARTH_M)))
        seeds.append(srow)
        fills.append(frow)

    Hw = WALK_BOTTOM - WALK_TOP
    labels = [[0] * W for _ in range(Hw)]
    for yy in range(Hw):
        y = WALK_TOP + yy
        gy = yy // ch + 1
        for x in range(W):
            gx = x // cw + 1
            best = 1e18
            bl = 0
            for ny in range(gy - 1, gy + 2):
                if not (0 <= ny < rows):
                    continue
                for nx in range(gx - 1, gx + 2):
                    if not (0 <= nx < cols):
                        continue
                    sx, sy = seeds[ny][nx]
                    dx = x - sx
                    dy = y - sy
                    d2 = dx * dx + dy * dy
                    if d2 < best:
                        best = d2
                        bl = ny * cols + nx
            labels[yy][x] = bl

    px = img.load()
    light_of = {}
    dark_of = {}
    for gy in range(rows):
        for gx in range(cols):
            f = fills[gy][gx]
            light_of[gy * cols + gx] = SAND if f in (EARTH_L, OCHRE_D) else OCHRE
            dark_of[gy * cols + gx] = EARTH_D

    for yy in range(Hw):
        y = WALK_TOP + yy
        for x in range(W):
            px[x, y] = fills[labels[yy][x] // cols][labels[yy][x] % cols]

    # bevel: lit top/left, shadowed bottom/right; 2px joints
    for yy in range(Hw):
        y = WALK_TOP + yy
        lab_row = labels[yy]
        up = labels[yy - 1] if yy > 0 else None
        down = labels[yy + 1] if yy < Hw - 1 else None
        for x in range(W):
            l = lab_row[x]
            if (up is not None and up[x] != l) or (x > 0 and lab_row[x - 1] != l):
                px[x, y] = light_of[l]
            elif (down is not None and down[x] != l) or (x < W - 1 and lab_row[x + 1] != l):
                px[x, y] = dark_of[l]

    # large-scale tonal variation across the paving (2x2 clusters)
    n1 = bilerp_noise(W, H, 26, 8, 9101)
    n2 = bilerp_noise(W, H, 90, 30, 9102)
    base_colors = (EARTH_M, EARTH_L, OCHRE_D, EARTH)
    lighten = {EARTH: EARTH_M, EARTH_M: EARTH_L, EARTH_L: OCHRE_D, OCHRE_D: OCHRE}
    darken = {OCHRE_D: EARTH_L, EARTH_L: EARTH_M, EARTH_M: EARTH, EARTH: EARTH_D}
    for yy in range(WALK_TOP + 2, WALK_BOTTOM - 1):
        for xx in range(0, W):
            c = px[xx, yy]
            if c not in base_colors:
                continue
            v = n1[yy][xx] * 0.62 + n2[yy][xx] * 0.38
            if v > 0.66 and dither_pick(xx, yy, (v - 0.66) * 2.2):
                px[xx, yy] = lighten[c]
            elif v < 0.34 and dither_pick(xx, yy, (0.34 - v) * 2.2):
                px[xx, yy] = darken[c]

    # joint moss
    for _ in range(420):
        x = rng.randrange(0, W)
        y = rng.randrange(WALK_TOP + 2, WALK_BOTTOM - 2)
        if px[x, y] in (EARTH_D, DARK_EARTH):
            put_moss(d, x, y, rng)

    # a few sunken / missing stones
    for _ in range(9):
        x = rng.randrange(60, W - 60)
        y = rng.randrange(WALK_TOP + 20, WALK_BOTTOM - 30)
        w = rng.randrange(30, 60)
        h = rng.randrange(16, 26)
        d.ellipse([x - w // 2, y - h // 2, x + w // 2, y + h // 2], fill=EARTH_D)
        d.arc([x - w // 2, y - h // 2, x + w // 2, y + h // 2], 10, 160, fill=DARK_EARTH)
        d.arc([x - w // 2 + 3, y - h // 2 + 3, x + w // 2 - 3, y + h // 2 - 3], 190, 350, fill=EARTH_L)
        for _ in range(rng.randrange(3, 9)):
            put_moss(d, x + rng.randrange(-w // 2, w // 2), y + rng.randrange(-h // 2, 0), rng)


# ---------------------------------------------------------------------------
# grass verge
# ---------------------------------------------------------------------------

def draw_grass(img: Image.Image, rng: random.Random) -> None:
    n1 = bilerp_noise(W, H, 34, 12, 9201)
    n2 = bilerp_noise(W, H, 150, 50, 9202)
    px = img.load()
    for y in range(WALK_BOTTOM, GRASS_BOTTOM):
        for x in range(W):
            v = n1[y][x] * 0.7 + n2[y][x] * 0.3
            if v < 0.48:
                c = GREEN_DD
            elif v < 0.78:
                c = GREEN_D
            else:
                c = GREEN
            if y < WALK_BOTTOM + 5:
                c = GREEN_DD
            if y > GRASS_BOTTOM - 10:
                c = GREEN_DD if v < 0.7 else GREEN_D
            px[x, y] = c

    d = ImageDraw.Draw(img)

    # blade strokes: short vertical marks give the verge a grassy grain
    for _ in range(2400):
        x = rng.randrange(0, W)
        y = rng.randrange(WALK_BOTTOM + 2, GRASS_BOTTOM - 2)
        h = rng.randrange(1, 4)
        color = rng.choice((GREEN, GREEN_M, GREEN_D, GREEN_M, GREEN_L))
        for k in range(h):
            put(img, x + (k // 2), y - k, color)

    # overhanging tufts at the walkway edge
    x = 0
    while x < W:
        if rng.random() < 0.85:
            h = rng.randrange(3, 10)
            color = rng.choice((GREEN_D, GREEN, GREEN_M, GREEN_DD))
            for k in range(h):
                put(img, x + rng.randrange(0, 3), WALK_BOTTOM - 1 - k, color)
            if rng.random() < 0.35:
                put(img, x + 1, WALK_BOTTOM - h, GREEN_L)
        x += rng.randrange(2, 6)

    # damp shadow pockets and a few small stones, kept sparse
    for _ in range(26):
        x = rng.randrange(0, W)
        y = rng.randrange(GRASS_BOTTOM - 18, GRASS_BOTTOM - 3)
        w = rng.randrange(8, 22)
        h = rng.randrange(2, 5)
        d.ellipse([x - w // 2, y - h // 2, x + w // 2, y + h // 2],
                  fill=DARK_EARTH if rng.random() > 0.5 else EARTH_D)
    for _ in range(30):
        x = rng.randrange(0, W)
        y = rng.randrange(WALK_BOTTOM + 8, GRASS_BOTTOM - 4)
        d.rectangle([x, y, x + rng.randrange(2, 5), y + rng.randrange(1, 3)],
                    fill=EARTH_L if rng.random() > 0.5 else OCHRE_D)
        if rng.random() < 0.5:
            put(img, x, y - 1, GREEN_D)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def bg_promenade_v2() -> Image.Image:
    img = canvas(W, H)
    d = ImageDraw.Draw(img)
    rng = random.Random(20261118)

    draw_grass(img, rng)
    draw_wall(d, rng)
    draw_walkway(d, img, rng)
    draw_curb(d, rng)
    draw_bases(d, rng)
    return img


def main() -> None:
    img = bg_promenade_v2()
    save(img, "backgrounds", "bg_promenade_v2")
    print("[backgrounds] bg_promenade_v2", img.size)


if __name__ == "__main__":
    main()
