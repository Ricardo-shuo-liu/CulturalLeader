"""bg_fengxian_niche 768x576 — Fengxian Temple Vairocana niche.

Reference-guided, palette-locked (InkGongbi48). Hard edges only.
Version 2: fuller face, sculpted features, narrower shoulders, deep U folds,
richer flame halo, stone platform and weathering.
"""

from __future__ import annotations

import math
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from gen_lib import (
    canvas, save, put, value_noise, combine_noise, dither_pick,
    INK, INK2, INK3, INK4, DARK_EARTH, EARTH_D, EARTH, EARTH_M, EARTH_L,
    OCHRE_D, OCHRE, OCHRE_L, SAND, SAND_L, CREAM,
    GREEN_D, GREEN_DD, GREEN_M,
    WATER_D, WATER_DD, WATER, WATER_L,
    DUSK, DUSK_D, DUSK_M, DUSK_L, SUNSET_D, SUNSET, SUNSET_L, SUN_GOLD, SUN_LIGHT, SUN_HI,
    VERMILION, VERMILION_D, PANTS, SKIN, SKIN_D,
)
from photo_buddha import build_buddha_sprite

W, H = 768, 576
CX = 384

OPEN_L, OPEN_R = 58, 710
OPEN_TOP, OPEN_BOTTOM = 16, 548
OPEN_R_TOP = (OPEN_R - OPEN_L) // 2

FRAME = 24
OUT_L, OUT_R = OPEN_L - FRAME, OPEN_R + FRAME
OUT_TOP, OUT_BOTTOM = OPEN_TOP - FRAME, OPEN_BOTTOM

HEAD_W, HEAD_H = 96, 128
HEAD_TOP = 50
HEAD_CX = CX
HALO_CX, HALO_CY, HALO_R = CX, 116, 136

BODY_TOP = 178
BODY_BOTTOM = 336


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def arch_mask(w: int, h: int, left: int, top: int, right: int, bottom: int) -> Image.Image:
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    r = (right - left) // 2
    d.pieslice([left, top, right, top + 2 * r], 180, 360, fill=255)
    d.rectangle([left, top + r, right, bottom], fill=255)
    return mask


def mask_to_layer(mask: Image.Image, color) -> Image.Image:
    layer = Image.new("RGBA", mask.size, color)
    layer.putalpha(mask)
    return layer


def composite_masked(base: Image.Image, layer: Image.Image, mask: Image.Image) -> None:
    alpha = ImageChops.multiply(layer.getchannel("A"), mask)
    l = layer.copy()
    l.putalpha(alpha)
    base.alpha_composite(l)


def gauss(dx: float, dy: float, s: float) -> float:
    return math.exp(-(dx * dx + dy * dy) / s)


def shade_mask(layer, mask, bbox, ramp, light_fn, noise, noise_weight=0.05) -> None:
    x0, y0, x1, y1 = bbox
    px = layer.load()
    mpx = mask.load()
    for y in range(y0, y1):
        row = noise[y]
        for x in range(x0, x1):
            if mpx[x, y] == 0:
                continue
            light = light_fn(x, y) + (row[x] - 0.5) * noise_weight
            light = max(0.0, min(0.9999, light))
            f = light * (len(ramp) - 1)
            i = int(f)
            frac = f - i
            if dither_pick(x, y, frac):
                i = min(len(ramp) - 1, i + 1)
            px[x, y] = ramp[i]


def outline_mask(mask: Image.Image) -> Image.Image:
    return ImageChops.subtract(mask.filter(ImageFilter.MaxFilter(3)), mask)


def noise2(seed: int, scale_a: int = 14, scale_b: int = 46) -> list[list[float]]:
    return combine_noise(value_noise(W, H, scale_a, seed), value_noise(W, H, scale_b, seed + 7), 0.45)


# ---------------------------------------------------------------------------
# frame + interior
# ---------------------------------------------------------------------------

def draw_frame(img: Image.Image, rng: random.Random) -> None:
    opening = arch_mask(W, H, OPEN_L, OPEN_TOP, OPEN_R, OPEN_BOTTOM)
    outer = arch_mask(W, H, OUT_L, OUT_TOP, OUT_R, OUT_BOTTOM)
    band = ImageChops.subtract(outer, opening)

    n1 = value_noise(W, H, 9, 2101)
    n2 = value_noise(W, H, 25, 2102)

    frame_layer = canvas(W, H)
    px = frame_layer.load()
    bpx = band.load()
    for y in range(H):
        for x in range(W):
            if not bpx[x, y]:
                continue
            v = n1[y][x] * 0.6 + n2[y][x] * 0.4
            if v < 0.26:
                color = EARTH_D
            elif v < 0.44:
                color = EARTH
            elif v < 0.62:
                color = EARTH_M
            elif v < 0.79:
                color = EARTH_L
            else:
                color = OCHRE_D
            if dither_pick(x, y, ((v * 5) % 1.0) * 0.45):
                color = EARTH_L if v < 0.58 else OCHRE_D
            px[x, y] = color

    d = ImageDraw.Draw(frame_layer)

    # carved strata
    for yy in range(-8, H, 18):
        x = 0
        while x < W:
            step = rng.randrange(16, 42)
            if 0 <= yy < H and bpx[x, yy]:
                d.line([(x, yy), (min(W - 1, x + step), yy + rng.randrange(-2, 3))], fill=EARTH_D)
            x += step

    # cracks and worn pockets
    for _ in range(90):
        x = rng.randrange(OUT_L, OUT_R)
        y = rng.randrange(0, OPEN_BOTTOM)
        for _ in range(rng.randrange(5, 18)):
            if 0 <= x < W and 0 <= y < H and bpx[x, y]:
                px[x, y] = DARK_EARTH
            x += rng.choice((-1, 0, 0, 1))
            y += 1
    for _ in range(140):
        x = rng.randrange(OUT_L, OUT_R)
        y = rng.randrange(0, OPEN_BOTTOM)
        if 0 <= x < W and 0 <= y < H and bpx[x, y]:
            px[x, y] = OCHRE_D if rng.random() > 0.5 else EARTH_L

    # outer silhouette dark edge
    outer_edge = ImageChops.subtract(outer, outer.filter(ImageFilter.MinFilter(3)))
    composite_masked(frame_layer, mask_to_layer(outer_edge, INK2), outer_edge)

    # inner rim: light top-left, shadow bottom-right
    inner_rim = ImageChops.subtract(opening, opening.filter(ImageFilter.MinFilter(5)))
    ir_px = inner_rim.load()
    rim_px = frame_layer.load()
    for y in range(H):
        for x in range(W):
            if ir_px[x, y]:
                rim_px[x, y] = OCHRE_L if (x - CX) + (y - HALO_CY) < 70 else EARTH_D

    # double gold band around the opening
    for off, col, width in ((4, OCHRE_L, 2), (8, EARTH_D, 1), (12, OCHRE_D, 1)):
        r = OPEN_R_TOP + off
        d.arc([OPEN_L - off, OPEN_TOP - off, OPEN_R + off, OPEN_TOP + 2 * r], 180, 360, fill=col, width=width)
        d.line([(OPEN_L - off, OPEN_TOP + r), (OPEN_L - off, OPEN_BOTTOM)], fill=col, width=width)
        d.line([(OPEN_R + off, OPEN_TOP + r), (OPEN_R + off, OPEN_BOTTOM)], fill=col, width=width)

    # carved cloud / pearl motifs on the frame
    def cloud(x: int, y: int, s: int) -> None:
        d.arc([x - s, y - s // 2, x, y + s // 2], 90, 270, fill=OCHRE_L)
        d.arc([x, y - s // 2, x + s, y + s // 2], 270, 90, fill=OCHRE_L)
        put(frame_layer, x, y + s // 2, SAND)
        put(frame_layer, x, y - s // 2, EARTH_D)

    for ang in (198, 222, 246, 294, 318, 342):
        rad = math.radians(ang)
        cxp = CX + math.cos(rad) * (OPEN_R_TOP + 15)
        cyp = OPEN_TOP + OPEN_R_TOP + math.sin(rad) * (OPEN_R_TOP + 15)
        if 0 < cxp < W and 0 < cyp < H:
            cloud(int(cxp), int(cyp), 7)
    cloud(CX, 7, 10)

    # small square beam holes around the upper frame (weathered)
    for hx, hy in ((CX - 170, 36), (CX + 168, 34), (CX - 230, 92), (CX + 226, 90), (CX - 92, 26), (CX + 88, 26)):
        d.rectangle([hx, hy, hx + 7, hy + 9], fill=INK2)
        d.line([(hx, hy), (hx + 7, hy)], fill=EARTH_D)
        d.line([(hx + 7, hy), (hx + 7, hy + 9)], fill=OCHRE_D)

    # dithered outer blend into the cliff
    img.alpha_composite(frame_layer)


def draw_interior(img: Image.Image, rng: random.Random) -> None:
    opening = arch_mask(W, H, OPEN_L, OPEN_TOP, OPEN_R, OPEN_BOTTOM)
    inner = canvas(W, H)
    d = ImageDraw.Draw(inner)
    px = inner.load()
    mpx = opening.load()
    noise = noise2(2201, 10, 38)

    # dark cavity, warmer toward the floor
    for y in range(OPEN_TOP, OPEN_BOTTOM):
        t = (y - OPEN_TOP) / (OPEN_BOTTOM - OPEN_TOP)
        for x in range(OPEN_L, OPEN_R):
            if not mpx[x, y]:
                continue
            v = noise[y][x]
            if t < 0.5:
                color = INK2 if v < 0.5 else INK3
            elif t < 0.82:
                color = INK3 if v < 0.7 else INK2
            else:
                color = EARTH_D if v < 0.5 else EARTH
            if t < 0.78 and dither_pick(x, y, v * 0.18):
                color = INK3
            px[x, y] = color

    # warm rim light inside the opening
    inner_rim = ImageChops.subtract(opening, opening.filter(ImageFilter.MinFilter(7)))
    irp = inner_rim.load()
    for y in range(H):
        for x in range(W):
            if irp[x, y]:
                if (x - CX) + (y - HALO_CY) < 50:
                    px[x, y] = EARTH_M if (x + y) % 3 else EARTH_D
                else:
                    px[x, y] = INK

    # carved back-wall rings
    for r in (192, 210, 228):
        d.arc([HALO_CX - r, HALO_CY - r, HALO_CX + r, HALO_CY + r], 0, 360, fill=EARTH_D, width=1)
    for i in range(28):
        ang = i / 28 * math.tau
        x = HALO_CX + math.cos(ang) * 220
        y = HALO_CY + math.sin(ang) * 220
        if 0 <= x < W and 0 <= y < H and mpx[int(x), int(y)]:
            put(inner, int(x), int(y), OCHRE_D)

    # shallow carved niches along the side walls (low contrast, no figures)
    for nx, ny, nw, nh in ((92, 210, 44, 108), (626, 204, 44, 112),
                           (140, 150, 26, 44), (600, 146, 26, 46),
                           (78, 300, 30, 52), (654, 292, 30, 56)):
        d.pieslice([nx, ny, nx + nw, ny + nw], 180, 360, fill=INK)
        d.rectangle([nx, ny + nw // 2, nx + nw, ny + nh], fill=INK)
        d.arc([nx, ny, nx + nw, ny + nw], 180, 360, fill=EARTH_D)
        d.line([(nx, ny + nw // 2), (nx, ny + nh)], fill=EARTH_D)
        d.line([(nx + nw, ny + nw // 2), (nx + nw, ny + nh)], fill=EARTH_D)
        # faint weathered seated figure inside the niche
        fx = nx + nw // 2
        fy = ny + nh - 4
        d.polygon([(fx - 5, fy), (fx + 5, fy), (fx + 4, fy - 12), (fx - 4, fy - 12)],
                  fill=DARK_EARTH)
        d.ellipse([fx - 4, fy - 21, fx + 4, fy - 12], fill=EARTH_D)
        d.arc([fx - 7, fy - 24, fx + 7, fy - 8], 190, 350, fill=EARTH_D)

    # stone floor / platform (mostly hidden by the river in game)
    d.rectangle([OPEN_L + 8, 500, OPEN_R - 8, 548], fill=EARTH_D)
    for row in range(3):
        y = 508 + row * 13
        x = OPEN_L + 10 + row * 5
        while x < OPEN_R - 10:
            w = rng.randrange(34, 70)
            c = EARTH if rng.random() > 0.5 else EARTH_M
            d.rectangle([x, y, min(OPEN_R - 10, x + w), y + 11], fill=c)
            d.line([(x, y), (min(OPEN_R - 10, x + w), y)], fill=OCHRE_D)
            x += w + rng.randrange(2, 6)
    # steps
    for k in range(3):
        d.rectangle([CX - 120 + k * 14, 520 + k * 8, CX + 120 - k * 14, 526 + k * 8], fill=EARTH_L)

    # weathering streaks
    for _ in range(110):
        x = rng.randrange(OPEN_L + 8, OPEN_R - 8)
        y = rng.randrange(OPEN_TOP + 20, 480)
        if not mpx[x, y]:
            continue
        for k in range(rng.randrange(4, 18)):
            if 0 <= y + k < H and mpx[x, y + k]:
                px[x, y + k] = DARK_EARTH if rng.random() > 0.4 else INK

    composite_masked(img, inner, opening)


# ---------------------------------------------------------------------------
# halo
# ---------------------------------------------------------------------------

def draw_halo(img: Image.Image, rng: random.Random) -> None:
    opening = arch_mask(W, H, OPEN_L, OPEN_TOP, OPEN_R, OPEN_BOTTOM)
    layer = canvas(W, H)
    px = layer.load()
    mpx = opening.load()
    d = ImageDraw.Draw(layer)

    cx, cy = HALO_CX, HALO_CY
    # flame tongues around the rim
    for i in range(24):
        ang = i / 24 * math.tau
        for rr in range(HALO_R - 8, HALO_R + 14):
            for da in (-0.026, -0.013, 0.0, 0.013, 0.026):
                x = int(cx + math.cos(ang + da) * rr)
                y = int(cy + math.sin(ang + da) * rr)
                if not (0 <= x < W and 0 <= y < H) or not mpx[x, y]:
                    continue
                inner = rr < HALO_R + 2
                if inner:
                    px[x, y] = OCHRE_D if (x + y) % 3 else EARTH_D
                else:
                    if (i + (rr - HALO_R)) % 4 < 2:
                        px[x, y] = OCHRE if (x + y) % 2 else OCHRE_D

    # carved rings
    for y in range(cy - HALO_R - 4, cy + HALO_R + 4):
        for x in range(cx - HALO_R - 4, cx + HALO_R + 4):
            if not (0 <= x < W and 0 <= y < H) or not mpx[x, y]:
                continue
            r = math.hypot(x - cx, y - cy)
            if 120 <= r < 124:
                px[x, y] = SAND if (x - cx) + (y - cy) < 0 else OCHRE_L
            elif 112 <= r < 115:
                px[x, y] = EARTH_D
            elif 96 <= r < 101:
                px[x, y] = OCHRE_D
            elif 64 <= r < 68:
                px[x, y] = EARTH_D
            elif r < 64:
                px[x, y] = EARTH_D if dither_pick(x, y, 0.12) else INK3

    # carved swirls between rings
    for i in range(16):
        ang = i / 16 * math.tau + 0.15
        rr = 86
        x = cx + math.cos(ang) * rr
        y = cy + math.sin(ang) * rr
        d.arc([x - 8, y - 8, x + 8, y + 8], 20, 210, fill=OCHRE_D, width=2)
    for i in range(12):
        ang = i / 12 * math.tau
        rr = 56
        x = cx + math.cos(ang) * rr
        y = cy + math.sin(ang) * rr
        d.arc([x - 5, y - 5, x + 5, y + 5], 40, 220, fill=EARTH_D, width=1)

    # dark outer edge
    d.arc([cx - HALO_R + 1, cy - HALO_R + 1, cx + HALO_R - 1, cy + HALO_R - 1], 0, 360, fill=INK2, width=1)

    composite_masked(img, layer, opening)


# ---------------------------------------------------------------------------
# Buddha
# ---------------------------------------------------------------------------

FACE_RAMP = [OCHRE_D, OCHRE, OCHRE_L, SAND, SAND_L, CREAM]
BODY_RAMP = [INK4, EARTH_D, EARTH_M, EARTH_L, OCHRE_D, OCHRE, OCHRE_L, SAND]
SIDE_RAMP = [EARTH_D, EARTH_M, EARTH_L, OCHRE_D, OCHRE, OCHRE_L, SAND]


def head_points() -> list[tuple[float, float]]:
    return [
        (48, 0), (61, 2), (72, 6), (81, 12), (87, 20), (90, 30),
        (92, 42), (92, 54), (91, 66), (88, 78), (84, 90), (79, 100),
        (72, 110), (64, 117), (56, 122), (48, 124), (40, 122), (32, 117),
        (24, 110), (17, 100), (12, 90), (8, 78), (6, 66), (6, 54),
        (7, 42), (8, 30), (12, 20), (18, 12), (27, 6), (37, 2),
    ]


def hairline_points() -> list[tuple[float, float]]:
    return [(7, 38), (14, 32), (24, 28), (36, 26), (48, 25), (60, 26), (72, 28), (82, 32), (89, 38)]


CAP_OUTLINE = [(7, 42), (8, 30), (12, 20), (18, 12), (27, 6), (37, 2), (48, 0),
               (61, 2), (72, 6), (81, 12), (87, 20), (90, 30), (92, 42)]


def draw_face(layer: Image.Image, rng: random.Random) -> None:
    left = HEAD_CX - HEAD_W // 2
    top = HEAD_TOP
    pts = [(left + x, top + y) for x, y in head_points()]

    # ears behind the head
    ear = Image.new("L", (W, H), 0)
    ed = ImageDraw.Draw(ear)
    ed.ellipse([left - 8, top + 50, left + 9, top + 108], fill=255)
    ed.ellipse([left + HEAD_W - 9, top + 50, left + HEAD_W + 8, top + 108], fill=255)
    shade_mask(layer, ear, (left - 9, top + 48, left + HEAD_W + 9, top + 110),
               FACE_RAMP,
               lambda x, y: 0.58 - 0.16 * ((x - HEAD_CX) / 48) - 0.08 * ((y - top) / 128),
               noise2(2301, 16, 40), 0.04)
    d = ImageDraw.Draw(layer)
    # ear rims and lobes
    d.arc([left - 6, top + 54, left + 7, top + 98], 70, 285, fill=OCHRE_D, width=2)
    d.arc([left + HEAD_W - 7, top + 54, left + HEAD_W + 6, top + 98], 255, 110, fill=OCHRE_D, width=2)
    d.arc([left - 3, top + 60, left + 4, top + 90], 80, 260, fill=EARTH_D)
    d.arc([left + HEAD_W - 4, top + 60, left + HEAD_W + 3, top + 90], 280, 100, fill=EARTH_D)
    d.line([(left - 4, top + 98), (left + 2, top + 104)], fill=OCHRE_D, width=2)
    d.line([(left + HEAD_W + 4, top + 98), (left + HEAD_W - 2, top + 104)], fill=OCHRE_D, width=2)
    put(layer, left - 2, top + 104, SAND_L)
    put(layer, left + HEAD_W + 2, top + 104, SAND_L)

    # face base
    face_mask = Image.new("L", (W, H), 0)
    fm = ImageDraw.Draw(face_mask)
    fm.polygon(pts, fill=255)
    noise = noise2(2302, 15, 44)

    def face_light(x, y):
        nx = (x - HEAD_CX) / 48.0
        ny = (y - top) / 128.0
        light = 0.60 - 0.34 * nx - 0.12 * ny
        light += 0.17 * gauss(nx + 0.10, ny - 0.18, 0.05)
        light += 0.13 * gauss(nx + 0.30, ny - 0.50, 0.035)
        light += 0.16 * gauss(nx, ny - 0.40, 0.012)
        light += 0.08 * gauss(nx - 0.05, ny - 0.78, 0.02)
        light -= 0.16 * gauss(nx, ny - 0.98, 0.015)
        light -= 0.09 * gauss(nx - 0.55, ny - 0.45, 0.05)
        light -= 0.06 * gauss(nx + 0.30, ny - 0.72, 0.03)
        return light

    shade_mask(layer, face_mask, (left - 2, top - 2, left + HEAD_W + 2, top + HEAD_H + 2),
               FACE_RAMP, face_light, noise, 0.045)

    # selective outer silhouette
    edge = outline_mask(face_mask)
    epx = edge.load()
    fpx = layer.load()
    for y in range(top - 2, top + HEAD_H + 3):
        for x in range(left - 2, left + HEAD_W + 3):
            if 0 <= x < W and 0 <= y < H and epx[x, y]:
                fpx[x, y] = INK3 if (x - HEAD_CX) + (y - (top + 60)) > 0 else EARTH_D

    # hair cap
    hair = Image.new("L", (W, H), 0)
    hd = ImageDraw.Draw(hair)
    cap = [(left + x, top + y) for x, y in CAP_OUTLINE]
    hairline = [(left + x, top + y) for x, y in hairline_points()]
    hd.polygon(cap + list(reversed(hairline)), fill=255)
    hpx = hair.load()
    hair_px = layer.load()
    for y in range(top, top + 46):
        for x in range(left, left + HEAD_W):
            if hpx[x, y]:
                hair_px[x, y] = EARTH_D if (x * 3 + y * 5) % 7 else INK3

    # dense 螺髻 coils: staggered 3x2 bumps
    for row, yy in enumerate((6, 11, 16, 21, 26, 31, 36)):
        for i in range(-9, 10):
            xx = HEAD_CX + i * 5 + (2 if row % 2 else 0)
            if not (0 <= xx < W and 0 <= top + yy + 2 < H):
                continue
            if not (hpx[xx, top + yy] or hpx[xx, top + yy + 1]):
                continue
            d.ellipse([xx - 2, top + yy - 1, xx + 2, top + yy + 2], fill=INK3)
            put(layer, xx - 1, top + yy - 1, OCHRE_D)
            put(layer, xx + 1, top + yy + 2, INK2)
    # hairline band
    d.line(hairline, fill=OCHRE_L)
    d.line([(x, y + 2) for x, y in hairline], fill=OCHRE_D)
    d.line([(x, y + 3) for x, y in hairline], fill=EARTH_D)

    # brow ridge shadow
    d.line([(left + 12, top + 47), (left + 26, top + 42), (left + 42, top + 44)], fill=OCHRE_D, width=2)
    d.line([(left + 54, top + 44), (left + 70, top + 42), (left + 84, top + 47)], fill=OCHRE_D, width=2)

    # brows: tapered 3px at the inner end, 2px at the outer
    d.line([(left + 15, top + 47), (left + 24, top + 43), (left + 34, top + 43), (left + 42, top + 46)], fill=EARTH_D, width=3)
    d.line([(left + 54, top + 46), (left + 62, top + 43), (left + 72, top + 43), (left + 81, top + 47)], fill=EARTH_D, width=3)
    d.line([(left + 17, top + 44), (left + 26, top + 40), (left + 36, top + 40), (left + 42, top + 43)], fill=SAND_L)
    d.line([(left + 54, top + 43), (left + 60, top + 40), (left + 70, top + 40), (left + 79, top + 44)], fill=SAND_L)

    # eye sockets
    d.line([(left + 17, top + 53), (left + 28, top + 51), (left + 41, top + 53)], fill=OCHRE_D, width=2)
    d.line([(left + 55, top + 53), (left + 68, top + 51), (left + 79, top + 53)], fill=OCHRE_D, width=2)

    # eyes: almond, downcast
    d.line([(left + 19, top + 60), (left + 27, top + 57), (left + 35, top + 58), (left + 41, top + 61)], fill=INK3, width=2)
    d.line([(left + 55, top + 61), (left + 61, top + 58), (left + 69, top + 57), (left + 77, top + 60)], fill=INK3, width=2)
    d.line([(left + 20, top + 64), (left + 28, top + 66), (left + 40, top + 64)], fill=OCHRE_D)
    d.line([(left + 56, top + 64), (left + 68, top + 66), (left + 76, top + 64)], fill=OCHRE_D)
    d.line([(left + 21, top + 65), (left + 28, top + 67), (left + 39, top + 65)], fill=SAND_L)
    d.line([(left + 57, top + 65), (left + 68, top + 67), (left + 75, top + 65)], fill=SAND_L)
    # iris slits, mostly hidden by the lids
    d.line([(left + 27, top + 60), (left + 31, top + 61)], fill=INK, width=2)
    d.line([(left + 65, top + 61), (left + 69, top + 60)], fill=INK, width=2)
    put(layer, left + 20, top + 61, VERMILION_D)
    put(layer, left + 76, top + 61, VERMILION_D)

    # nose
    d.line([(left + 46, top + 40), (left + 46, top + 78)], fill=SAND_L, width=2)
    d.line([(left + 49, top + 42), (left + 49, top + 80)], fill=OCHRE_D)
    d.line([(left + 44, top + 80), (left + 48, top + 84), (left + 52, top + 80)], fill=SAND_L, width=2)
    d.line([(left + 40, top + 84), (left + 48, top + 86), (left + 56, top + 84)], fill=OCHRE_D)
    d.line([(left + 41, top + 86), (left + 55, top + 86)], fill=EARTH_D)
    put(layer, left + 42, top + 85, INK3)
    put(layer, left + 54, top + 85, INK3)
    d.line([(left + 38, top + 78), (left + 40, top + 84)], fill=OCHRE_D)
    d.line([(left + 56, top + 78), (left + 54, top + 84)], fill=OCHRE_D)

    # mouth: full lower lip, slight smile
    d.line([(left + 34, top + 92), (left + 40, top + 90), (left + 44, top + 91), (left + 48, top + 90),
            (left + 52, top + 91), (left + 56, top + 90), (left + 62, top + 92)], fill=INK3, width=2)
    d.line([(left + 38, top + 95), (left + 48, top + 97), (left + 58, top + 95)], fill=SAND_L, width=3)
    d.line([(left + 38, top + 99), (left + 48, top + 100), (left + 58, top + 99)], fill=OCHRE_D)
    d.line([(left + 33, top + 93), (left + 35, top + 96)], fill=OCHRE_D)
    d.line([(left + 61, top + 93), (left + 59, top + 96)], fill=OCHRE_D)
    put(layer, left + 47, top + 87, OCHRE_D)
    put(layer, left + 49, top + 87, OCHRE_D)

    # chin / jaw
    d.arc([left + 28, top + 100, left + 68, top + 119], 15, 165, fill=OCHRE_D)
    d.line([(left + 42, top + 109), (left + 54, top + 109)], fill=SAND_L, width=2)
    d.arc([left + 24, top + 112, left + 72, top + 124], 20, 160, fill=OCHRE_D)
    d.line([(left + 14, top + 92), (left + 20, top + 104)], fill=OCHRE_D)
    d.line([(left + 82, top + 92), (left + 76, top + 104)], fill=OCHRE_D)

    # urna
    put(layer, left + 48, top + 31, VERMILION_D)
    put(layer, left + 48, top + 30, SAND_L)


def draw_neck(layer: Image.Image) -> None:
    left = HEAD_CX - 22
    top = HEAD_TOP + HEAD_H - 12
    bottom = BODY_TOP + 30
    mask = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(mask)
    d.rectangle([left, top, left + 44, bottom], fill=255)
    shade_mask(layer, mask, (left, top, left + 44, bottom), FACE_RAMP,
               lambda x, y: 0.56 - 0.24 * ((x - HEAD_CX) / 22) - 0.05 * ((y - top) / 42),
               noise2(2401, 18, 42), 0.035)
    d = ImageDraw.Draw(layer)
    for k in range(3):
        y = top + 14 + k * 8
        d.arc([left + 2, y - 5, left + 42, y + 7], 10, 170, fill=OCHRE_D)
    d.line([(left, top), (left, top + 16)], fill=EARTH_D)
    d.line([(left + 44, top), (left + 44, top + 16)], fill=EARTH_D)
    # collar shadow
    d.line([(left - 4, top + 26), (left + 22, top + 34), (left + 48, top + 26)], fill=EARTH_D, width=2)


def draw_body(layer: Image.Image, rng: random.Random) -> None:
    left = CX - 122
    right = CX + 122
    top = BODY_TOP
    bottom = BODY_BOTTOM
    mask = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(mask)
    pts = [
        (CX - 75, top + 18), (CX - 62, top + 8), (CX - 42, top + 3),
        (CX - 20, top + 1), (CX + 20, top + 1), (CX + 42, top + 3),
        (CX + 62, top + 8), (CX + 75, top + 18), (CX + 92, top + 44),
        (CX + 102, top + 86), (CX + 112, top + 122), (CX + 120, bottom),
        (CX - 120, bottom), (CX - 112, top + 122), (CX - 102, top + 86),
        (CX - 92, top + 44),
    ]
    d.polygon(pts, fill=255)
    noise = noise2(2501, 14, 40)

    def body_light(x, y):
        nx = (x - CX) / 122.0
        ny = (y - top) / (bottom - top)
        light = 0.56 - 0.28 * nx - 0.06 * ny
        light += 0.10 * gauss(nx + 0.58, ny - 0.16, 0.05)
        light += 0.08 * gauss(nx - 0.58, ny - 0.16, 0.05)
        light += 0.07 * gauss(nx, ny - 0.22, 0.07)
        light -= 0.06 * gauss(nx, ny - 0.65, 0.10)
        return light

    shade_mask(layer, mask, (left, top, right, bottom), BODY_RAMP, body_light, noise, 0.05)

    # outline, selective
    om = outline_mask(mask)
    px = layer.load()
    opx = om.load()
    for y in range(top - 1, bottom + 1):
        for x in range(left - 1, right + 1):
            if 0 <= x < W and 0 <= y < H and opx[x, y]:
                px[x, y] = INK3 if (x - CX) + (y - top) > 80 else EARTH_D

    d = ImageDraw.Draw(layer)

    # collar / inner robe
    d.polygon([(CX - 36, top + 12), (CX, top + 48), (CX + 36, top + 12), (CX, top + 28)], fill=EARTH_D)
    d.line([(CX - 36, top + 12), (CX, top + 48), (CX + 36, top + 12)], fill=OCHRE_L, width=2)
    d.line([(CX - 31, top + 16), (CX, top + 44), (CX + 31, top + 16)], fill=EARTH_D)
    d.line([(CX - 20, top + 22), (CX, top + 36), (CX + 20, top + 22)], fill=OCHRE_D)

    # deep U folds
    folds = ((top + 32, 58, 26), (top + 54, 68, 28), (top + 76, 78, 30), (top + 98, 88, 32), (top + 118, 100, 31))
    for cy, rx, ry in folds:
        d.arc([CX - rx, cy - ry, CX + rx, cy + ry], 0, 180, fill=EARTH_D, width=3)
        d.arc([CX - rx + 1, cy - ry - 3, CX + rx - 1, cy + ry - 3], 0, 180, fill=OCHRE_L)
        d.arc([CX - rx - 2, cy - ry + 3, CX + rx + 2, cy + ry + 3], 0, 180, fill=OCHRE_D)
    # side folds on the outer robe
    for side in (-1, 1):
        for k in range(3):
            x = CX + side * (78 + k * 7)
            d.line([(x, top + 28 + k * 7), (x + side * 8, bottom - 8)], fill=EARTH_D)
            d.line([(x + side, top + 30 + k * 7), (x + side * 8, bottom - 10)], fill=OCHRE_D)

    # sleeves / arms
    for side in (-1, 1):
        ax = CX + side * 96
        arm_mask = Image.new("L", (W, H), 0)
        ad = ImageDraw.Draw(arm_mask)
        ad.ellipse([ax - 30, top + 34, ax + 30, bottom - 6], fill=255)
        shade_mask(layer, arm_mask, (ax - 31, top + 32, ax + 31, bottom - 4), BODY_RAMP,
                   lambda x, y, s=side: 0.50 - 0.20 * ((x - CX) / 122) + 0.05 * (s * (y - top) / (bottom - top)),
                   noise2(2600 + side, 18, 36), 0.045)
        d = ImageDraw.Draw(layer)
        for k in range(3):
            fx = ax - side * 12 + k * side * 7
            d.line([(fx, top + 46), (fx + side * 4, bottom - 20)], fill=OCHRE_D)
        # eroded hand
        hx = ax + side * 4
        d.rectangle([hx - 13, bottom - 48, hx + 13, bottom - 26], fill=OCHRE_D)
        d.line([(hx - 11, bottom - 46), (hx - 2, bottom - 36)], fill=EARTH_D)
        d.line([(hx + 5, bottom - 46), (hx + 11, bottom - 38)], fill=EARTH_D)
        d.line([(hx - 13, bottom - 30), (hx + 13, bottom - 30)], fill=EARTH_D)
        put(layer, hx - 5, bottom - 33, SAND_L)
        put(layer, hx + 6, bottom - 34, SAND_L)

    # lap
    d.polygon([(CX - 124, bottom - 4), (CX - 96, bottom - 26), (CX + 96, bottom - 26), (CX + 124, bottom - 4)], fill=EARTH_L)
    for k in range(3):
        d.arc([CX - 96 + k * 9, bottom - 36 + k * 5, CX + 96 - k * 9, bottom - 2 + k * 5], 0, 180, fill=OCHRE_D)

    # weathering cracks / chips
    for _ in range(34):
        x = rng.randrange(CX - 100, CX + 100)
        y = rng.randrange(top + 30, bottom - 12)
        for k in range(rng.randrange(3, 11)):
            if 0 <= x < W and 0 <= y < H:
                put(layer, x, y, EARTH_D if rng.random() > 0.35 else INK3)
            x += rng.choice((-1, 0, 1))
            y += 1


# ---------------------------------------------------------------------------
# Attendants
# ---------------------------------------------------------------------------

def draw_attendant(layer: Image.Image, cx: int, base: int, scale: float, bodhisattva: bool, rng: random.Random) -> None:
    s = scale
    head_r = int(15 * s)
    head_cy = base - int(78 * s)
    body_top = head_cy + head_r - 2
    noise = noise2(2700 + cx, 16, 34)
    d = ImageDraw.Draw(layer)

    # carved nimbus: two rings plus flame ticks
    hr = int(35 * s)
    d.ellipse([cx - hr, head_cy - hr, cx + hr, head_cy + hr], outline=EARTH_D, width=2)
    d.ellipse([cx - hr + 3, head_cy - hr + 3, cx + hr - 3, head_cy + hr - 3], outline=OCHRE_D)
    d.ellipse([cx - hr + 6, head_cy - hr + 6, cx + hr - 6, head_cy + hr - 6], outline=EARTH_D)
    for i in range(16):
        ang = i / 16 * math.tau
        x = int(cx + math.cos(ang) * (hr - 1))
        y = int(head_cy + math.sin(ang) * (hr - 1))
        put(layer, x, y, OCHRE_L if i % 2 else OCHRE)
    d.arc([cx - hr + 8, head_cy - hr + 8, cx + hr - 8, head_cy + hr - 8], 200, 260, fill=OCHRE_L)

    # body: shoulders, waist, flared hem
    sh = int(16 * s)
    waist = int(13 * s)
    hem = int(24 * s)
    hips = base - int(28 * s)
    body_mask = Image.new("L", (W, H), 0)
    bd = ImageDraw.Draw(body_mask)
    bd.polygon([
        (cx - sh, body_top + 2), (cx - int(sh * 0.55), body_top),
        (cx + int(sh * 0.55), body_top), (cx + sh, body_top + 2),
        (cx + sh - 2, body_top + int(16 * s)),
        (cx + waist, hips), (cx + hem, base - int(3 * s)),
        (cx - hem, base - int(3 * s)), (cx - waist, hips),
        (cx - sh + 2, body_top + int(16 * s)),
    ], fill=255)
    shade_mask(layer, body_mask, (cx - hem - 2, body_top - 1, cx + hem + 2, base),
               SIDE_RAMP,
               lambda x, y: 0.56 - 0.24 * ((x - cx) / max(1, hem)) - 0.10 * ((y - body_top) / max(1, base - body_top)),
               noise, 0.045)
    d = ImageDraw.Draw(layer)
    px = layer.load()
    bpx = body_mask.load()

    # drapery: diagonal fold bands
    for k in range(5):
        y0 = body_top + int((6 + k * 9) * s)
        x0 = cx - (sh - 2) + k * 2
        x1 = cx + waist - k
        d.line([(x0, y0), (x0 + int(8 * s), y0 + int(5 * s)), (x1, y0 + int(9 * s))],
               fill=EARTH_D)
        d.line([(x0, y0 + 2), (x0 + int(8 * s), y0 + int(7 * s)), (x1, y0 + int(11 * s))],
               fill=OCHRE_D)
    # hem shadow
    d.line([(cx - hem, base - int(4 * s)), (cx, base - int(2 * s)), (cx + hem, base - int(4 * s))],
           fill=EARTH_D, width=2)

    # clasped hands
    hw = int(5 * s)
    d.rectangle([cx - hw, body_top + int(15 * s), cx + hw, body_top + int(23 * s)], fill=OCHRE_L)
    d.line([(cx - hw, body_top + int(19 * s)), (cx + hw, body_top + int(19 * s))], fill=OCHRE_D)
    d.line([(cx - hw + 1, body_top + int(16 * s)), (cx + hw - 1, body_top + int(16 * s))], fill=SAND)

    # neck
    d.rectangle([cx - int(4 * s), head_cy + head_r - 4, cx + int(4 * s), body_top + 3], fill=OCHRE)
    d.line([(cx - int(4 * s), head_cy + head_r + int(2 * s)), (cx - int(4 * s), body_top + 2)], fill=OCHRE_D)

    # head: 3-tone face
    head_mask = Image.new("L", (W, H), 0)
    hd = ImageDraw.Draw(head_mask)
    hd.ellipse([cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r], fill=255)
    shade_mask(layer, head_mask, (cx - head_r - 1, head_cy - head_r - 1, cx + head_r + 1, head_cy + head_r + 1),
               [OCHRE_D, OCHRE, OCHRE_L, SAND, SAND_L],
               lambda x, y: 0.68 - 0.22 * ((x - cx) / max(1, head_r)) - 0.10 * ((y - head_cy) / max(1, head_r)),
               noise, 0.035)
    d = ImageDraw.Draw(layer)

    # face features
    eye_y = head_cy - int(2 * s)
    d.line([(cx - head_r + int(4 * s), eye_y), (cx - int(3 * s), eye_y + 1)], fill=INK3, width=2)
    d.line([(cx + int(3 * s), eye_y + 1), (cx + head_r - int(4 * s), eye_y)], fill=INK3, width=2)
    d.line([(cx - head_r + int(5 * s), eye_y - int(3 * s)), (cx - int(4 * s), eye_y - int(4 * s))], fill=EARTH_D)
    d.line([(cx + int(4 * s), eye_y - int(4 * s)), (cx + head_r - int(5 * s), eye_y - int(3 * s))], fill=EARTH_D)
    d.line([(cx - 1, eye_y + int(2 * s)), (cx - 1, eye_y + int(5 * s))], fill=OCHRE_D)
    d.line([(cx - int(3 * s), eye_y + int(8 * s)), (cx + int(3 * s), eye_y + int(8 * s))], fill=VERMILION_D)
    d.arc([cx - int(9 * s), head_cy + int(2 * s), cx + int(9 * s), head_cy + int(13 * s)], 20, 160, fill=OCHRE_D)
    # ears
    d.ellipse([cx - head_r - int(3 * s), head_cy - int(2 * s), cx - head_r + int(2 * s), head_cy + int(8 * s)], fill=OCHRE_D)
    d.ellipse([cx + head_r - int(2 * s), head_cy - int(2 * s), cx + head_r + int(3 * s), head_cy + int(8 * s)], fill=OCHRE_D)

    if bodhisattva:
        # low 3-point crown with a red band
        crown_y = head_cy - head_r + int(3 * s)
        d.rectangle([cx - int(9 * s), crown_y - 1, cx + int(9 * s), crown_y + 1], fill=OCHRE_L)
        for px_ in (cx - int(7 * s), cx, cx + int(7 * s)):
            d.polygon([(px_ - int(2 * s), crown_y - 1), (px_, crown_y - int(5 * s)),
                       (px_ + int(2 * s), crown_y - 1)], fill=OCHRE_L)
        d.line([(cx - int(9 * s), crown_y + 2), (cx + int(9 * s), crown_y + 2)], fill=VERMILION_D)
        put(layer, cx, crown_y - int(5 * s), VERMILION_D)
        d.line([(cx - sh, body_top + int(14 * s)), (cx, body_top + int(24 * s)),
                (cx + sh, body_top + int(14 * s))], fill=VERMILION_D, width=2)
        d.line([(cx - sh + 1, body_top + int(16 * s)), (cx, body_top + int(26 * s))], fill=GREEN_M)
    else:
        # monk: tonsure line + simple kasaya collar
        d.arc([cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r], 195, 345, fill=OCHRE_D)
        d.arc([cx - head_r + 1, head_cy - head_r + 1, cx + head_r - 1, head_cy + head_r - 1], 205, 335, fill=EARTH_D)
        d.line([(cx - sh, body_top + int(3 * s)), (cx, body_top + int(13 * s)),
                (cx + sh, body_top + int(3 * s))], fill=OCHRE_L, width=2)
        d.line([(cx - sh + 1, body_top + int(5 * s)), (cx, body_top + int(15 * s))], fill=EARTH_D)


def draw_lower_body(layer: Image.Image, rng: random.Random) -> None:
    """Robe base behind the photo-guided sprite; fills the waterline seam."""
    d = ImageDraw.Draw(layer)
    left, right = CX - 122, CX + 122
    top, bottom = 280, BODY_BOTTOM
    d.polygon([(left + 10, top), (right - 10, top), (right + 12, bottom), (left - 12, bottom)], fill=OCHRE_L)
    for k in range(3):
        cy = top + 12 + k * 12
        d.arc([left + 10, cy - 12, right - 10, cy + 12], 0, 180, fill=EARTH_M)
        d.arc([left + 12, cy - 14, right - 12, cy + 10], 0, 180, fill=SAND)


def draw_eroded_base(layer: Image.Image, rng: random.Random) -> None:
    """Weathered rock mass under the seated figure (the lower body is eroded)."""
    top, bottom = 332, 502
    base_mask = Image.new("L", (W, H), 0)
    bmd = ImageDraw.Draw(base_mask)
    for y in range(top, bottom + 1):
        t = (y - top) / (bottom - top)
        half = int(108 + 46 * t
                   + 10 * math.sin(y * 0.19 + 0.7)
                   + 7 * math.sin(y * 0.061 + 2.1)
                   + 4 * math.sin(y * 0.43 + 1.1))
        bmd.line([(CX - half, y), (CX + half, y)], fill=255)
    # rubble lumps at the feet
    for ex, ey, rx, ry in ((CX - 146, 470, 26, 18), (CX + 142, 462, 30, 20),
                           (CX - 126, 492, 22, 14), (CX + 124, 494, 24, 15)):
        bmd.ellipse([ex - rx, ey - ry, ex + rx, ey + ry], fill=255)
    bpx = base_mask.load()
    px = layer.load()
    noise = noise2(2801, 12, 34)

    for y in range(top, bottom + 1):
        for x in range(CX - 170, CX + 170):
            if not (0 <= x < W and 0 <= y < H and bpx[x, y]):
                continue
            v = noise[y][x] + 0.12 * math.sin(y * 0.21 + x * 0.03)
            if v < 0.30:
                color = DARK_EARTH
            elif v < 0.52:
                color = EARTH_D
            elif v < 0.74:
                color = EARTH
            else:
                color = EARTH_M
            # deeper shadow where the robe meets the rock
            if y < 392 and abs(x - CX) < 112:
                color = EARTH_D if v < 0.62 else EARTH
            if dither_pick(x, y, ((v * 6) % 1.0) * 0.5):
                color = EARTH_M if v > 0.45 else EARTH_D
            px[x, y] = color

    d = ImageDraw.Draw(layer)

    # rough strata
    for yy in range(top + 10, bottom, 15):
        x = CX - 170
        while x < CX + 170:
            step = rng.randrange(20, 58)
            if 0 <= yy < H and 0 <= x < W and bpx[x, yy]:
                d.line([(x, yy), (min(W - 1, x + step), yy + rng.randrange(-2, 3))],
                       fill=DARK_EARTH)
            x += step + rng.randrange(4, 18)

    # cracks and broken pockets
    for _ in range(52):
        x = rng.randrange(CX - 160, CX + 160)
        y = rng.randrange(top, bottom - 6)
        for _ in range(rng.randrange(4, 14)):
            if 0 <= x < W and 0 <= y < H and bpx[x, y]:
                px[x, y] = INK3 if rng.random() > 0.4 else DARK_EARTH
            x += rng.choice((-1, 0, 0, 1))
            y += 1
    for _ in range(80):
        x = rng.randrange(CX - 158, CX + 159)
        y = rng.randrange(top + 18, bottom - 4)
        if 0 <= x < W and 0 <= y < H and bpx[x, y]:
            px[x, y] = OCHRE_D if rng.random() > 0.45 else EARTH_M

    # outer edge: darker on the shadow side
    for y in range(top, bottom + 1):
        for x in range(CX - 170, CX + 170):
            if not (0 <= x < W and 0 <= y < H and bpx[x, y]):
                continue
            if not bpx[x - 1, y] or not bpx[x + 1, y]:
                px[x, y] = INK3 if x > CX else EARTH_D


def draw_hem_shadow(layer: Image.Image, buddha: Image.Image, rng: random.Random) -> None:
    """Cast shadow under the robe hem so it sits on the rock."""
    offx, offy = CX - 123, 38
    bpx = buddha.load()
    px = layer.load()
    for sx in range(buddha.width):
        low = -1
        for sy in range(buddha.height - 1, 0, -1):
            if bpx[sx, sy][3]:
                low = sy
                break
        if low < 0:
            continue
        x = offx + sx
        for k in range(1, 5):
            y = offy + low + k
            if 0 <= x < W and 0 <= y < H and dither_pick(x, y, 0.75 - k * 0.13):
                px[x, y] = INK3 if k <= 2 else EARTH_D


def draw_figures(img: Image.Image, rng: random.Random) -> None:
    opening = arch_mask(W, H, OPEN_L, OPEN_TOP, OPEN_R, OPEN_BOTTOM)
    layer = canvas(W, H)

    # outer guardians (天王/力士), lower contrast than the central figure
    for gx in (106, 662):
        d = ImageDraw.Draw(layer)
        d.ellipse([gx - 30, 190, gx + 30, 250], outline=EARTH_D, width=2)
        d.arc([gx - 27, 193, gx + 27, 247], 200, 340, fill=OCHRE_D)
        # shoulders and torso
        d.polygon([(gx - 12, 244), (gx + 12, 244), (gx + 22, 258),
                   (gx + 24, 286), (gx + 20, 330), (gx - 20, 330),
                   (gx - 24, 286), (gx - 22, 258)], fill=EARTH_M)
        d.polygon([(gx - 12, 244), (gx - 4, 244), (gx - 6, 330), (gx - 20, 330),
                   (gx - 24, 286), (gx - 22, 258)], fill=EARTH_L)
        d.polygon([(gx + 8, 245), (gx + 12, 244), (gx + 22, 258), (gx + 24, 286),
                   (gx + 20, 330), (gx + 12, 330)], fill=EARTH_D)
        # raised outer arm
        ax = gx + (18 if gx < CX else -18)
        d.line([(ax, 258), (ax + (6 if gx < CX else -6), 232)], fill=EARTH_L, width=6)
        d.ellipse([ax + (2 if gx < CX else -10), 224, ax + (10 if gx < CX else -2), 238], fill=OCHRE)
        # head
        d.ellipse([gx - 12, 206, gx + 12, 240], fill=OCHRE)
        d.arc([gx - 12, 206, gx + 12, 240], 100, 260, fill=EARTH_D)
        d.line([(gx - 9, 218), (gx - 3, 219)], fill=INK3, width=2)
        d.line([(gx + 3, 219), (gx + 9, 218)], fill=INK3, width=2)
        d.line([(gx - 2, 222), (gx + 2, 222)], fill=OCHRE_D)
        d.line([(gx - 5, 230), (gx + 5, 230)], fill=VERMILION_D, width=2)
        # crown band
        d.rectangle([gx - 11, 205, gx + 11, 208], fill=OCHRE_L)
        d.line([(gx - 11, 208), (gx + 11, 208)], fill=VERMILION_D)
        d.line([(gx - 14, 244), (gx + 14, 244)], fill=DARK_EARTH)

    draw_attendant(layer, 190, 326, 1.0, False, rng)
    draw_attendant(layer, 578, 324, 1.03, True, rng)

    # eroded rock base first, the robe hem overlaps it
    draw_eroded_base(layer, rng)

    buddha = build_buddha_sprite()
    layer.paste(buddha, (CX - 123, 38), buddha)
    draw_hem_shadow(layer, buddha, rng)

    composite_masked(img, layer, opening)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def bg_fengxian_niche() -> Image.Image:
    img = canvas(W, H)
    rng = random.Random(20261118)
    draw_interior(img, rng)
    draw_halo(img, rng)
    draw_figures(img, rng)
    draw_frame(img, rng)
    return img


def main() -> None:
    img = bg_fengxian_niche()
    save(img, "backgrounds", "bg_fengxian_niche")
    print("[backgrounds] bg_fengxian_niche", img.size)


if __name__ == "__main__":
    main()
