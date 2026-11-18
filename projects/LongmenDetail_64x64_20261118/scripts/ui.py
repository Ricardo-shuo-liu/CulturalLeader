"""UI kit for LongmenDetail — markers, 9-slice panel, spot icons, tools, banner.

All assets are hard-edged, palette-locked (spec_lock.md InkGongbi48), and drawn
at their declared sizes. No runtime geometry is required by these PNGs.
"""

from __future__ import annotations

import math
import random

from PIL import Image, ImageDraw

from gen_lib import (
    canvas, save, put, dither_pick,
    INK, INK2, INK3, INK4, DARK_EARTH, EARTH_D, EARTH, EARTH_M, EARTH_L,
    OCHRE_D, OCHRE, OCHRE_L, SAND, SAND_L, CREAM,
    GREEN_D, GREEN_DD, GREEN, GREEN_M, GREEN_L,
    WATER_D, WATER, WATER_L,
    SUNSET_L, SUN_GOLD, SUN_LIGHT,
    VERMILION, VERMILION_D,
)

PROJECT_SHEETS = None


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


# ---------------------------------------------------------------------------
# marker: stone lantern with a warm core
# ---------------------------------------------------------------------------

def draw_lantern(lit: bool, frame: int, done: bool = False) -> Image.Image:
    img = canvas(32, 56)
    d = ImageDraw.Draw(img)
    dy = -1 if frame else 0

    # base plinth
    d.rectangle([5, 44 + dy, 26, 50 + dy], fill=INK)
    d.rectangle([6, 44 + dy, 25, 49 + dy], fill=EARTH_M)
    d.line([(6, 44 + dy), (25, 44 + dy)], fill=EARTH_L)
    d.line([(6, 49 + dy), (25, 49 + dy)], fill=EARTH_D)
    d.rectangle([3, 50 + dy, 28, 52 + dy], fill=INK)
    d.rectangle([4, 50 + dy, 27, 51 + dy], fill=EARTH_D)

    # pillar
    d.rectangle([12, 27 + dy, 19, 44 + dy], fill=INK)
    d.rectangle([13, 27 + dy, 18, 44 + dy], fill=EARTH)
    d.line([(13, 28 + dy), (13, 43 + dy)], fill=EARTH_L)
    d.line([(17, 28 + dy), (17, 43 + dy)], fill=EARTH_D)
    d.line([(14, 32 + dy), (16, 32 + dy)], fill=OCHRE_D)
    d.line([(14, 38 + dy), (16, 38 + dy)], fill=OCHRE_D)

    # light chamber
    d.rectangle([8, 14 + dy, 23, 27 + dy], fill=INK)
    d.rectangle([9, 15 + dy, 22, 26 + dy], fill=EARTH_D)
    d.rectangle([10, 16 + dy, 21, 25 + dy], fill=INK3)
    # golden frame
    d.line([(9, 15 + dy), (22, 15 + dy)], fill=OCHRE_D)
    d.line([(9, 26 + dy), (22, 26 + dy)], fill=EARTH_D)
    d.line([(9, 16 + dy), (9, 25 + dy)], fill=OCHRE_L)
    d.line([(22, 16 + dy), (22, 25 + dy)], fill=EARTH_D)

    # core + glow
    if lit:
        core = SUN_GOLD if frame == 0 else SUN_LIGHT
        core_hi = SUN_LIGHT if frame == 0 else CREAM
        d.rectangle([13, 18 + dy, 18, 23 + dy], fill=core)
        d.rectangle([14, 19 + dy, 17, 22 + dy], fill=core_hi)
        glow = OCHRE if frame == 0 else OCHRE_L
        for yy in range(17, 25):
            for xx in range(12, 20):
                if 13 <= xx <= 18 and 18 <= yy <= 23:
                    continue
                if dither_pick(xx, yy, 0.55 if frame == 0 else 0.72):
                    put(img, xx, yy + dy, glow)
        if frame == 1:
            for xx in (12, 19):
                put(img, xx, 17 + dy, SAND)
    else:
        d.rectangle([13, 18 + dy, 18, 23 + dy], fill=INK3)
        d.rectangle([14, 19 + dy, 17, 22 + dy], fill=INK2)
        d.line([(14, 19 + dy), (17, 19 + dy)], fill=EARTH_D)

    # roof: upturned eaves
    d.polygon([(3, 14 + dy), (5, 9 + dy), (10, 8 + dy), (22, 8 + dy), (27, 9 + dy), (29, 14 + dy)],
              fill=INK)
    d.polygon([(5, 13 + dy), (6, 10 + dy), (10, 9 + dy), (22, 9 + dy), (26, 10 + dy), (27, 13 + dy)],
              fill=EARTH_D)
    d.line([(6, 10 + dy), (26, 10 + dy)], fill=OCHRE_D)
    d.line([(10, 9 + dy), (22, 9 + dy)], fill=OCHRE)
    d.line([(4, 13 + dy), (28, 13 + dy)], fill=EARTH_M)
    # eave tips
    put(img, 3, 13 + dy, OCHRE)
    put(img, 28, 13 + dy, OCHRE)

    # finial
    d.rectangle([14, 5 + dy, 17, 8 + dy], fill=INK)
    d.rectangle([15, 5 + dy, 16, 7 + dy], fill=OCHRE)
    d.line([(14, 5 + dy), (17, 5 + dy)], fill=OCHRE_L)

    if done:
        # vermilion seal stamped on the base
        d.rectangle([17, 36 + dy, 27, 46 + dy], fill=VERMILION)
        d.rectangle([18, 37 + dy, 26, 45 + dy], fill=VERMILION_D)
        d.rectangle([19, 38 + dy, 25, 44 + dy], fill=VERMILION)
        # negative gate glyph
        d.line([(20, 39 + dy), (20, 43 + dy), (24, 43 + dy), (24, 39 + dy)], fill=SAND_L)
        d.line([(20, 41 + dy), (24, 41 + dy)], fill=SAND_L)
        put(img, 22, 37 + dy, SAND_L)
    return img


def ui_marker_spot() -> None:
    frames = [draw_lantern(True, 0), draw_lantern(True, 1)]
    for i, f in enumerate(frames):
        save(f, "ui", f"ui_marker_spot_idle_{i}")
    sheet = Image.new("RGBA", (64, 56), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * 32, 0), f)
    sheet.save(Path_sheets() / "ui_marker_spot_idle_32x56.png", "PNG")
    print("[ui] ui_marker_spot: 2 frames")


def Path_sheets():
    from gen_lib import PROJECT
    return PROJECT / "sheets"


def ui_marker_spot_done() -> None:
    img = draw_lantern(False, 0, done=True)
    save(img, "ui", "ui_marker_spot_done")
    print("[ui] ui_marker_spot_done")


# ---------------------------------------------------------------------------
# 9-slice panel
# ---------------------------------------------------------------------------

def ui_panel_9slice_v2() -> None:
    img = canvas(64, 64)
    d = ImageDraw.Draw(img)
    # dark ink ground
    d.rectangle([0, 0, 63, 63], fill=INK)
    # double gold border
    d.rectangle([3, 3, 60, 60], fill=OCHRE_D)
    d.rectangle([5, 5, 58, 58], fill=INK3)
    d.rectangle([7, 7, 56, 56], fill=OCHRE)
    d.rectangle([9, 9, 54, 54], fill=INK3)
    d.rectangle([11, 11, 52, 52], fill=INK2)
    # inner hairline
    d.rectangle([12, 12, 51, 51], outline=EARTH_D)
    # corner cloud scrolls (kept inside the 16px 9-slice corners)
    def curl(boxes, start, end):
        for (bb, col) in zip(boxes, (OCHRE_D, OCHRE, OCHRE_L)):
            d.arc(bb, start, end, fill=col)
    curl([[8, 8, 15, 15], [10, 10, 15, 15], [12, 12, 15, 15]], 180, 270)      # TL
    curl([[49, 8, 56, 15], [49, 10, 54, 15], [49, 12, 52, 15]], 270, 360)     # TR
    curl([[49, 49, 56, 56], [49, 51, 54, 56], [49, 53, 52, 56]], 0, 90)       # BR
    curl([[8, 49, 15, 56], [10, 49, 15, 54], [12, 49, 15, 52]], 90, 180)      # BL
    for x, y in ((9, 9), (54, 9), (54, 54), (9, 54)):
        put(img, x, y, OCHRE_L)
    # subtle 2x2 wear on the gold lines, kept symmetric
    for x in (20, 26, 38, 44):
        for y in (4, 59):
            put(img, x, y, EARTH_D if (x + y) % 3 else OCHRE_L)
    for y in (20, 26, 38, 44):
        for x in (4, 59):
            put(img, x, y, EARTH_D if (x + y) % 3 else OCHRE_L)
    save(img, "ui", "ui_panel_9slice_v2")
    print("[ui] ui_panel_9slice_v2")


# ---------------------------------------------------------------------------
# spot icons 32x32
# ---------------------------------------------------------------------------

def ui_icon_spot_bridge() -> None:
    img = canvas(32, 32)
    d = ImageDraw.Draw(img)
    # stone arch rings (openings stay transparent)
    d.arc([1, 13, 16, 31], 180, 360, fill=EARTH_M, width=4)
    d.arc([16, 13, 31, 31], 180, 360, fill=EARTH_M, width=4)
    d.arc([1, 13, 16, 31], 180, 360, fill=EARTH_D, width=1)
    d.arc([16, 13, 31, 31], 180, 360, fill=EARTH_D, width=1)
    d.arc([4, 16, 13, 28], 180, 360, fill=EARTH_D, width=1)
    d.arc([19, 16, 28, 28], 180, 360, fill=EARTH_D, width=1)
    # deck
    d.rectangle([1, 8, 30, 12], fill=INK)
    d.rectangle([2, 8, 29, 11], fill=EARTH_L)
    d.line([(2, 8), (29, 8)], fill=SAND)
    d.line([(2, 11), (29, 11)], fill=EARTH_D)
    # railing
    for x in range(3, 30, 4):
        d.line([(x, 5), (x, 8)], fill=EARTH_D)
        put(img, x, 5, SAND)
    d.line([(3, 6), (28, 6)], fill=EARTH_D)
    # water
    for x in (3, 12, 21):
        d.line([(x, 28), (x + 5, 28)], fill=WATER)
        d.line([(x + 2, 30), (x + 6, 30)], fill=WATER)
    save(img, "ui", "ui_icon_spot_bridge")
    print("[ui] ui_icon_spot_bridge")


def ui_icon_spot_buddha() -> None:
    img = canvas(32, 32)
    d = ImageDraw.Draw(img)
    # halo
    d.ellipse([7, 1, 25, 19], outline=OCHRE_D, width=2)
    d.arc([9, 3, 23, 17], 200, 340, fill=OCHRE)
    # shoulders + robe
    d.polygon([(5, 27), (8, 18), (12, 16), (20, 16), (24, 18), (27, 27)], fill=INK)
    d.polygon([(6, 26), (9, 19), (12, 17), (20, 17), (23, 19), (26, 26)], fill=EARTH_M)
    for k in range(3):
        y = 20 + k * 3
        d.arc([9 + k, y, 23 - k, y + 5], 0, 180, fill=OCHRE_D)
    # head
    d.ellipse([11, 5, 21, 16], fill=INK)
    d.ellipse([12, 6, 20, 15], fill=SAND)
    d.arc([12, 6, 20, 15], 110, 260, fill=OCHRE_D)
    # hair cap
    d.arc([12, 5, 20, 12], 180, 360, fill=EARTH_D, width=2)
    # face
    d.line([(14, 10), (16, 10)], fill=INK3)
    d.line([(18, 10), (20, 10)], fill=INK3)
    d.line([(16, 11), (16, 12)], fill=OCHRE_D)
    d.line([(15, 13), (17, 13)], fill=VERMILION_D)
    # lap / lotus seat
    d.polygon([(4, 30), (8, 26), (24, 26), (28, 30)], fill=EARTH_D)
    d.line([(8, 26), (24, 26)], fill=OCHRE_D)
    d.line([(5, 29), (27, 29)], fill=EARTH_M)
    # urna
    put(img, 16, 7, VERMILION_D)
    save(img, "ui", "ui_icon_spot_buddha")
    print("[ui] ui_icon_spot_buddha")


def ui_icon_spot_cave() -> None:
    img = canvas(32, 32)
    d = ImageDraw.Draw(img)
    # rock mass
    d.rectangle([2, 4, 29, 30], fill=EARTH_D)
    d.line([(2, 4), (29, 4)], fill=OCHRE_D)
    # cave arch
    d.pieslice([6, 6, 26, 26], 180, 360, fill=INK)
    d.rectangle([6, 16, 26, 29], fill=INK)
    d.arc([5, 5, 27, 27], 180, 360, fill=OCHRE)
    d.line([(5, 16), (5, 29)], fill=OCHRE)
    d.line([(27, 16), (27, 29)], fill=EARTH_D)
    d.arc([7, 7, 25, 25], 180, 360, fill=EARTH_D)
    d.rectangle([7, 16, 25, 28], fill=INK2)
    # rows of tiny niches
    for row in range(3):
        for col in range(4):
            nx = 9 + col * 4
            ny = 11 + row * 4
            d.pieslice([nx, ny, nx + 3, ny + 3], 180, 360, fill=OCHRE_D)
            d.rectangle([nx, ny + 1, nx + 3, ny + 3], fill=OCHRE_D)
            put(img, nx + 1, ny + 2, SAND)
    # central seated buddha
    d.ellipse([14, 18, 18, 22], fill=SAND)
    d.polygon([(13, 27), (15, 22), (17, 22), (19, 27)], fill=SAND)
    d.line([(13, 27), (19, 27)], fill=OCHRE_D)
    save(img, "ui", "ui_icon_spot_cave")
    print("[ui] ui_icon_spot_cave")


def ui_icon_spot_temple() -> None:
    img = canvas(32, 32)
    d = ImageDraw.Draw(img)
    # platform
    d.rectangle([3, 25, 28, 29], fill=INK)
    d.rectangle([4, 25, 27, 28], fill=EARTH_M)
    d.line([(4, 25), (27, 25)], fill=EARTH_L)
    # hall body
    d.rectangle([8, 17, 24, 26], fill=INK)
    d.rectangle([9, 18, 23, 26], fill=EARTH_L)
    d.rectangle([14, 20, 18, 26], fill=VERMILION_D)
    d.line([(14, 22), (18, 22)], fill=OCHRE_D)
    # columns
    for x in (10, 13, 19, 22):
        d.line([(x, 18), (x, 25)], fill=EARTH_D)
    # curved roof
    d.polygon([(2, 17), (5, 11), (10, 9), (22, 9), (27, 11), (30, 17)], fill=INK)
    d.polygon([(4, 16), (6, 12), (11, 10), (21, 10), (26, 12), (28, 16)], fill=EARTH_D)
    d.line([(6, 12), (26, 12)], fill=OCHRE_D)
    d.line([(11, 10), (21, 10)], fill=OCHRE)
    d.line([(3, 16), (29, 16)], fill=EARTH_M)
    put(img, 2, 15, OCHRE)
    put(img, 29, 15, OCHRE)
    # ridge ornament
    d.rectangle([15, 6, 17, 9], fill=OCHRE_D)
    put(img, 16, 5, OCHRE_L)
    # steps
    d.rectangle([13, 29, 19, 31], fill=EARTH_D)
    d.line([(13, 29), (19, 29)], fill=OCHRE_D)
    save(img, "ui", "ui_icon_spot_temple")
    print("[ui] ui_icon_spot_temple")


def ui_icon_spot_garden() -> None:
    img = canvas(32, 32)
    d = ImageDraw.Draw(img)
    # moon gate
    d.ellipse([3, 3, 29, 29], fill=INK)
    d.ellipse([4, 4, 28, 28], fill=EARTH_M)
    d.ellipse([7, 7, 25, 25], fill=INK2)
    d.arc([4, 4, 28, 28], 200, 340, fill=EARTH_L)
    d.arc([7, 7, 25, 25], 200, 340, fill=INK3)
    # bamboo inside the gate
    for bx, h in ((11, 14), (15, 17), (19, 12)):
        d.line([(bx, 24), (bx, 24 - h)], fill=GREEN_D)
        d.line([(bx + 1, 24), (bx + 1, 24 - h)], fill=GREEN_M)
        for k in range(3):
            y = 24 - h + 4 + k * 4
            d.line([(bx - 2, y), (bx, y - 1)], fill=GREEN_D)
            d.line([(bx + 1, y + 2), (bx + 3, y + 1)], fill=GREEN_D)
    # stone path
    d.rectangle([9, 26, 23, 30], fill=EARTH_D)
    for x in (10, 15, 20):
        d.rectangle([x, 27, x + 3, 29], fill=EARTH_L)
    # moss
    for x, y in ((6, 25), (25, 24), (8, 4), (24, 5)):
        put(img, x, y, GREEN_M)
    save(img, "ui", "ui_icon_spot_garden")
    print("[ui] ui_icon_spot_garden")


# ---------------------------------------------------------------------------
# stamp
# ---------------------------------------------------------------------------

def ui_stamp_v2() -> None:
    img = canvas(32, 32)
    d = ImageDraw.Draw(img)
    # rough seal block
    d.rectangle([4, 4, 27, 27], fill=VERMILION)
    d.rectangle([5, 5, 26, 26], fill=VERMILION_D)
    d.rectangle([7, 7, 24, 24], fill=VERMILION)
    # chipped edge
    for x, y in ((4, 9), (4, 15), (4, 22), (27, 11), (27, 19), (9, 4), (18, 4), (12, 27), (23, 27)):
        put(img, x, y, SAND_L if (x + y) % 2 else VERMILION_D)
    # negative gate glyph (門)
    d.line([(11, 10), (11, 21), (20, 21), (20, 10)], fill=SAND_L, width=2)
    d.line([(13, 12), (13, 19)], fill=VERMILION_D)
    d.line([(18, 12), (18, 19)], fill=VERMILION_D)
    d.line([(11, 14), (20, 14)], fill=SAND_L)
    d.line([(11, 17), (20, 17)], fill=SAND_L)
    # worm / crack
    d.line([(8, 23), (10, 21)], fill=VERMILION_D)
    save(img, "ui", "ui_stamp_v2")
    print("[ui] ui_stamp_v2")


# ---------------------------------------------------------------------------
# tool icons 24x24
# ---------------------------------------------------------------------------

def tool_icon(name: str) -> Image.Image:
    img = canvas(24, 24)
    d = ImageDraw.Draw(img)
    if name == "close":
        for i in range(9):
            put(img, 7 + i, 7 + i, OCHRE_L)
            put(img, 8 + i, 7 + i, INK3)
            put(img, 16 - i, 7 + i, OCHRE_L)
            put(img, 15 - i, 7 + i, INK3)
    elif name == "check":
        pts = [(6, 12), (10, 16), (18, 7)]
        for i in range(len(pts) - 1):
            x0, y0 = pts[i]
            x1, y1 = pts[i + 1]
            steps = max(abs(x1 - x0), abs(y1 - y0))
            for s in range(steps + 1):
                x = x0 + (x1 - x0) * s // steps
                y = y0 + (y1 - y0) * s // steps
                put(img, x, y, OCHRE_L)
                put(img, x, y + 1, INK3)
                put(img, x + 1, y, INK3)
    elif name == "arrow":
        for i in range(6):
            put(img, 9 + i, 10 + i, OCHRE_L)
            put(img, 14 - i, 10 + i, OCHRE_L)
            put(img, 9 + i, 11 + i, INK3)
    elif name == "compass":
        d.ellipse([3, 3, 20, 20], outline=INK3, width=3)
        d.ellipse([4, 4, 19, 19], outline=OCHRE_D, width=1)
        d.ellipse([7, 7, 16, 16], fill=INK2)
        # needle
        d.polygon([(12, 6), (14, 13), (12, 12), (10, 13)], fill=VERMILION_D)
        d.polygon([(12, 18), (14, 11), (12, 12), (10, 11)], fill=SAND)
        put(img, 12, 12, OCHRE_L)
        for ang in (0, 90, 180, 270):
            rad = math.radians(ang)
            put(img, int(12 + math.cos(rad) * 8), int(12 + math.sin(rad) * 8), OCHRE_D)
    return img


def ui_tool_icons() -> None:
    for name in ("close", "check", "arrow", "compass"):
        save(tool_icon(name), "ui", f"ui_icon_{name}")
    print("[ui] tool icons x4")


# ---------------------------------------------------------------------------
# card banner 640x192
# ---------------------------------------------------------------------------

def ui_card_banner() -> None:
    W, H = 640, 192
    img = canvas(W, H)
    d = ImageDraw.Draw(img)
    rng = random.Random(20261118)

    # sky: four flat bands with narrow dithered transitions
    bands = [(0, 44, CREAM), (44, 80, SAND_L), (80, 110, SAND), (110, 132, EARTH_L)]
    for y in range(132):
        for i, (y0, y1, col) in enumerate(bands):
            if y0 <= y < y1:
                put_row = col
                if y >= y1 - 3 and i + 1 < len(bands):
                    if dither_pick(0, y, (y - (y1 - 4)) / 4):
                        put_row = bands[i + 1][2]
                d.line([(0, y), (W - 1, y)], fill=put_row)
                break

    # pale sun with a dithered halo
    sx, sy = 170, 56
    for y in range(sy - 24, sy + 24):
        for x in range(sx - 24, sx + 24):
            dist = math.hypot(x - sx, y - sy)
            if dist < 11:
                put(img, x, y, CREAM)
            elif dist < 14:
                put(img, x, y, SAND_L)
            elif dist < 23 and dither_pick(x, y, 1 - (dist - 14) / 9):
                put(img, x, y, SAND_L)

    # layered mountains with sharp peaks
    def range_profile(base: int, hi: float, f1: float, p1: float, f2: float, p2: float) -> list:
        pts = []
        for x in range(0, W + 3, 3):
            y = (base
                 - hi * abs(math.sin(x * f1 + p1)) ** 2
                 - hi * 0.35 * abs(math.sin(x * f2 + p2)) ** 2)
            pts.append((x, int(y)))
        return pts

    fill = range_profile(100, 30, 0.0072, 0.5, 0.018, 2.1)
    d.polygon(fill + [(W, 150), (0, 150)], fill=EARTH_M)
    d.line(fill, fill=SAND_L)
    # flat mist wisps with dithered edges
    def wisp(cx: int, cy: int, rx: int, ry: int) -> None:
        for y in range(cy - ry, cy + ry + 1):
            for x in range(cx - rx, cx + rx + 1):
                dx = (x - cx) / rx
                dy = (y - cy) / max(1, ry)
                inside = dx * dx + dy * dy
                if inside <= 1.0:
                    if inside < 0.72 or dither_pick(x, y, (1.0 - inside) * 2.0):
                        put(img, x, y, SAND_L)

    wisp(150, 104, 190, 7)
    wisp(430, 100, 160, 6)

    mid = range_profile(118, 22, 0.0051, 2.4, 0.014, 0.7)
    d.polygon(mid + [(W, 152), (0, 152)], fill=OCHRE_D)
    d.line(mid, fill=EARTH_M)
    wisp(250, 118, 210, 7)
    wisp(560, 124, 150, 6)

    near = range_profile(131, 13, 0.009, 4.2, 0.023, 1.9)
    d.polygon(near + [(W, 154), (0, 154)], fill=EARTH_D)
    d.line(near, fill=OCHRE_D)

    # water
    d.rectangle([0, 134, W - 1, 178], fill=WATER)
    d.rectangle([0, 134, W - 1, 142], fill=WATER_D)
    for _ in range(210):
        x = rng.randrange(0, W - 10)
        y = rng.randrange(138, 176)
        d.line([(x, y), (x + rng.randrange(3, 10), y)],
               fill=WATER_L if rng.random() > 0.3 else WATER_D)

    # arched bridge
    bx0, bx1 = 330, 412
    d.arc([bx0, 148, bx1, 178], 180, 360, fill=EARTH_D, width=2)
    d.arc([bx0 + 4, 152, bx1 - 4, 176], 180, 360, fill=WATER_D, width=1)
    d.rectangle([bx0, 146, bx1, 149], fill=EARTH_L)
    d.line([(bx0, 146), (bx1, 146)], fill=SAND)
    d.line([(bx0, 149), (bx1, 149)], fill=EARTH_D)
    for x in range(bx0 + 2, bx1, 7):
        d.line([(x, 142), (x, 146)], fill=EARTH_D)
    d.line([(bx0 + 2, 142), (bx1 - 2, 142)], fill=EARTH_D)
    for x, y in ((340, 154), (362, 158), (390, 155), (404, 160)):
        d.line([(x, y), (x + 5, y)], fill=WATER_D)

    # bank at the bottom
    d.polygon([(0, 176), (90, 170), (210, 177), (360, 172), (520, 178), (640, 174),
               (640, 192), (0, 192)], fill=EARTH_D)
    d.line([(0, 176), (90, 170), (210, 177), (360, 172), (520, 178), (640, 174)], fill=OCHRE_D)

    # pine on the left bank
    d.rectangle([68, 152, 71, 184], fill=INK3)
    for yy, ww in ((166, 30), (156, 38), (146, 46)):
        d.polygon([(70 - ww // 2, yy), (70, yy - 13), (70 + ww // 2, yy)], fill=GREEN_D)
        d.line([(70 - ww // 2, yy), (70, yy - 13)], fill=GREEN_M)
        d.line([(70, yy - 13), (70 + ww // 2, yy)], fill=GREEN_DD)

    # pavilion on the right bank
    d.rectangle([512, 160, 552, 178], fill=EARTH_M)
    d.polygon([(506, 160), (512, 151), (552, 151), (558, 160)], fill=INK3)
    d.line([(512, 151), (552, 151)], fill=OCHRE_D)
    d.line([(507, 159), (557, 159)], fill=EARTH_D)
    d.rectangle([527, 164, 535, 178], fill=VERMILION_D)
    for x in (516, 522, 542, 547):
        d.line([(x, 162), (x, 177)], fill=EARTH_D)
    put(img, 532, 147, OCHRE_D)

    # foreground reeds
    for _ in range(70):
        x = rng.randrange(0, W)
        y = rng.randrange(180, 191)
        h = rng.randrange(3, 9)
        for k in range(h):
            put(img, x, y - k, GREEN_D if rng.random() > 0.5 else GREEN_DD)

    # birds
    for bx, by in ((250, 64), (262, 58), (274, 66)):
        put(img, bx, by, INK3)
        put(img, bx + 1, by - 1, INK3)
        put(img, bx + 2, by, INK3)

    save(img, "ui", "ui_card_banner")
    print("[ui] ui_card_banner")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    ui_panel_9slice_v2()
    ui_marker_spot()
    ui_marker_spot_done()
    ui_icon_spot_bridge()
    ui_icon_spot_buddha()
    ui_icon_spot_cave()
    ui_icon_spot_temple()
    ui_icon_spot_garden()
    ui_stamp_v2()
    ui_tool_icons()
    ui_card_banner()


if __name__ == "__main__":
    main()
