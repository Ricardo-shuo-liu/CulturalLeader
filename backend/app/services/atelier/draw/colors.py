from __future__ import annotations

from ..palette import hex_to_rgb

INK = ("#0e0f12", "#1a1c20", "#26282b", "#33322f")
EARTH = ("#403b34", "#4a4038", "#5a4c3e", "#6b5947", "#7d6852", "#91785e", "#a68a68", "#bda077", "#d4ba90", "#e8d2ae", "#f2e5c8")
GREEN = ("#24352c", "#2e4636", "#3a5742", "#48694e", "#5b7f5c", "#73966e", "#8fae82", "#aac49a")
WATER = ("#1b2f38", "#254452", "#315866", "#3f6e7a", "#54848c", "#6d9ba0", "#8bb4b0")
WARM = ("#3d3350", "#54405c", "#744f5e", "#96655f", "#b87a62", "#d18f67", "#e6a96f", "#f4c27e", "#ffd9a0", "#fff0cc")
SKIN = ("#e8c49c", "#c99a72")
ACCENT = ("#3f6a8a", "#2e4d66", "#b5503f", "#8f3a30", "#7a5436", "#2c3a4a")

TIME_RAMPS = {
    "dawn": ("#3d3350", "#54405c", "#744f5e", "#96655f", "#d18f67", "#f4c27e", "#fff0cc"),
    "day": ("#315866", "#3f6e7a", "#54848c", "#6d9ba0", "#8bb4b0", "#f2e5c8"),
    "dusk": ("#3d3350", "#54405c", "#744f5e", "#b87a62", "#d18f67", "#e6a96f", "#f4c27e", "#ffd9a0"),
    "night": ("#0e0f12", "#1a1c20", "#2c3a4a", "#254452", "#315866", "#3f6e7a"),
}

MOOD_SHIFT = {
    "serene": 0,
    "majestic": 1,
    "lonely": -1,
    "bustling": 1,
    "dreamy": 0,
}

ACCENT_COLORS = {
    "seal": "#b5503f",
    "gold": "#e8d2ae",
    "jade": "#7fb8ae" if "#7fb8ae" in WARM else "#8fae82",
    "stone": "#91785e",
    "ochre": "#a68a68",
}


def pick(palette: list[str], candidates: tuple[str, ...]) -> str:
    """优先取 candidates 中在色板里的颜色；否则取最近的色板色。"""

    for value in candidates:
        if value in palette:
            return value
    if not palette:
        return candidates[0]
    wanted = hex_to_rgb(candidates[0])
    return min(
        palette,
        key=lambda value: sum((a - b) ** 2 for a, b in zip(hex_to_rgb(value), wanted)),
    )


def ramp(palette: list[str], values: tuple[str, ...]) -> list[str]:
    return [pick(palette, (value,)) for value in values]


def accent_color(palette: list[str], role: str) -> str:
    return pick(palette, (ACCENT_COLORS.get(role, "#91785e"),))
