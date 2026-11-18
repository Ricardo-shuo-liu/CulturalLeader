from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

BUNDLE_DIR = Path(__file__).resolve().parent / "skill_bundle"


@dataclass(frozen=True)
class StyleContract:
    name: str
    canvas: tuple[int, int]
    base_size: int
    palette: list[str]
    sub_style: str
    shading: str
    dithering: str
    light_direction: str
    rules: tuple[str, ...]
    skill_md: str


@lru_cache(maxsize=1)
def load_style_contract() -> StyleContract:
    """读取打包进后端的 pixel-asset-master 契约。

    运行时不再执行 Skill 脚本；这里只读取规范、色板与校验规则来源。
    """

    palette_data = json.loads((BUNDLE_DIR / "palettes" / "ink_gongbi48.json").read_text(encoding="utf-8"))
    style_data = json.loads((BUNDLE_DIR / "style.json").read_text(encoding="utf-8"))
    skill_md = (BUNDLE_DIR / "SKILL.md").read_text(encoding="utf-8")
    canvas = tuple(int(value) for value in style_data["canvas"])
    return StyleContract(
        name=str(style_data["name"]),
        canvas=(canvas[0], canvas[1]),
        base_size=int(style_data["base_size"]),
        palette=[str(value) for value in palette_data["colors"]],
        sub_style=str(style_data["sub_style"]),
        shading=str(style_data["shading"]),
        dithering=str(style_data["dithering"]),
        light_direction=str(style_data["light_direction"]),
        rules=tuple(str(value) for value in style_data["rules"]),
        skill_md=skill_md,
    )
