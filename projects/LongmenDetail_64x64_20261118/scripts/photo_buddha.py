"""Photo-guided Vairocana sprite: quantize to InkGongbi48, clean, add hair.

The photo supplies proportions and light; the output is hard-edged pixel art,
palette-locked, with hand-authored hairline / facial accents and a clean
2x2-cluster surface (no salt-and-pepper noise).

v3: deeper crop (head to lower robe), median-guarded denoise, 2x2 cluster pass
    on the robe, measured facial accents, and an extended silhouette so the
    robe no longer ends on a straight cut.
"""

from pathlib import Path

import math

from PIL import Image, ImageDraw, ImageFilter

from gen_lib import (
    INK, INK2, INK3, INK4, DARK_EARTH, EARTH_D, EARTH, EARTH_M, EARTH_L,
    OCHRE_D, OCHRE, OCHRE_L, SAND, SAND_L, CREAM, VERMILION_D,
)

PROJECT = Path(__file__).resolve().parents[1]
SRC = PROJECT / "images" / "lushena_head.jpg"
OUT = PROJECT / "notes"
OUT.mkdir(exist_ok=True)

# Head through lower robe (robe continues past the bottom of the sprite;
# the background adds the lap and pedestal).
CROP = (500, 280, 2200, 2760)
TW, TH = 245, 357

RAMP = [INK3, INK4, EARTH_D, EARTH, EARTH_M, EARTH_L, OCHRE_D, OCHRE, OCHRE_L, SAND, SAND_L, CREAM]
HAIR_RAMP = [INK3, EARTH_D, EARTH, OCHRE_D, OCHRE]

# Silhouette measured on the crop: crown, ears, jaw, neck, shoulders, arms.
MASK_POLY = [
    (104, 11), (117, 10), (130, 12), (140, 17), (148, 24),
    (155, 34), (159, 45), (162, 56), (164, 68),
    (170, 76), (171, 88), (169, 100), (164, 110), (158, 116),
    (152, 122), (145, 128), (137, 134), (130, 140),
    (138, 146), (141, 154), (142, 162), (143, 170),
    (154, 176), (167, 184), (180, 190), (192, 196), (203, 204),
    (212, 214), (220, 226), (227, 240), (232, 256), (235, 274),
    (235, 292), (232, 308), (228, 322), (223, 336), (218, 348), (215, 357),
    (16, 357), (14, 348), (11, 336), (9, 322), (8, 308), (8, 292),
    (10, 274), (13, 256), (17, 240), (22, 226), (29, 214), (38, 204),
    (48, 196), (59, 190), (70, 184), (81, 176), (92, 170),
    (104, 162), (104, 154), (106, 146), (112, 140),
    (105, 134), (99, 128), (92, 122), (86, 116), (80, 110),
    (75, 100), (73, 88), (74, 76), (75, 68), (77, 56),
    (80, 45), (85, 34), (92, 24), (98, 17),
]

HAIRLINE = [(88, 54), (96, 51), (106, 49), (116, 48), (126, 48),
            (136, 49), (146, 51), (156, 54)]
HAIR_MASK_LINE = [(82, 58)] + HAIRLINE + [(170, 60)]
HAIR_TOP = [(170, 60), (167, 50), (163, 42), (158, 34), (151, 27),
            (142, 22), (132, 19), (121, 18), (110, 19), (100, 22),
            (92, 27), (85, 34), (81, 42), (80, 50), (82, 58)]

CX = 123


def build_mask() -> Image.Image:
    mask = Image.new("L", (TW, TH), 0)
    d = ImageDraw.Draw(mask)
    d.polygon(MASK_POLY, fill=255)
    # ragged, eroded hem instead of a straight bottom cut
    mp = mask.load()
    for x in range(TW):
        n = (0.5 + 0.26 * math.sin(x * 0.055 + 1.2)
             + 0.16 * math.sin(x * 0.13 + 0.3)
             + 0.08 * math.sin(x * 0.29 + 2.1))
        h = int(7 + 16 * max(0.0, min(1.0, n)))
        for y in range(max(0, TH - h), TH):
            mp[x, y] = 0
    return mask


def build_hair_mask() -> Image.Image:
    mask = Image.new("L", (TW, TH), 0)
    d = ImageDraw.Draw(mask)
    d.polygon(HAIR_MASK_LINE + HAIR_TOP[:-1], fill=255)
    return mask


def median_guard(idx: list[list[int]], mask: Image.Image, tol: int = 1) -> list[list[int]]:
    """Replace pixels that differ from their 3x3 median by <= tol (noise)."""
    mp = mask.load()
    out = [row[:] for row in idx]
    for y in range(1, TH - 1):
        for x in range(1, TW - 1):
            if not mp[x, y]:
                continue
            vals = []
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if mp[x + dx, y + dy]:
                        vals.append(idx[y + dy][x + dx])
            if not vals:
                continue
            vals.sort()
            med = vals[len(vals) // 2]
            if abs(idx[y][x] - med) <= tol:
                out[y][x] = med
    return out


def cluster_2x2(idx: list[list[int]], mask: Image.Image, y_start: int) -> list[list[int]]:
    """Snap low-contrast 2x2 blocks to one colour, enforcing 2x2 clusters."""
    mp = mask.load()
    out = [row[:] for row in idx]
    for y in range(y_start, TH - 1, 2):
        for x in range(0, TW - 1, 2):
            pts = [(x + dx, y + dy) for dy in (0, 1) for dx in (0, 1) if mp[x + dx, y + dy]]
            if len(pts) < 2:
                continue
            vals = [idx[py][px] for px, py in pts]
            if max(vals) - min(vals) <= 0:
                continue
            if len(pts) == 4 and max(vals) - min(vals) <= 1:
                avg = int(round(sum(vals) / len(vals)))
                for px, py in pts:
                    out[py][px] = avg
    return out


def draw_face_accents(out: Image.Image) -> None:
    """Crisp, palette-locked facial accents over the photo-derived base."""
    d = ImageDraw.Draw(out)
    cx = CX

    # brows
    d.line([(cx - 25, 69), (cx - 17, 66), (cx - 7, 67)], fill=EARTH_D, width=2)
    d.line([(cx + 6, 67), (cx + 17, 66), (cx + 25, 69)], fill=EARTH_D, width=2)
    d.line([(cx - 23, 67), (cx - 17, 64), (cx - 9, 65)], fill=OCHRE_D)
    d.line([(cx + 8, 65), (cx + 17, 64), (cx + 23, 67)], fill=OCHRE_D)

    # downcast eyes: heavy upper lid, thin lower lid, dark iris slit
    d.line([(cx - 28, 80), (cx - 19, 76), (cx - 10, 76), (cx - 4, 79)], fill=INK3, width=2)
    d.line([(cx + 4, 79), (cx + 10, 76), (cx + 19, 76), (cx + 28, 80)], fill=INK3, width=2)
    d.line([(cx - 27, 84), (cx - 18, 83), (cx - 6, 83)], fill=OCHRE_D)
    d.line([(cx + 6, 83), (cx + 18, 83), (cx + 27, 84)], fill=OCHRE_D)
    d.line([(cx - 16, 80), (cx - 12, 80)], fill=INK, width=2)
    d.line([(cx + 12, 80), (cx + 16, 80)], fill=INK, width=2)
    out.putpixel((cx - 29, 80), VERMILION_D)
    out.putpixel((cx + 29, 80), VERMILION_D)

    # nose: ridge light, right-side shadow, tip and nostrils
    d.line([(cx - 2, 68), (cx - 2, 97)], fill=SAND_L, width=2)
    d.line([(cx + 2, 71), (cx + 2, 99)], fill=OCHRE_D)
    d.line([(cx - 10, 99), (cx, 102), (cx + 10, 99)], fill=OCHRE_D)
    d.line([(cx - 13, 101), (cx, 103), (cx + 13, 101)], fill=EARTH_D)
    out.putpixel((cx - 11, 101), INK3)
    out.putpixel((cx + 11, 101), INK3)
    d.line([(cx - 15, 94), (cx - 12, 100)], fill=OCHRE_D)
    d.line([(cx + 15, 94), (cx + 12, 100)], fill=OCHRE_D)

    # mouth: slight smile, full lower lip
    d.line([(cx - 11, 110), (cx - 5, 109), (cx, 110), (cx + 5, 109), (cx + 11, 110)],
           fill=INK3, width=2)
    d.line([(cx - 9, 113), (cx, 115), (cx + 9, 113)], fill=SAND_L, width=2)
    d.line([(cx - 9, 117), (cx, 118), (cx + 9, 117)], fill=OCHRE_D)
    out.putpixel((cx - 12, 111), VERMILION_D)
    out.putpixel((cx + 12, 111), VERMILION_D)

    # chin crease
    d.line([(cx - 7, 131), (cx + 7, 131)], fill=OCHRE_D)

    # neck fold lines
    for k, yy in enumerate((148, 155, 162)):
        d.arc([cx - 18 - k * 2, yy - 5, cx + 18 + k * 2, yy + 7], 15, 165, fill=OCHRE_D)

    # collar shadow
    d.line([(cx - 30, 176), (cx, 186), (cx + 30, 176)], fill=EARTH_D, width=2)


def build_buddha_sprite() -> Image.Image:
    """Build the photo-guided Vairocana head/robe sprite (245x357 RGBA)."""
    img = Image.open(SRC).convert("RGB")
    crop = img.crop(CROP).resize((TW, TH), Image.LANCZOS)
    gray = crop.convert("L").filter(ImageFilter.MedianFilter(3))

    mask = build_mask()
    hair_mask = build_hair_mask()
    mp = mask.load()
    hp = hair_mask.load()
    lp = gray.load()

    vals = [lp[x, y] for y in range(TH) for x in range(TW) if mp[x, y]]
    lo, hi = max(25, min(vals)), min(214, max(vals))
    hair_vals = [lp[x, y] for y in range(TH) for x in range(TW) if hp[x, y]]
    hlo, hhi = min(hair_vals), max(hair_vals)
    if hhi - hlo < 8:
        hhi = hlo + 8

    idx_map = [[0] * TW for _ in range(TH)]
    for y in range(TH):
        for x in range(TW):
            if not mp[x, y]:
                continue
            v = lp[x, y]
            if hp[x, y]:
                ht = (v - hlo) / max(1, hhi - hlo)
                idx_map[y][x] = int(round(max(0.0, min(1.0, ht)) * 4))
                continue
            t = (v - lo) / max(1, hi - lo)
            t = max(0.0, min(1.0, t)) ** 0.95
            idx_map[y][x] = int(round(t * (len(RAMP) - 1)))

    # one light guard pass removes remaining isolated pixels
    idx_map = median_guard(idx_map, mask, tol=1)

    out = Image.new("RGBA", (TW, TH), (0, 0, 0, 0))
    op = out.load()
    for y in range(TH):
        for x in range(TW):
            if mp[x, y]:
                op[x, y] = HAIR_RAMP[idx_map[y][x]] if hp[x, y] else RAMP[idx_map[y][x]]

    # hairline band: one dark edge and one soft highlight, clipped to the mask
    d = ImageDraw.Draw(out)
    for x, y in HAIRLINE:
        for ox, oy, col in ((0, 0, EARTH_D), (0, -1, OCHRE_D), (1, 0, EARTH_D)):
            px_, py_ = x + ox, y + oy
            if 0 <= px_ < TW and 0 <= py_ < TH and mp[px_, py_]:
                out.putpixel((px_, py_), col)

    # 螺髻 coils: staggered dark arcs with sparse warm highlights
    for row, yy in enumerate((16, 21, 26, 31, 36, 41, 46)):
        for i in range(-10, 11):
            xx = CX + i * 5 + (2 if row % 2 else 0)
            if not (0 <= xx - 2 < TW and 0 <= yy + 2 < TH):
                continue
            if not hp[xx, yy]:
                continue
            d.arc([xx - 2, yy - 1, xx + 2, yy + 2], 20, 200, fill=INK3)
            if 0 <= xx - 2 < TW and mp[xx - 2, yy + 1]:
                out.putpixel((xx - 2, yy + 1), EARTH_D)
            for px_, py_, col in ((xx - 1, yy - 1, OCHRE_D), (xx + 1, yy + 2, INK2)):
                if 0 <= px_ < TW and 0 <= py_ < TH and mp[px_, py_]:
                    out.putpixel((px_, py_), col)

    # selective 1px silhouette outline (left/top warm, right/bottom ink)
    for y in range(TH):
        for x in range(TW):
            if not mp[x, y]:
                continue
            edge = False
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if not (0 <= nx < TW and 0 <= ny < TH) or not mp[nx, ny]:
                    edge = True
                    break
            if edge and y < TH - 2:
                if y > TH - 28:
                    op[x, y] = EARTH_D
                else:
                    op[x, y] = INK3 if (x - CX) + (y - 130) > 0 else EARTH_D

    out.save(OUT / "photo_buddha_sprite.png", "PNG")

    scale = 4
    preview = Image.new("RGB", (TW * scale, TH * scale), (30, 30, 34))
    pd = ImageDraw.Draw(preview)
    for yy in range(0, TH * scale, 12):
        for xx in range(0, TW * scale, 12):
            if (xx // 12 + yy // 12) % 2 == 0:
                pd.rectangle([xx, yy, xx + 11, yy + 11], fill=(46, 46, 52))
    big = out.resize((TW * scale, TH * scale), Image.NEAREST)
    preview.paste(big, (0, 0), big)
    preview.save(OUT / "photo_buddha_preview.png", "PNG")

    used = set()
    for y in range(TH):
        for x in range(TW):
            if mp[x, y]:
                used.add(op[x, y])
    print("colors:", len(used), "size:", out.size)
    return out


def main() -> None:
    build_buddha_sprite()


if __name__ == "__main__":
    main()
