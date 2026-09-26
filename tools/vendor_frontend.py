"""把舞台渲染依赖（three.js）抓到 frontend/vendor，免 Node 构建。

Live2D 运行时由 tools/vendor_live2d.py 单独抓取：
  pixi.js（MIT）/ pixi-live2d-display（MIT）/ Live2D Cubism Core（Live2D 官方许可）。
"""

from __future__ import annotations

import io
import json
import shutil
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "frontend" / "vendor"
NPM_REGISTRY = "https://registry.npmmirror.com"

THREE_VERSION = "0.185.1"


def download(url: str, timeout: int = 180) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "CulturalLeader/0.1"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        return response.read()


def fetch_three() -> str:
    url = f"{NPM_REGISTRY}/three/-/three-{THREE_VERSION}.tgz"
    print(f"[three] {url}")
    data = download(url)
    archive = tarfile.open(fileobj=io.BytesIO(data), mode="r:gz")
    target_root = VENDOR / "three"
    if target_root.exists():
        shutil.rmtree(target_root)

    kept = 0
    for member in archive.getmembers():
        if not member.isfile():
            continue
        name = member.name
        if name.startswith("package/build/") or name.startswith("package/examples/jsm/"):
            relative = name[len("package/") :]
            target = target_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            stream = archive.extractfile(member)
            if stream is None:
                continue
            target.write_bytes(stream.read())
            kept += 1
    print(f"[three] {kept} files -> {target_root}")
    return THREE_VERSION


def main() -> None:
    VENDOR.mkdir(parents=True, exist_ok=True)
    three_version = fetch_three()
    manifest_path = VENDOR / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    manifest["three"] = {"version": three_version, "source": NPM_REGISTRY}
    manifest["importmap"] = {
        "three": "/vendor/three/build/three.module.js",
        "three/addons/": "/vendor/three/examples/jsm/",
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print("[done] manifest -> frontend/vendor/manifest.json")


if __name__ == "__main__":
    main()
