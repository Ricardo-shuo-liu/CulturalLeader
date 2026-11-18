"""bg_cliff_v2 (2112x576) — West Hill cliff wall for the parallax layer.

v2 goals: real rock bedding instead of horizontal bands, irregular cracks,
moss on ledges, and niches of varied depth. The old symbolic giant Buddha is
removed; the hero niche is a separate asset (bg_fengxian_niche).

All colours come from spec_lock.md (InkGongbi48). Hard edges only.
"""

from __future__ import annotations

import math
import random

from PIL import Image, ImageDraw

from gen_lib import (
    canvas, save, put, dither_pick,
    INK, INK2, INK3, INK4, DARK_EARTH, EARTH_D, EARTH, EARTH_M, EARTH_L,
    OCHRE_D, OCHRE, OCHRE_L, SAND, SAND_L,
    GREEN_D, GREEN_DD, GREEN, GREEN_M, GREEN_L,
)

W, H = 2112, 576
BOTTOM = 432

ROCK_RAMP = [INK4, DARK_EARTH, EARTH_D, EARTH, EARTH_M, EARTH_L, OCHRE_D, OCHRE, OCHRE_L]


# ---------------------------------------------------------------------------
# noise helpers
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


def ridge_profile(rng: random.Random) -> list[int]:
    """Rolling cliff crest with a few outcrops; index = x."""
    ridge = []
    for x in range(W):
        y = (152
             + 30 * math.sin(x * 0.0021 + 1.1)
             + 16 * math.sin(x * 0.0063 + 0.4)
             + 8 * math.sin(x * 0.017 + 2.2)
             + 4 * math.sin(x * 0.041 + 0.9))
        ridge.append(int(max(88, min(208, y))))
    # a few sharper outcrops
    for _ in range(9):
        cx = rng.randrange(60, W - 60)
        half = rng.randrange(18, 46)
        lift = rng.randrange(8, 22)
        for x in range(max(0, cx - half), min(W, cx + half)):
            d = abs(x - cx) / half
            ridge[x] = int(max(80, ridge[x] - lift * (1 - d) ** 1.5))
    # terrace the crest into blocky rock steps
    return [(y // 5) * 5 for y in ridge]


# ---------------------------------------------------------------------------
# rock body
# ---------------------------------------------------------------------------

def draw_rock(img: Image.Image, ridge: list[int], rng: random.Random) -> bytearray:
    n1 = bilerp_noise(W, H, 8, 4, 7101)      # broad mass
    n2 = bilerp_noise(W, H, 30, 10, 7102)    # buttress planes
    n3 = bilerp_noise(W, H, 120, 42, 7103)   # grain / dither
    n4 = bilerp_noise(W, H, 5, 3, 7104)      # deep alcoves
    mask = bytearray(W * H)
    px = img.load()
    plane_ramp = [INK4, DARK_EARTH, EARTH_D, EARTH, EARTH_M, EARTH_L, OCHRE_D]

    for x in range(W):
        top = ridge[x]
        bottom = BOTTOM + int(5 * math.sin(x * 0.013) + 3 * math.sin(x * 0.041 + 1.7))
        for y in range(top, bottom):
            t = (y - top) / max(1, bottom - top)
            plane = (0.54
                     + (n2[y][x] - 0.5) * 0.42
                     + (n1[y][x] - 0.5) * 0.34
                     + (n4[y][x] - 0.5) * 0.20
                     - 0.09 * t)
            if y - top < 4:
                plane += 0.08
            f = plane * 6
            i = int(f)
            if dither_pick(x, y, (f - i) * 0.55):
                i += 1
            # fine grain nudges one step, kept sparse
            if n3[y][x] > 0.82 and i < 5:
                i += 1
            elif n3[y][x] < 0.14 and i > 1:
                i -= 1
            i = max(0, min(len(plane_ramp) - 1, i))
            px[x, y] = plane_ramp[i]
            mask[y * W + x] = 1
    return mask


def inside(mask: bytearray, x: int, y: int) -> bool:
    return 0 <= x < W and 0 <= y < H and mask[y * W + x] == 1


def draw_buttresses(img: Image.Image, mask: bytearray, ridge: list[int], rng: random.Random) -> None:
    """Vertical rock folds: shadowed grooves with a lit left edge."""
    px = img.load()

    # overhang shadow just under the crest
    for x in range(W):
        top = ridge[x]
        for k in range(3, 12):
            if inside(mask, x, top + k) and dither_pick(x, top + k, 0.72 - k * 0.055):
                px[x, top + k] = DARK_EARTH

    for _ in range(30):
        x = rng.randrange(0, W)
        top = ridge[x]
        width = rng.randrange(5, 17)
        depth = rng.randrange(60, 210)
        for k in range(depth):
            y = top + 10 + k
            if not inside(mask, x, y):
                continue
            for ox in range(width):
                if inside(mask, x + ox, y) and dither_pick(x + ox, y, 0.58 - ox * 0.03):
                    px[x + ox, y] = DARK_EARTH
            if inside(mask, x - 1, y):
                px[x - 1, y] = OCHRE_D if (k % 4) else EARTH_L
            if rng.random() < 0.14:
                x += rng.choice((-1, 0, 1))
            x = max(2, min(W - width - 2, x))

    # major fissures that split the wall into large blocks
    for _ in range(11):
        x = rng.randrange(20, W - 20)
        top = ridge[x]
        length = rng.randrange(90, 250)
        width = rng.randrange(3, 8)
        for k in range(length):
            y = top + 16 + k
            if not inside(mask, x, y):
                continue
            for ox in range(width):
                if inside(mask, x + ox, y) and dither_pick(x + ox, y, 0.88 - ox * 0.05):
                    px[x + ox, y] = INK4 if ox == width // 2 else DARK_EARTH
            if inside(mask, x - 1, y):
                px[x - 1, y] = OCHRE_D
            if rng.random() < 0.10:
                x += rng.choice((-1, 0, 1))


# ---------------------------------------------------------------------------
# bedding, cracks, moss
# ---------------------------------------------------------------------------

def draw_bedding(img: Image.Image, mask: bytearray, rng: random.Random) -> None:
    px = img.load()
    d = ImageDraw.Draw(img)

    for k in range(24):
        y0 = 104 + k * 13 + rng.randrange(-4, 5)
        a1 = rng.uniform(4, 11)
        p1 = rng.uniform(0, math.tau)
        a2 = rng.uniform(2, 5)
        p2 = rng.uniform(0, math.tau)
        heavy = rng.random() < 0.35
        x = rng.randrange(0, 60)
        while x < W:
            seg = rng.randrange(34, 96)
            gap = rng.randrange(12, 70)
            pts = []
            for xx in range(x, min(W, x + seg), 3):
                yy = int(y0 + a1 * math.sin(xx * 0.0055 + p1)
                         + a2 * math.sin(xx * 0.016 + p2))
                if inside(mask, xx, yy) and inside(mask, xx, yy + 2):
                    pts.append((xx, yy))
            if len(pts) >= 3:
                d.line(pts, fill=DARK_EARTH, width=2 if heavy else 1)
                d.line([(x0, y0 - 1) for x0, y0 in pts], fill=OCHRE_D)
                # ledge top catches light; the wall under it falls into shadow
                if heavy:
                    for k in (2, 3, 4):
                        pxs = img.load()
                        for x0, y0 in pts:
                            if inside(mask, x0, y0 + k) and dither_pick(x0, y0 + k, 0.72 - k * 0.12):
                                pxs[x0, y0 + k] = DARK_EARTH
                # broken ledges
                if rng.random() < 0.30:
                    start = rng.randrange(0, max(1, len(pts) - 12))
                    ledge = pts[start:start + rng.randrange(6, 14)]
                    d.line([(x0, y0 + 1) for x0, y0 in ledge], fill=EARTH_L)
            x += seg + gap

    # vertical joints breaking the bedding into blocks
    for _ in range(220):
        x = rng.randrange(0, W)
        y = rng.randrange(100, BOTTOM - 20)
        if not inside(mask, x, y):
            continue
        length = rng.randrange(6, 22)
        for k in range(length):
            if inside(mask, x, y + k):
                put(img, x, y + k, DARK_EARTH)
                if inside(mask, x - 1, y + k) and k % 3 == 0:
                    put(img, x - 1, y + k, EARTH_L)
            if rng.random() < 0.12:
                x += rng.choice((-1, 1))

    # cracks: short random walks, rarely branching
    for _ in range(150):
        x = rng.randrange(0, W)
        y = rng.randrange(90, BOTTOM - 10)
        if not inside(mask, x, y):
            continue
        dx = rng.choice((-1, 0, 0, 1))
        for i in range(rng.randrange(6, 26)):
            if not inside(mask, x, y):
                break
            px[x, y] = INK3 if (i % 5 == 0) else DARK_EARTH
            x += dx
            y += 1
            if rng.random() < 0.10:
                dx = max(-1, min(1, dx + rng.choice((-1, 1))))


def draw_moss(img: Image.Image, mask: bytearray, ridge: list[int], rng: random.Random) -> None:
    px = img.load()

    # larger shrubs first, then fine tufts
    for _ in range(26):
        bx = rng.randrange(6, W - 6)
        by = ridge[bx]
        w = rng.randrange(5, 13)
        h = rng.randrange(5, 14)
        for _ in range(w * h // 2):
            ox = rng.randrange(-w // 2, w // 2)
            oy = -rng.randrange(0, h)
            put(img, bx + ox, by + oy, GREEN_DD if rng.random() > 0.35 else GREEN_D)
        if rng.random() < 0.5:
            put(img, bx + 1, by - h, GREEN_M)

    # crest vegetation: irregular tufts, never rectangular
    x = 0
    while x < W:
        if rng.random() < 0.55:
            clump = rng.randrange(2, 6)
            for _ in range(clump):
                bx = x + rng.randrange(-4, 6)
                by = ridge[max(0, min(W - 1, bx))]
                h = rng.randrange(2, 7)
                color = rng.choice((GREEN_DD, GREEN_D, GREEN_D, GREEN))
                for k in range(h):
                    for ox in (0, 1):
                        put(img, bx + ox, by - k, color)
                if rng.random() < 0.35:
                    put(img, bx + 1, by - h, GREEN_M)
        x += rng.randrange(3, 9)

    # ledge moss: small damp patches in the bedding shadows
    for _ in range(260):
        x = rng.randrange(0, W)
        y = rng.randrange(110, BOTTOM - 20)
        if not inside(mask, x, y):
            continue
        if px[x, y] not in (DARK_EARTH, EARTH_D, INK3):
            continue
        size = rng.randrange(2, 5)
        color = rng.choice((GREEN_DD, GREEN_D, GREEN_M))
        for _ in range(size):
            mx = x + rng.randrange(-2, 3)
            my = y + rng.randrange(-1, 3)
            if inside(mask, mx, my):
                px[mx, my] = color
                if rng.random() < 0.4:
                    put(img, mx, my - 1, GREEN_M)


# ---------------------------------------------------------------------------
# niches
# ---------------------------------------------------------------------------

def draw_niche(img: Image.Image, mask: bytearray, cx: int, top: int, w: int, rng: random.Random) -> bool:
    h = int(w * rng.uniform(1.18, 1.45))
    r = w // 2
    if top < 92 or top + h > BOTTOM - 8:
        return False
    # keep the whole niche on the rock
    for x in range(cx - r - 4, cx + r + 5, 3):
        for y in (top - 3, top + w // 2, top + h + 3):
            if not inside(mask, x, y):
                return False

    px = img.load()
    d = ImageDraw.Draw(img)
    depth = rng.random()
    if depth < 0.28:
        cavity, inner = EARTH_D, EARTH_M
    elif depth < 0.62:
        cavity, inner = DARK_EARTH, EARTH_D
    else:
        cavity, inner = INK3, DARK_EARTH

    oval = [cx - r, top, cx + r, top + w]
    # carved rim: warm on the upper-left, shadow on the lower-right
    d.arc([oval[0] - 1, oval[1] - 1, oval[2] + 1, oval[3] + 1], 180, 360, fill=OCHRE_D)
    d.line([(cx - r - 1, top + w // 2), (cx - r - 1, top + h)], fill=OCHRE_D)
    d.arc([oval[0] - 1, oval[1] - 1, oval[2] + 1, oval[3] + 1], 0, 180, fill=DARK_EARTH)
    d.line([(cx + r + 1, top + w // 2), (cx + r + 1, top + h)], fill=DARK_EARTH)

    d.pieslice(oval, 180, 360, fill=cavity)
    d.rectangle([cx - r, top + w // 2, cx + r, top + h], fill=cavity)
    # inner back wall, slightly lighter at the top
    d.pieslice([oval[0] + 2, oval[1] + 2, oval[2] - 2, oval[3] - 2], 180, 360, fill=inner)
    for yy in range(top + w // 2, top + h - 1):
        if dither_pick(cx, yy, 0.22):
            d.line([(cx - r + 2, yy), (cx + r - 2, yy)], fill=cavity)

    # seated silhouette in some niches
    if w >= 12 and h >= 14 and rng.random() < 0.55:
        base = top + h - 2
        bw = max(2, int(w * 0.22))
        body_h = max(4, int(h * 0.34))
        fig = OCHRE_D if cavity is not INK3 else EARTH_D
        d.rectangle([cx - bw, base - body_h, cx + bw, base], fill=fig)
        d.ellipse([cx - bw + 1, base - body_h - bw * 2, cx + bw - 1, base - body_h], fill=fig)
        d.rectangle([cx - bw - 1, base, cx + bw + 1, base + 1], fill=cavity)

    # erosion: break part of the rim
    if rng.random() < 0.28:
        ex = cx + rng.randrange(-r, r + 1)
        for _ in range(rng.randrange(3, 9)):
            put(img, ex + rng.randrange(-2, 3), top + rng.randrange(0, max(2, w // 2)),
                DARK_EARTH if rng.random() > 0.4 else EARTH_D)
    return True


def draw_cave(img: Image.Image, mask: bytearray, cx: int, top: int, w: int, rng: random.Random) -> bool:
    """Larger cave shrine: broken rim, deep cavity, seated figure."""
    h = int(w * rng.uniform(0.62, 0.86))
    r = w // 2
    if top < 96 or top + h > BOTTOM - 10:
        return False
    for x in range(cx - r - 5, cx + r + 6, 4):
        for y in (top - 4, top + h - 2, top + h + 4):
            if not inside(mask, x, y):
                return False

    d = ImageDraw.Draw(img)
    px = img.load()
    oval = [cx - r, top, cx + r, top + h]
    # rough carved rim
    d.arc([oval[0] - 2, oval[1] - 2, oval[2] + 2, oval[3] + 2], 170, 370, fill=OCHRE_D)
    d.line([(cx - r - 2, top + h // 2), (cx - r - 2, top + h)], fill=EARTH_L)
    d.arc([oval[0] - 1, oval[1] + 1, oval[2] + 1, oval[3] + 2], 20, 160, fill=DARK_EARTH, width=2)
    d.line([(cx + r + 2, top + h // 2), (cx + r + 2, top + h)], fill=DARK_EARTH, width=2)
    # cavity: dark ceiling, lighter back wall, dark floor
    d.pieslice(oval, 180, 360, fill=INK3)
    d.rectangle([cx - r, top + h // 2, cx + r, top + h], fill=INK3)
    d.pieslice([oval[0] + 3, oval[1] + 3, oval[2] - 3, oval[3] - 3], 180, 360, fill=INK4)
    for yy in range(top + 6, top + h - 4):
        if dither_pick(cx, yy, 0.30):
            d.line([(cx - r + 3, yy), (cx + r - 3, yy)], fill=DARK_EARTH)
    d.rectangle([cx - r + 2, top + h - 5, cx + r - 2, top + h - 1], fill=DARK_EARTH)
    # halo + seated figure at the back
    hy = top + int(h * 0.52)
    d.arc([cx - r // 2, hy - r // 2, cx + r // 2, hy + r // 2], 0, 360, fill=DARK_EARTH)
    bw = max(4, r // 5)
    base = top + h - 6
    d.rectangle([cx - bw, base - int(h * 0.28), cx + bw, base], fill=EARTH_D)
    d.ellipse([cx - bw + 1, base - int(h * 0.28) - bw * 2, cx + bw - 1, base - int(h * 0.28)],
              fill=EARTH_D)
    d.line([(cx - r + 3, top + h - 6), (cx + r - 3, top + h - 6)], fill=EARTH_D)
    # cast shadow to the lower right
    for k in range(3, 7):
        for x in range(cx - r, cx + r, 2):
            if inside(mask, x + k, top + h + k) and dither_pick(x, top + h + k, 0.45):
                put(img, x + k, top + h + k, DARK_EARTH)
    return True


def draw_niches(img: Image.Image, mask: bytearray, rng: random.Random) -> None:
    placed: list[tuple[int, int, int, int]] = []

    def overlaps(x0, y0, x1, y1) -> bool:
        for ax0, ay0, ax1, ay1 in placed:
            if x0 < ax1 + 3 and x1 > ax0 - 3 and y0 < ay1 + 3 and y1 > ay0 - 3:
                return True
        return False

    # dense 万佛洞-style honeycomb clusters of tiny niches
    for ccx, ccy in ((300, 270), (760, 200), (1150, 300), (1520, 220), (1900, 280)):
        for gy in range(9):
            for gx in range(16):
                x = ccx - 72 + gx * 9 + rng.randrange(-2, 3)
                y = ccy - 54 + gy * 9 + rng.randrange(-2, 3)
                if rng.random() > 0.62:
                    continue
                w = rng.randrange(4, 8)
                h = int(w * rng.uniform(1.0, 1.45))
                if overlaps(x - w, y, x + w, y + h):
                    continue
                if draw_niche(img, mask, x, y, w, rng):
                    placed.append((x - w, y, x + w, y + h))

    # medium niches in looser groups
    clusters = [
        (130, 200, 10, (9, 20)), (470, 230, 8, (10, 24)),
        (650, 310, 7, (12, 26)), (900, 170, 9, (8, 20)),
        (1040, 250, 8, (10, 24)), (1300, 190, 9, (9, 22)),
        (1420, 310, 7, (12, 26)), (1680, 180, 8, (9, 22)),
        (1800, 250, 8, (10, 24)), (2030, 200, 7, (9, 22)),
    ]
    for ccx, ccy, count, sizes in clusters:
        for _ in range(count * 4):
            if count <= 0:
                break
            x = ccx + rng.randrange(-120, 120)
            y = ccy + rng.randrange(-60, 70)
            w = rng.randrange(*sizes)
            h = int(w * 1.3)
            if overlaps(x - w, y, x + w, y + h):
                continue
            if draw_niche(img, mask, x, y, w, rng):
                placed.append((x - w, y, x + w, y + h))
                count -= 1

    # large cave shrines
    for x, y, w in ((250, 230, 58), (700, 300, 48), (1030, 190, 64),
                    (1370, 260, 52), (1740, 300, 60), (2020, 220, 46)):
        if overlaps(x - w, y, x + w, y + int(w * 0.9)):
            continue
        if draw_cave(img, mask, x, y, w, rng):
            placed.append((x - w, y, x + w, y + w))


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def bg_cliff_v2() -> Image.Image:
    img = canvas(W, H)
    rng = random.Random(20261118)
    ridge = ridge_profile(rng)
    mask = draw_rock(img, ridge, rng)
    draw_bedding(img, mask, rng)
    draw_niches(img, mask, rng)
    draw_moss(img, mask, ridge, rng)

    # silhouette edge along the crest
    px = img.load()
    for x in range(W):
        y = ridge[x]
        if y < H:
            px[x, y] = INK3 if (x % 11 == 0) else DARK_EARTH
    return img


def main() -> None:
    img = bg_cliff_v2()
    save(img, "backgrounds", "bg_cliff_v2")
    print("[backgrounds] bg_cliff_v2", img.size)


if __name__ == "__main__":
    main()
