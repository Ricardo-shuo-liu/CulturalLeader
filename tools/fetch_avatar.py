"""下载示例 VRM 形象（可选）。失败时前端自动使用程序化占位形象。"""

from __future__ import annotations

import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "frontend" / "assets" / "avatar.vrm"

CANDIDATES = [
    "https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm",
    "https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/three-vrm-girl.vrm",
    "https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Test.vrm",
    "https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/Seed-san/vrm/Seed-san.vrm",
]


def attempt(url: str) -> bytes | None:
    request = urllib.request.Request(url, headers={"User-Agent": "CulturalLeader/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=180) as response:  # noqa: S310
            data = response.read()
    except Exception as error:  # noqa: BLE001
        print(f"[avatar] {url} -> {error}")
        return None
    if data[:4] != b"glTF":
        print(f"[avatar] {url} -> 不是 glTF/VRM")
        return None
    return data


def main() -> None:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    for url in CANDIDATES:
        data = attempt(url)
        if data:
            TARGET.write_bytes(data)
            print(f"[avatar] {len(data) / 1024:.0f} KB -> {TARGET}")
            return
    print("[avatar] 未获取到 VRM，将使用程序化占位形象（功能不受影响）")


if __name__ == "__main__":
    main()
