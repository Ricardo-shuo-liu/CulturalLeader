from __future__ import annotations

import random
from collections.abc import Callable

from PIL import Image, ImageDraw

from ..scene_spec import SceneSpec
from .colors import ACCENT, EARTH, GREEN, INK, SKIN, WARM, WATER, accent_color, pick, ramp
from .noise import bayer4, value_noise_1d


def _arch(draw: ImageDraw.ImageDraw, x0: int, y0: int, x1: int, y1: int, color: str) -> None:
    radius = max(2, (x1 - x0) // 2)
    draw.rectangle((x0, y0 + radius, x1, y1), fill=color)
    draw.ellipse((x0, y0, x1, y0 + radius * 2), fill=color)


def _scale(spec: SceneSpec) -> float:
    return max(0.5, min(1.4, spec.composition.landmark_scale))


def draw_cliff_buddha(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    spec: SceneSpec,
    palette: list[str],
    rng: random.Random,
) -> None:
    width, height = img.size
    scale = _scale(spec)
    rock_dark, rock_mid, rock_light = ramp(palette, (EARTH[2], EARTH[4], EARTH[6]))
    niche_dark = pick(palette, (INK[1], INK[0], "#33322f"))
    gold = pick(palette, WARM[7:10])
    gold_deep = pick(palette, WARM[4:7])
    skin = pick(palette, SKIN)
    skin_shadow = pick(palette, (SKIN[1], EARTH[7]))
    robe = pick(palette, (EARTH[8], EARTH[7], EARTH[6]))
    robe_dark = pick(palette, (EARTH[5], EARTH[4]))
    seal = accent_color(palette, spec.accent_role)
    moss = pick(palette, GREEN[2:5])

    # 崖壁：低频起伏的顶边，覆盖到水面上方。
    cliff_bottom = height - 96
    noise = value_noise_1d(width, rng, 210)
    for x in range(width):
        top = int(54 + noise[x] * 66)
        draw.line((x, top, x, cliff_bottom), fill=rock_mid)
        if bayer4(x, top) < 5:
            draw.point((x, top), fill=rock_light)

    # 层理与裂隙：短、断续、不横贯整幅。
    for _ in range(58):
        x = rng.randint(0, width - 40)
        y = rng.randint(110, cliff_bottom - 10)
        length = rng.randint(16, 90)
        draw.line((x, y, min(width - 1, x + length), y + rng.choice((-2, -1, 0, 1, 2))), fill=rock_dark)
    for _ in range(22):
        x = rng.randint(0, width - 1)
        y = rng.randint(100, cliff_bottom - 40)
        length = rng.randint(12, 42)
        draw.line((x, y, x + rng.randint(-6, 6), min(cliff_bottom, y + length)), fill=rock_light)

    cx = int(width * spec.composition.landmark_x)
    niche_w = int(330 * scale)
    niche_top = 104
    niche_bottom = cliff_bottom - 18
    _arch(draw, cx - niche_w // 2, niche_top, cx + niche_w // 2, niche_bottom, rock_light)
    _arch(
        draw,
        cx - niche_w // 2 + 10,
        niche_top + 10,
        cx + niche_w // 2 - 10,
        niche_bottom - 8,
        niche_dark,
    )

    # 主尊背光：双环 + 暗底，保持石像体积。
    halo_cy = niche_top + int(120 * scale)
    halo_r = int(104 * scale)
    draw.ellipse((cx - halo_r, halo_cy - halo_r, cx + halo_r, halo_cy + halo_r), fill=gold_deep)
    draw.ellipse((cx - halo_r + 8, halo_cy - halo_r + 8, cx + halo_r - 8, halo_cy + halo_r - 8), fill=niche_dark)
    draw.ellipse(
        (cx - halo_r + 18, halo_cy - halo_r + 18, cx + halo_r - 18, halo_cy + halo_r - 18),
        fill=gold,
    )
    draw.ellipse(
        (cx - halo_r + 28, halo_cy - halo_r + 28, cx + halo_r - 28, halo_cy + halo_r - 28),
        fill=niche_dark,
    )

    # 头部与螺髻。
    head_r = int(38 * scale)
    head_cy = halo_cy + int(4 * scale)
    draw.ellipse((cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r), fill=skin)
    hair = pick(palette, (EARTH[4], ACCENT[5], "#2c3a4a"))
    draw.pieslice(
        (cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r),
        180,
        360,
        fill=hair,
    )
    for row in range(3):
        for col in range(-3, 4):
            hx = cx + col * int(9 * scale)
            hy = head_cy - head_r + 8 + row * int(8 * scale)
            draw.ellipse((hx - 3, hy - 3, hx + 3, hy + 3), fill=skin_shadow)
    # 耳朵与面部暗部。
    draw.ellipse((cx - head_r - 5, head_cy - 12, cx - head_r + 2, head_cy + 22), fill=skin_shadow)
    draw.ellipse((cx + head_r - 2, head_cy - 12, cx + head_r + 5, head_cy + 22), fill=skin_shadow)
    eye_y = head_cy + 2
    draw.line((cx - 18, eye_y, cx - 7, eye_y), fill=niche_dark)
    draw.line((cx + 7, eye_y, cx + 18, eye_y), fill=niche_dark)
    draw.line((cx - 1, head_cy + 5, cx - 1, head_cy + 11), fill=skin_shadow)
    draw.line((cx - 6, head_cy + 13, cx + 6, head_cy + 13), fill=seal)
    draw.line((cx - 8, head_cy + 15, cx + 8, head_cy + 15), fill=skin_shadow)

    # 身体/袈裟：宽肩收腰，三层衣褶。
    shoulder_y = head_cy + int(42 * scale)
    base_y = niche_bottom - int(28 * scale)
    body_half = int(88 * scale)
    draw.polygon(
        (
            (cx - body_half, base_y),
            (cx - body_half + 8, shoulder_y + 28),
            (cx - 28, shoulder_y),
            (cx + 28, shoulder_y),
            (cx + body_half - 8, shoulder_y + 28),
            (cx + body_half, base_y),
        ),
        fill=robe,
    )
    for index in range(3):
        y = shoulder_y + int((index + 1) * 26 * scale)
        half = int((body_half - 10) * (1 - index * 0.12))
        draw.line((cx - half, y, cx + half, y + 4), fill=robe_dark)
    for offset in (-52, -26, 26, 52):
        draw.line(
            (cx + int(offset * scale), shoulder_y + 36, cx + int(offset * 0.72 * scale), base_y - 10),
            fill=robe_dark,
        )
    draw.line((cx - 26, shoulder_y + 2, cx, shoulder_y + 28, cx + 26, shoulder_y + 2), fill=robe_dark)
    draw.rectangle((cx - int(34 * scale), base_y - 4, cx + int(34 * scale), base_y + 10), fill=robe_dark)

    # 台基。
    draw.rectangle((cx - niche_w // 2 + 20, niche_bottom - 12, cx + niche_w // 2 - 20, niche_bottom), fill=rock_light)
    draw.rectangle((cx - niche_w // 2 + 8, niche_bottom, cx + niche_w // 2 - 8, niche_bottom + 10), fill=rock_mid)

    # 两侧小佛龛。
    for index in range(10):
        side = -1 if index % 2 == 0 else 1
        nx = cx + side * rng.randint(int(niche_w * 0.62), int(width * 0.44))
        ny = rng.randint(116, cliff_bottom - 120)
        nw = rng.randint(22, 44)
        nh = rng.randint(36, 66)
        if not (40 < nx < width - 40):
            continue
        _arch(draw, nx - nw // 2, ny, nx + nw // 2, ny + nh, rock_dark)
        inner = pick(palette, (INK[1], INK[0], "#33322f"))
        if rng.random() < 0.55:
            inner = pick(palette, WARM[4:7])
        draw.ellipse((nx - 6, ny + 8, nx + 6, ny + 20), fill=inner)
        draw.rectangle((nx - 9, ny + 18, nx + 9, ny + nh - 4), fill=inner)
        if index % 4 == 0:
            draw.rectangle((nx - 2, ny + nh - 1, nx + 2, ny + nh + 3), fill=moss)

    # 苔痕与垂藤。
    for _ in range(26):
        x = rng.randint(0, width - 1)
        y = rng.randint(80, cliff_bottom - 30)
        length = rng.randint(8, 34)
        draw.line((x, y, x + rng.randint(-3, 3), y + length), fill=moss)

    # 崖脚阴影，让崖壁与水面分开。
    draw.rectangle((0, cliff_bottom - 8, width - 1, cliff_bottom), fill=rock_dark)


def draw_pagoda(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    spec: SceneSpec,
    palette: list[str],
    rng: random.Random,
) -> None:
    width, height = img.size
    scale = _scale(spec)
    cx = int(width * spec.composition.landmark_x)
    base_y = height - 72
    body = pick(palette, (EARTH[8], EARTH[9], EARTH[7]))
    body_dark = pick(palette, (EARTH[5], EARTH[4], EARTH[3]))
    roof = pick(palette, (GREEN[1], ACCENT[5], INK[1]))
    roof_light = pick(palette, (GREEN[3], EARTH[6]))
    gold = pick(palette, WARM[7:10])
    window = pick(palette, (INK[1], INK[0]))
    seal = accent_color(palette, spec.accent_role)
    tree = pick(palette, (GREEN[2], GREEN[1], GREEN[3]))

    # 台基。
    draw.rectangle((cx - int(116 * scale), base_y - 18, cx + int(116 * scale), base_y), fill=body_dark)
    draw.rectangle((cx - int(100 * scale), base_y - 34, cx + int(100 * scale), base_y - 18), fill=body)
    for _ in range(14):
        x = rng.randint(cx - int(100 * scale), cx + int(90 * scale))
        draw.rectangle((x, base_y - 20, x + 6, base_y - 12), fill=body_dark)

    tiers = 6
    tier_h = int(30 * scale)
    top_y = base_y - 34
    for tier in range(tiers):
        tier_w = int((118 - tier * 15) * scale)
        y = top_y - (tier + 1) * tier_h
        # 塔身。
        draw.rectangle((cx - tier_w, y + 8, cx + tier_w, y + tier_h), fill=body)
        draw.rectangle((cx - tier_w + 8, y + 14, cx + tier_w - 8, y + tier_h - 6), fill=body_dark)
        # 窗/门。
        for offset in (-tier_w // 2, 0, tier_w // 2):
            draw.rectangle((cx + offset - 4, y + 18, cx + offset + 4, y + tier_h - 10), fill=window)
        # 飞檐。
        eave = 18 + tier * 2
        draw.polygon(
            (
                (cx - tier_w - eave, y + 12),
                (cx - tier_w + 4, y - 2),
                (cx + tier_w - 4, y - 2),
                (cx + tier_w + eave, y + 12),
                (cx + tier_w - 2, y + 8),
                (cx - tier_w + 2, y + 8),
            ),
            fill=roof,
        )
        draw.line((cx - tier_w + 4, y - 2, cx + tier_w - 4, y - 2), fill=roof_light)
        draw.line((cx - tier_w - eave + 2, y + 12, cx - tier_w + 5, y + 9), fill=gold)
        draw.line((cx + tier_w + eave - 2, y + 12, cx + tier_w - 5, y + 9), fill=gold)
    # 塔刹。
    top = top_y - tiers * tier_h
    draw.rectangle((cx - 3, top - 36, cx + 3, top), fill=gold)
    for index in range(4):
        r = 7 - index
        draw.ellipse((cx - r, top - 34 + index * 8, cx + r, top - 34 + index * 8 + 4), fill=gold)
    draw.rectangle((cx - 2, top - 48, cx + 2, top - 36), fill=seal)

    # 两侧树影。
    for side in (-1, 1):
        tx = cx + side * int(180 * scale + rng.randint(0, 55))
        for index in range(3):
            tw = rng.randint(16, 28)
            th = rng.randint(34, 60)
            ty = base_y - 8 - index * 12
            draw.polygon(((tx - tw, ty), (tx, ty - th), (tx + tw, ty)), fill=tree)


def draw_palace_gate(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    spec: SceneSpec,
    palette: list[str],
    rng: random.Random,
) -> None:
    width, height = img.size
    scale = _scale(spec)
    cx = int(width * spec.composition.landmark_x)
    base_y = height - 58
    wall_w = int(330 * scale)
    wall_h = int(150 * scale)
    wall_top = base_y - wall_h
    red = pick(palette, ("#8f3a30", "#b5503f", "#7a5436"))
    red_dark = pick(palette, ("#5a4c3e", "#6b5947", "#2c3a4a"))
    roof = pick(palette, ("#33322f", "#2c3a4a", INK[1]))
    roof_light = pick(palette, (GREEN[2], EARTH[4]))
    gold = pick(palette, WARM[7:10])
    portal = pick(palette, (INK[0], INK[1], "#33322f"))
    lantern = pick(palette, (WARM[6], "#d18f67", "#e6a96f"))

    # 广场/台阶。
    draw.rectangle((cx - wall_w - 80, base_y, cx + wall_w + 80, base_y + 38), fill=red_dark)
    for index in range(5):
        draw.line(
            (cx - wall_w - 60 + index * 18, base_y + 8, cx + wall_w + 60 - index * 18, base_y + 8),
            fill=pick(palette, (EARTH[4], EARTH[5])),
        )

    # 城墙。
    draw.rectangle((cx - wall_w, wall_top, cx + wall_w, base_y), fill=red)
    draw.rectangle((cx - wall_w, wall_top, cx + wall_w, wall_top + 10), fill=red_dark)
    for _ in range(18):
        x = rng.randint(cx - wall_w, cx + wall_w - 2)
        y = rng.randint(wall_top + 24, base_y - 10)
        draw.rectangle((x, y, x + 2, y + 4), fill=red_dark)

    # 城门洞。
    gate_w = int(75 * scale)
    gate_h = int(112 * scale)
    _arch(draw, cx - gate_w, base_y - gate_h, cx + gate_w, base_y, portal)
    _arch(
        draw,
        cx - gate_w + 10,
        base_y - gate_h + 10,
        cx + gate_w - 10,
        base_y - 4,
        pick(palette, (EARTH[3], EARTH[2])),
    )
    draw.rectangle((cx - 2, base_y - gate_h + 24, cx + 2, base_y - 6), fill=red_dark)
    for side in (-1, 1):
        x0 = cx + side * (gate_w - 18)
        x1 = cx + side * (gate_w - 10)
        draw.rectangle((min(x0, x1), base_y - 28, max(x0, x1), base_y - 20), fill=gold)

    # 重檐屋顶。
    roof_w = wall_w + int(70 * scale)
    for index, y in enumerate((wall_top - 4, wall_top - 52)):
        half = roof_w - index * 44
        top = y - 34
        draw.polygon(
            (
                (cx - half, y),
                (cx - half + 38, top),
                (cx + half - 38, top),
                (cx + half, y),
                (cx + half - 26, y - 6),
                (cx - half + 26, y - 6),
            ),
            fill=roof,
        )
        draw.line((cx - half + 40, top + 2, cx + half - 40, top + 2), fill=roof_light)
        draw.line((cx - half + 6, y - 2, cx - half + 46, top + 3), fill=gold)
        draw.line((cx + half - 6, y - 2, cx + half - 46, top + 3), fill=gold)
    draw.rectangle((cx - 6, wall_top - 96, cx + 6, wall_top - 52), fill=gold)

    # 灯笼与树。
    for side in (-1, 1):
        lx = cx + side * (wall_w - 30)
        draw.rectangle((lx - 1, base_y - 96, lx + 1, base_y - 74), fill=roof)
        draw.ellipse((lx - 8, base_y - 82, lx + 8, base_y - 64), fill=lantern)
        draw.rectangle((lx - 2, base_y - 88, lx + 2, base_y - 82), fill=gold)
        tx = cx + side * (wall_w + 34)
        for index in range(3):
            tw = 12 + index * 4
            th = 42 + index * 10
            draw.polygon(((tx - tw, base_y - 8), (tx, base_y - 8 - th), (tx + tw, base_y - 8)), fill=pick(palette, (GREEN[2], GREEN[1])))


def draw_water_town(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    spec: SceneSpec,
    palette: list[str],
    rng: random.Random,
) -> None:
    width, height = img.size
    scale = _scale(spec)
    base_y = height - 58
    wall = pick(palette, (EARTH[9], EARTH[10], EARTH[8]))
    wall_shadow = pick(palette, (EARTH[6], EARTH[7]))
    roof = pick(palette, (INK[1], ACCENT[5], GREEN[1]))
    roof_light = pick(palette, (GREEN[3], EARTH[5]))
    window = pick(palette, (INK[0], INK[1]))
    stone = pick(palette, (EARTH[6], EARTH[7], EARTH[8]))
    stone_dark = pick(palette, (EARTH[4], EARTH[5]))
    willow = pick(palette, (GREEN[3], GREEN[4], GREEN[5]))
    lantern = pick(palette, (WARM[6], "#d18f67", "#e6a96f"))

    # 两岸石驳岸。
    for side in (-1, 1):
        x0 = 0 if side < 0 else int(width * 0.66)
        x1 = int(width * 0.34) if side < 0 else width - 1
        draw.rectangle((x0, base_y - 18, x1, base_y + 24), fill=stone_dark)
        for _ in range(30):
            x = rng.randint(x0, max(x0, x1 - 12))
            y = rng.randint(base_y - 14, base_y + 18)
            draw.rectangle((x, y, min(x1, x + rng.randint(8, 22)), y + 2), fill=stone)

    # 白墙黛瓦：左右各三组。
    for index in range(3):
        for side in (-1, 1):
            bw = int((66 + index * 12) * scale)
            bh = int((76 + index * 16) * scale)
            bx = int(width * (0.2 if side < 0 else 0.72)) + side * index * int(30 * scale)
            by = base_y - 24 - (index % 2) * 14
            x0, x1 = bx - bw, bx + bw
            draw.rectangle((x0, by - bh, x1, by), fill=wall)
            draw.rectangle((x0, by - bh, x0 + 8, by), fill=wall_shadow)
            # 屋顶。
            draw.polygon(((x0 - 18, by - bh), (x0 + 12, by - bh - 30), (x1 - 12, by - bh - 30), (x1 + 18, by - bh)), fill=roof)
            draw.line((x0 - 16, by - bh - 2, x1 + 16, by - bh - 2), fill=roof_light)
            # 窗与门。
            for offset in (-bw // 2, 0, bw // 2):
                draw.rectangle((bx + offset - 7, by - bh + 22, bx + offset + 7, by - bh + 42), fill=window)
            draw.rectangle((bx - 12, by - 26, bx + 12, by), fill=window)
            if index == 0:
                draw.ellipse((bx + 18, by - 46, bx + 34, by - 30), fill=lantern)

    # 拱桥：桥面 + 半圆桥洞 + 栏杆。
    bridge_x = int(width * 0.48)
    bridge_w = int(190 * scale)
    bridge_y = base_y - 70
    draw.rectangle((bridge_x - bridge_w, bridge_y - 14, bridge_x + bridge_w, bridge_y + 4), fill=stone)
    draw.pieslice((bridge_x - 58, bridge_y - 2, bridge_x + 58, bridge_y + 90), 180, 360, fill=stone_dark)
    draw.rectangle((bridge_x - bridge_w, bridge_y - 14, bridge_x + bridge_w, bridge_y - 10), fill=stone_dark)
    for x in range(bridge_x - bridge_w, bridge_x + bridge_w, 24):
        draw.rectangle((x, bridge_y - 30, x + 4, bridge_y - 14), fill=stone)
    draw.line((bridge_x - bridge_w, bridge_y - 30, bridge_x + bridge_w, bridge_y - 30), fill=stone)

    # 乌篷船与柳树。
    boat_x = bridge_x - int(180 * scale)
    draw.polygon(((boat_x - 40, base_y + 16), (boat_x + 40, base_y + 16), (boat_x + 28, base_y + 30), (boat_x - 28, base_y + 30)), fill=roof)
    draw.pieslice((boat_x - 30, base_y + 2, boat_x + 30, base_y + 28), 180, 360, fill=roof_light)
    for side in (-1, 1):
        tx = bridge_x + side * int(240 * scale)
        draw.line((tx, base_y - 8, tx, base_y - 90), fill=stone_dark)
        for index in range(5):
            draw.line((tx, base_y - 86 + index * 12, tx + side * rng.randint(18, 34), base_y - 62 + index * 8), fill=willow)


def draw_mountain_temple(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    spec: SceneSpec,
    palette: list[str],
    rng: random.Random,
) -> None:
    width, height = img.size
    scale = _scale(spec)
    horizon = int(height * spec.composition.horizon)
    dark = pick(palette, (GREEN[1], ACCENT[5], EARTH[3]))
    mid = pick(palette, (GREEN[2], EARTH[4], "#4a4038"))
    light = pick(palette, (GREEN[4], EARTH[6], "#6b5947"))
    mist = pick(palette, (EARTH[9], EARTH[10], "#bda077"))
    temple_wall = pick(palette, (EARTH[9], WARM[9], EARTH[10]))
    roof = pick(palette, (INK[1], ACCENT[5], GREEN[1]))
    gold = pick(palette, WARM[7:10])
    pine = pick(palette, (GREEN[2], GREEN[1], GREEN[3]))
    seal = accent_color(palette, spec.accent_role)

    # 三层大山：轮廓用低频噪声，山脚用雾带分开。
    for layer, (base, amp, scale_px, color) in enumerate(
        (
            (horizon + 10, 150, 190, dark),
            (horizon + 40, 120, 120, mid),
            (horizon + 80, 92, 70, light),
        )
    ):
        noise = value_noise_1d(width, rng, scale_px)
        for x in range(width):
            top = base - int(noise[x] * amp)
            draw.line((x, top, x, min(height - 1, base + 100)), fill=color)
            if layer < 2 and bayer4(x, top) < 4:
                draw.point((x, top), fill=light if layer == 0 else mist)

    # 雾带。
    for index in range(4):
        y = horizon - 12 + index * 18
        x0 = rng.randint(-80, width // 3)
        x1 = rng.randint(width // 2, width + 80)
        draw.rectangle((x0, y, x1, y + 4), fill=mist)
        for x in range(max(0, x0), min(width, x1)):
            if bayer4(x, y) < 6:
                draw.point((x, y + 3), fill=light)

    # 山寺：台基 + 殿身 + 重檐 + 小塔。
    cx = int(width * spec.composition.landmark_x)
    base_y = horizon + 64
    hall_w = int(150 * scale)
    draw.rectangle((cx - hall_w, base_y - 14, cx + hall_w, base_y + 16), fill=temple_wall)
    draw.rectangle((cx - hall_w + 18, base_y - 66, cx + hall_w - 18, base_y - 14), fill=temple_wall)
    draw.rectangle((cx - 18, base_y - 50, cx + 18, base_y - 14), fill=roof)
    for y in (base_y - 66, base_y - 92):
        draw.polygon(
            ((cx - hall_w - 22, y), (cx - hall_w + 18, y - 26), (cx + hall_w - 18, y - 26), (cx + hall_w + 22, y)),
            fill=roof,
        )
        draw.line((cx - hall_w + 20, y - 25, cx + hall_w - 20, y - 25), fill=gold)
    draw.rectangle((cx - 4, base_y - 128, cx + 4, base_y - 92), fill=gold)
    draw.ellipse((cx - 10, base_y - 136, cx + 10, base_y - 116), fill=seal)
    # 小塔。
    tx = cx + int(180 * scale)
    for tier in range(4):
        tw = 26 - tier * 4
        ty = base_y - 24 - tier * 24
        draw.rectangle((tx - tw, ty - 16, tx + tw, ty), fill=temple_wall)
        draw.polygon(((tx - tw - 6, ty - 16), (tx, ty - 30), (tx + tw + 6, ty - 16)), fill=roof)
    draw.rectangle((tx - 2, base_y - 126, tx + 2, base_y - 112), fill=gold)

    # 松林。
    for _ in range(9):
        x = rng.randint(0, width)
        y = rng.randint(horizon + 90, height - 8)
        h = rng.randint(28, 70)
        draw.polygon(((x - 12, y), (x, y - h), (x + 12, y)), fill=pine)
        draw.rectangle((x - 2, y, x + 2, y + 8), fill=dark)


def draw_skyline(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    spec: SceneSpec,
    palette: list[str],
    rng: random.Random,
) -> None:
    width, height = img.size
    scale = _scale(spec)
    base_y = height - 62
    body = pick(palette, (WATER[1], WATER[2], ACCENT[5]))
    body_light = pick(palette, (WATER[3], WATER[4], EARTH[6]))
    body_dark = pick(palette, (INK[1], INK[0], ACCENT[5]))
    window = pick(palette, (WARM[7], WARM[8], "#ffd9a0"))
    window_dim = pick(palette, (WARM[4], EARTH[6]))
    bridge = pick(palette, (EARTH[5], EARTH[6], WATER[2]))
    water_line = pick(palette, (WATER[4], WATER[5]))
    seal = accent_color(palette, spec.accent_role)

    # 远层楼群：低对比剪影。
    for index in range(9):
        bw = int(rng.randint(38, 72) * scale)
        bh = int(rng.randint(80, 190) * scale)
        x = int(width * (0.08 + index * 0.105)) + rng.randint(-18, 18)
        draw.rectangle((x - bw, base_y - bh, x + bw, base_y), fill=body_dark)
        for wy in range(base_y - bh + 16, base_y - 10, 14):
            if rng.random() < 0.35:
                draw.rectangle((x - bw + 8, wy, x + bw - 8, wy + 2), fill=window_dim)

    # 近层塔楼：更高、更亮，错落。
    towers = (
        (-0.32, 250, 62),
        (-0.18, 300, 48),
        (-0.04, 210, 70),
        (0.12, 340, 46),
        (0.27, 260, 58),
        (0.4, 190, 64),
    )
    for offset, tower_h, tower_w in towers:
        cx = int(width * (0.5 + offset)) + rng.randint(-8, 8)
        bh = int(tower_h * scale)
        bw = int(tower_w * scale)
        draw.rectangle((cx - bw, base_y - bh, cx + bw, base_y), fill=body)
        draw.rectangle((cx - bw, base_y - bh, cx - bw + 8, base_y), fill=body_light)
        draw.rectangle((cx + bw - 8, base_y - bh, cx + bw, base_y), fill=body_dark)
        # 窗格。
        for row in range(base_y - bh + 18, base_y - 12, 16):
            for col in range(cx - bw + 12, cx + bw - 10, 16):
                if rng.random() < 0.62:
                    color = window if rng.random() < 0.35 else window_dim
                    draw.rectangle((col, row, col + 5, row + 4), fill=color)
        # 顶部天线/灯。
        draw.line((cx, base_y - bh, cx, base_y - bh - 22), fill=body_dark)
        if abs(offset) < 0.2:
            draw.rectangle((cx - 2, base_y - bh - 24, cx + 2, base_y - bh - 20), fill=seal)

    # 江面桥与倒影线。
    draw.rectangle((0, base_y + 4, width - 1, base_y + 12), fill=bridge)
    for x in range(0, width, 18):
        draw.line((x, base_y + 14, x + rng.randint(4, 14), base_y + 14), fill=water_line)
    for _ in range(20):
        x = rng.randint(0, width - 1)
        y = rng.randint(base_y + 16, height - 8)
        draw.rectangle((x, y, min(width - 1, x + rng.randint(4, 18)), y), fill=window_dim)


LANDMARK_DRAWERS: dict[str, Callable] = {
    "cliff_buddha": draw_cliff_buddha,
    "pagoda": draw_pagoda,
    "palace_gate": draw_palace_gate,
    "water_town": draw_water_town,
    "mountain_temple": draw_mountain_temple,
    "skyline": draw_skyline,
}
