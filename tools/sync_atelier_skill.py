#!/usr/bin/env python3
"""把项目级 pixel-asset-master Skill 同步为后端运行时 bundle。

用法：
    python tools/sync_atelier_skill.py
    python tools/sync_atelier_skill.py --check

`--check` 只比较，不写文件；有差异时退出码 1，适合 CI 或部署前自检。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SKILL_SOURCE = PROJECT_ROOT / ".claude" / "skills" / "pixel-asset-master"
SPEC_LOCK = PROJECT_ROOT / "projects" / "LongmenDetail_64x64_20261118" / "spec_lock.md"
BUNDLE = PROJECT_ROOT / "backend" / "app" / "services" / "atelier" / "skill_bundle"

STYLE = {
    "name": "InkGongbi48",
    "canvas": [960, 540],
    "base_size": 64,
    "sub_style": "Dense Detail + 选择性描边",
    "shading": "3-tone",
    "dithering": "selective",
    "light_direction": "top-left",
    "rules": [
        "alpha only 0 or 255",
        "no anti-aliasing, gradients, or subpixels",
        "2x2 to 3x3 intentional pixel clusters",
        "light from top-left",
    ],
}


def read_palette() -> list[str]:
    if not SPEC_LOCK.exists():
        raise SystemExit(f"找不到 spec_lock.md：{SPEC_LOCK}")
    colors: list[str] = []
    in_colors = False
    for raw in SPEC_LOCK.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line in {"colors:", "- colors:"}:
            in_colors = True
            continue
        if in_colors:
            if line.startswith("- #"):
                colors.append(line[2:].strip())
                continue
            if line:
                break
    if len(colors) != 48 or len(set(colors)) != 48:
        raise SystemExit(f"InkGongbi48 应为 48 个唯一颜色，实际 {len(colors)} / {len(set(colors))}")
    return colors


def desired_files() -> dict[str, bytes]:
    palette = json.dumps(
        {"name": "InkGongbi48", "colors": read_palette()},
        ensure_ascii=False,
        indent=2,
    ) + "\n"
    style = json.dumps(STYLE, ensure_ascii=False, indent=2) + "\n"
    files = {
        "SKILL.md": (SKILL_SOURCE / "SKILL.md").read_bytes(),
        "references/executor-pixel.md": (SKILL_SOURCE / "references" / "executor-pixel.md").read_bytes(),
        "palettes/ink_gongbi48.json": palette.encode("utf-8"),
        "style.json": style.encode("utf-8"),
    }
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="只检查，不写入")
    args = parser.parse_args()

    files = desired_files()
    mismatches: list[str] = []
    for rel, content in files.items():
        target = BUNDLE / rel
        if not target.exists() or target.read_bytes() != content:
            mismatches.append(rel)

    if args.check:
        if mismatches:
            print("bundle 与源 Skill/spec_lock 不一致：")
            for rel in mismatches:
                print(f"  - {rel}")
            print("运行 python tools/sync_atelier_skill.py 更新。")
            return 1
        print("atelier skill bundle 已是最新。")
        return 0

    for rel, content in files.items():
        target = BUNDLE / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        print(f"wrote {target.relative_to(PROJECT_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
