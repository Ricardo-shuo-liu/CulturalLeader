from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from PIL import Image

PALETTE_PATH = Path(__file__).resolve().parent / "skill_bundle" / "palettes" / "ink_gongbi48.json"
SCENE_SIZE = (960, 540)


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    colors: int
    alpha_ok: bool
    size_ok: bool
    message: str


@lru_cache(maxsize=1)
def load_palette() -> list[str]:
    data = json.loads(PALETTE_PATH.read_text(encoding="utf-8"))
    return [str(value) for value in data["colors"]]


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    text = value.strip().lstrip("#")
    return int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)


@lru_cache(maxsize=1)
def _palette_rgb() -> tuple[tuple[int, int, int], ...]:
    return tuple(hex_to_rgb(value) for value in load_palette())


def validate_scene_image(img: Image.Image, *, palette: list[str] | None = None) -> ValidationResult:
    colors = set(_palette_rgb() if palette is None else (hex_to_rgb(value) for value in palette))
    rgba = img.convert("RGBA")
    size_ok = rgba.size == SCENE_SIZE
    alpha_ok = True
    off_palette = 0
    seen: set[tuple[int, int, int]] = set()
    for red, green, blue, alpha in rgba.getdata():
        if alpha not in (0, 255):
            alpha_ok = False
        if alpha == 0:
            continue
        rgb = (red, green, blue)
        seen.add(rgb)
        if rgb not in colors:
            off_palette += 1
    color_count_ok = len(seen) <= 48
    ok = size_ok and alpha_ok and off_palette == 0 and color_count_ok
    if not size_ok:
        message = f"size {rgba.size[0]}x{rgba.size[1]} != 960x540"
    elif not alpha_ok:
        message = "alpha must be only 0 or 255"
    elif off_palette:
        message = f"{off_palette} off-palette pixel(s)"
    elif not color_count_ok:
        message = f"{len(seen)} colors > 48"
    else:
        message = f"{len(seen)} colors · alpha 0/255 · {rgba.size[0]}x{rgba.size[1]}"
    return ValidationResult(
        ok=ok,
        colors=len(seen),
        alpha_ok=alpha_ok,
        size_ok=size_ok,
        message=message,
    )


def quantize_to_palette(img: Image.Image, *, palette: list[str] | None = None) -> Image.Image:
    """把非透明像素映射到色板最近色；alpha 归一到 0/255。"""

    colors = _palette_rgb() if palette is None else tuple(hex_to_rgb(value) for value in palette)
    rgba = img.convert("RGBA")
    source = rgba.getdata()
    output = []
    cache: dict[tuple[int, int, int], tuple[int, int, int]] = {}
    for red, green, blue, alpha in source:
        if alpha == 0:
            output.append((0, 0, 0, 0))
            continue
        rgb = (red, green, blue)
        nearest = cache.get(rgb)
        if nearest is None:
            nearest = min(
                colors,
                key=lambda candidate: (candidate[0] - red) ** 2
                + (candidate[1] - green) ** 2
                + (candidate[2] - blue) ** 2,
            )
            cache[rgb] = nearest
        output.append((nearest[0], nearest[1], nearest[2], 255))
    result = Image.new("RGBA", rgba.size)
    result.putdata(output)
    return result
