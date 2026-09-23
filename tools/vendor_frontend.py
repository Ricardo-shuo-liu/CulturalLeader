"""把前端依赖抓到 frontend/vendor（免 Node 构建）。

three 从 npmmirror 的 npm 包取 build 与 examples/jsm；
pixiv/three-vrm 取 jsdelivr 的 ESM 单文件包，并把包内写死的 CDN 绝对路径
（如 /npm/three@0.185.1/+esm）改写为裸标识符 three，交给页面 importmap
解析到本地 vendor，从而完全离线可用。
"""

from __future__ import annotations

import io
import json
import re
import shutil
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "frontend" / "vendor"

NPM_REGISTRY = "https://registry.npmmirror.com"
JSDELIVR = "https://cdn.jsdelivr.net/npm"

# 与 three-vrm 的构建目标保持一致，避免同页出现两份 three
THREE_VERSION = "0.185.1"
VRM_VERSION = ""  # 留空则取 registry 上的 latest


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


def fetch_three_vrm(version: str) -> dict:
    url = f"{JSDELIVR}/@pixiv/three-vrm@{version}/+esm"
    print(f"[three-vrm] {url}")
    text = download(url).decode("utf-8")
    rewritten = re.sub(r'from"/npm/three@[^"]+"', 'from"three"', text)
    rewritten = re.sub(r'import"/npm/three@[^"]+"', 'import"three"', rewritten)
    target = VENDOR / "three-vrm" / "three-vrm.module.js"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(rewritten, encoding="utf-8")
    leftovers = sorted(set(re.findall(r'"/npm/[^"]+"', rewritten)))
    print(f"[three-vrm] {len(rewritten) / 1024:.0f} KB -> {target}")
    print(f"[three-vrm] 剩余的 CDN 绝对引用：{leftovers or '无'}")
    return {"version": version, "bytes": len(rewritten), "leftovers": leftovers}


def resolve_vrm_version() -> str:
    if VRM_VERSION:
        return VRM_VERSION
    data = json.loads(download(f"{NPM_REGISTRY}/@pixiv/three-vrm/latest").decode("utf-8"))
    print(f"[three-vrm] latest = {data['version']} peer={data.get('peerDependencies')}")
    return data["version"]


def main() -> None:
    VENDOR.mkdir(parents=True, exist_ok=True)
    three_version = fetch_three()
    vrm_version = resolve_vrm_version()
    vrm_info = fetch_three_vrm(vrm_version)

    manifest = {
        "three": {"version": three_version, "source": NPM_REGISTRY},
        "three-vrm": {"source": JSDELIVR, "detail": vrm_info},
        "importmap": {
            "three": "/vendor/three/build/three.module.js",
            "three/addons/": "/vendor/three/examples/jsm/",
            "@pixiv/three-vrm": "/vendor/three-vrm/three-vrm.module.js",
        },
    }
    (VENDOR / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print("[done] manifest -> frontend/vendor/manifest.json")


if __name__ == "__main__":
    main()
