"""抓取 Live2D 运行时到 frontend/vendor/live2d（免 Node 构建）。

来源：npmmirror（npm 镜像）
  pixi.js@6.5.10            MIT
  pixi-live2d-display@0.4.0 MIT
  @ai-zen/live2d-core@1.0.2 Live2D Cubism Core（Live2D 官方许可，见 RedistributableFiles.txt）

加载顺序（见 frontend/index.html）：
  pixi.min.js → live2dcubismcore.global.js → cubism4.min.js
"""

from __future__ import annotations

import io
import json
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "frontend" / "vendor" / "live2d"
REGISTRY = "https://registry.npmmirror.com"

PACKAGES = {
    "pixi.js": {"version": "6.5.10", "file": "dist/browser/pixi.min.js", "as": "pixi.min.js"},
    "pixi-live2d-display": {"version": "0.4.0", "file": "dist/cubism4.min.js", "as": "cubism4.min.js"},
    "@ai-zen/live2d-core": {
        "version": "1.0.2",
        "file": "live2dcubismcore.global.js",
        "as": "live2dcubismcore.global.js",
    },
}

EXTRA_FILES = [("pixi-live2d-display", "LICENSE", "LICENSE.pixi-live2d-display")]


def download(name: str, version: str) -> tarfile.TarFile:
    base = name.split("/")[-1]
    url = f"{REGISTRY}/{name}/-/{base}-{version}.tgz"
    print(f"[live2d] {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "CulturalLeader/0.1"})
    with urllib.request.urlopen(request, timeout=180) as response:  # noqa: S310
        return tarfile.open(fileobj=io.BytesIO(response.read()), mode="r:gz")


def extract(archive: tarfile.TarFile, member_path: str, target: Path) -> bool:
    try:
        member = archive.getmember(f"package/{member_path}")
    except KeyError:
        print(f"  缺少 {member_path}")
        return False
    stream = archive.extractfile(member)
    if stream is None:
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(stream.read())
    print(f"  -> {target.relative_to(ROOT)} ({target.stat().st_size / 1024:.0f} KB)")
    return True


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    archives: dict[str, tarfile.TarFile] = {}
    for name, spec in PACKAGES.items():
        archive = archives.setdefault(name, download(name, spec["version"]))
        extract(archive, spec["file"], TARGET / spec["as"])
    for name, member, as_name in EXTRA_FILES:
        extract(archives[name], member, TARGET / as_name)
    extract(archives["@ai-zen/live2d-core"], "RedistributableFiles.txt", TARGET / "RedistributableFiles.txt")

    manifest_path = ROOT / "frontend" / "vendor" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    manifest["live2d"] = {
        "source": REGISTRY,
        "files": [
            "vendor/live2d/pixi.min.js",
            "vendor/live2d/live2dcubismcore.global.js",
            "vendor/live2d/cubism4.min.js",
        ],
        "versions": {name: spec["version"] for name, spec in PACKAGES.items()},
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print("[done] frontend/vendor/live2d 就绪，manifest 已更新")


if __name__ == "__main__":
    main()
