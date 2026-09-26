"""抓取 Live2D 官方示例模型到 frontend/assets/live2d/model/。

默认抓 Hiyori（Live2D 官方 Cubism 示例模型，随 CubismWebSamples 分发）。
做法：先取 model3.json，再按它的 FileReferences 精确下载被引用的文件，
所以不需要目录列表接口，也不会漏文件。

用法：
    python tools/fetch_live2d_sample.py                 # 默认 Hiyori
    python tools/fetch_live2d_sample.py --name Haru     # 其它官方示例
    python tools/fetch_live2d_sample.py --source raw    # 换 raw.githubusercontent
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "frontend" / "assets" / "live2d" / "model"
CONFIG = ROOT / "frontend" / "assets" / "live2d" / "config.json"

SOURCES = {
    "jsdelivr": "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources",
    "raw": "https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources",
}


def download(url: str, timeout: int = 300) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "CulturalLeader/0.1"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        return response.read()


def fetch(base: str, name: str, relative: str, target: Path) -> int:
    url = f"{base}/{name}/{relative}"
    data = download(url)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    print(f"  {relative}  {len(data) / 1024:.0f} KB")
    return len(data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default="Hiyori")
    parser.add_argument("--source", default="jsdelivr", choices=sorted(SOURCES))
    args = parser.parse_args()

    base = SOURCES[args.source]
    model_url = f"{base}/{args.name}/{args.name}.model3.json"
    print(f"[live2d] {model_url}")
    model = json.loads(download(model_url))

    TARGET.mkdir(parents=True, exist_ok=True)
    total = fetch(base, args.name, f"{args.name}.model3.json", TARGET / f"{args.name}.model3.json")

    references = model.get("FileReferences", {})
    files: list[str] = []
    if references.get("Moc"):
        files.append(references["Moc"])
    files += references.get("Textures") or []
    for key in ("Physics", "Pose", "UserData", "DisplayInfo", "CDI3"):
        value = references.get(key)
        if isinstance(value, str):
            files.append(value)
    for group in (references.get("Motions") or {}).values():
        files += [item["File"] for item in group if item.get("File")]
    for item in references.get("Expressions") or []:
        if item.get("File"):
            files.append(item["File"])

    for relative in sorted(set(files)):
        total += fetch(base, args.name, relative, TARGET / relative)

    print(f"[live2d] 共 {total / 1024 / 1024:.1f} MB -> {TARGET.relative_to(ROOT)}")

    if CONFIG.exists():
        config = json.loads(CONFIG.read_text(encoding="utf-8"))
        config["model"] = f"model/{args.name}.model3.json"
        CONFIG.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"[live2d] config.json 已指向 model/{args.name}.model3.json")


if __name__ == "__main__":
    main()
