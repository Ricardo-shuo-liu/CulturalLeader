from __future__ import annotations

import re
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from PIL import Image

from ...config import get_settings
from .scene_spec import SceneSpec

ATELIER_DIR = Path(get_settings().atelier_dir)
_JOB_RE = re.compile(r"^[0-9a-f]{32}$")


@dataclass(frozen=True)
class JobArtifacts:
    job_id: str
    dir: Path
    scene: Path
    scene_2x: Path
    postcard: Path
    spec_json: Path
    zip: Path


def _readme(spec: SceneSpec) -> str:
    sources = "\n".join(
        f"- {item.title} · {item.publisher or '来源'} · {item.url}" + (f" · {item.license}" if item.license else "")
        for item in spec.sources
    ) or "- 无外部来源（使用站内资料与规则生成）"
    return (
        "CulturalLeader · 像素造境\n"
        "=======================\n"
        f"标题：{spec.title}\n"
        f"地点：{spec.place}\n"
        f"场景：{spec.landmark_type} / {spec.environment} / {spec.time} / {spec.weather}\n"
        f"提示词：{spec.prompt}\n"
        f"种子：{spec.seed}\n"
        "色板：InkGongbi48（48 色）\n"
        "画布：960×540；2× 导出 1920×1080；明信片 2112×1432\n"
        "\n"
        "生成方式：pixel-asset-master 风格契约 + 程序化像素绘制；未嵌入参考照片。\n"
        "\n"
        "参考来源：\n"
        f"{sources}\n"
    )


def save_job(
    spec: SceneSpec,
    scene: Image.Image,
    scene_2x: Image.Image,
    postcard: Image.Image,
) -> JobArtifacts:
    job_id = uuid4().hex
    job_dir = ATELIER_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    scene_path = job_dir / "scene.png"
    scene_2x_path = job_dir / "scene@2x.png"
    postcard_path = job_dir / "postcard.png"
    spec_path = job_dir / "scene.json"
    readme_path = job_dir / "README.txt"
    zip_path = job_dir / "scene.zip"

    scene.save(scene_path)
    scene_2x.save(scene_2x_path)
    postcard.save(postcard_path)
    spec_path.write_text(spec.model_dump_json(indent=2), encoding="utf-8")
    readme_path.write_text(_readme(spec), encoding="utf-8")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in ("scene.png", "scene@2x.png", "postcard.png", "scene.json", "README.txt"):
            archive.write(job_dir / name, arcname=name)

    return JobArtifacts(
        job_id=job_id,
        dir=job_dir,
        scene=scene_path,
        scene_2x=scene_2x_path,
        postcard=postcard_path,
        spec_json=spec_path,
        zip=zip_path,
    )


def cleanup_old_jobs(max_jobs: int = 50) -> int:
    if max_jobs < 1 or not ATELIER_DIR.exists():
        return 0
    jobs = [
        path
        for path in ATELIER_DIR.iterdir()
        if path.is_dir() and _JOB_RE.fullmatch(path.name)
    ]
    jobs.sort(key=lambda path: path.stat().st_mtime)
    removed = 0
    for path in jobs[:-max_jobs]:
        shutil.rmtree(path, ignore_errors=True)
        removed += 1
    return removed
