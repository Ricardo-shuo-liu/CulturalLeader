from __future__ import annotations

import asyncio
import random
from collections.abc import AsyncIterator
from dataclasses import dataclass

from ...config import get_settings
from .agent import build_scene_spec
from .palette import quantize_to_palette, validate_scene_image
from .renderer import draw_scene, make_postcard, to_2x
from .scene_spec import build_rule_scene
from .search import SearchHit, search_place
from .skill_loader import load_style_contract
from .storage import cleanup_old_jobs, save_job

LANDMARK_LABELS = {
    "cliff_buddha": "崖壁大佛",
    "pagoda": "古塔",
    "palace_gate": "城门宫阙",
    "water_town": "水乡",
    "mountain_temple": "山寺",
    "skyline": "天际线",
}
TIME_LABELS = {"dawn": "清晨", "day": "正午", "dusk": "黄昏", "night": "夜色"}


@dataclass(frozen=True)
class AtelierEvent:
    event: str
    data: dict


def _stage(key: str, status: str, label: str, detail: str = "", tool: str = "") -> AtelierEvent:
    data = {"key": key, "status": status, "label": label, "detail": detail}
    if tool:
        data["tool"] = tool
    return AtelierEvent("stage", data)


def _relevant_hits(hits: list[SearchHit], place: str, landmark: str) -> list[SearchHit]:
    """过滤掉与地点/地标完全无关的搜索命中；全被过滤时保留原结果。"""

    terms = [term for term in (place, landmark) if term and term not in {"远方", "山水"}]
    if not terms or not hits:
        return hits
    by_title = [hit for hit in hits if any(term in hit.title for term in terms)]
    if by_title:
        return by_title
    by_summary = [hit for hit in hits if any(term in hit.summary for term in terms)]
    return by_summary or hits


def _source_event(hit: SearchHit) -> AtelierEvent:
    return AtelierEvent(
        "source",
        {
            "title": hit.title,
            "url": hit.url,
            "publisher": hit.publisher,
            "license": hit.license,
        },
    )


async def _render_with_progress(spec, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop):
    def progress(percent: int, detail: str) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, (percent, detail))

    return await asyncio.to_thread(draw_scene, spec, progress)


async def stream_generation(
    prompt: str,
    *,
    seed: int | None = None,
    session_id: str = "",
) -> AsyncIterator[AtelierEvent]:
    settings = get_settings()
    chosen_seed = seed if seed is not None else random.SystemRandom().randint(1, 2**31 - 1)
    current_stage = ""
    try:
        yield _stage("intent", "active", "正在理解你的描述")
        rule_spec = build_rule_scene(prompt, seed=chosen_seed)
        yield _stage(
            "intent",
            "done",
            "理解完成",
            f"{rule_spec.place} · {rule_spec.landmark}",
        )

        current_stage = "search"
        yield _stage("search", "active", "正在检索地方资料", rule_spec.landmark or rule_spec.place, "web_search")
        query = " ".join(part for part in (rule_spec.place, rule_spec.landmark) if part) or prompt
        sources = _relevant_hits(
            await search_place(query, timeout=settings.atelier_search_timeout),
            rule_spec.place,
            rule_spec.landmark,
        )
        for hit in sources:
            yield _source_event(hit)
        source_detail = f"维基百科 · {len(sources)} 条" if sources else "站内资料（外部检索不可用）"
        yield _stage("search", "done", "资料检索完成", source_detail)

        current_stage = "skill"
        yield _stage("skill", "active", "正在加载像素 Skill")
        contract = load_style_contract()
        yield _stage(
            "skill",
            "done",
            "像素 Skill 已加载",
            f"{contract.name} · {len(contract.palette)} 色 · {contract.canvas[0]}×{contract.canvas[1]}",
        )

        current_stage = "plan"
        yield _stage("plan", "active", "正在设计画面")
        spec = await build_scene_spec(prompt, sources=sources, seed=chosen_seed)
        plan_detail = f"{LANDMARK_LABELS.get(spec.landmark_type, spec.landmark_type)} · {TIME_LABELS.get(spec.time, spec.time)}"
        if spec.weather != "clear":
            plan_detail += f" · {spec.weather}"
        yield _stage("plan", "done", "画面设计完成", plan_detail)

        current_stage = "render"
        yield _stage("render", "active", "正在绘制场景")
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()
        render_task = asyncio.create_task(_render_with_progress(spec, queue, loop))
        while True:
            get_task = asyncio.create_task(queue.get())
            done, _ = await asyncio.wait({get_task, render_task}, return_when=asyncio.FIRST_COMPLETED)
            if get_task in done:
                percent, detail = get_task.result()
                yield AtelierEvent("progress", {"key": "render", "percent": percent, "detail": detail})
            else:
                get_task.cancel()
                break
        scene = await render_task
        yield _stage("render", "done", "场景绘制完成")

        current_stage = "validate"
        yield _stage("validate", "active", "正在逐像素校验")
        result = validate_scene_image(scene)
        if not result.ok:
            scene = quantize_to_palette(scene)
            result = validate_scene_image(scene)
        if not result.ok:
            yield _stage("validate", "error", "像素校验失败", result.message)
            yield AtelierEvent("error", {"message": f"像素校验失败：{result.message}"})
            return
        yield _stage("validate", "done", "逐像素校验通过", result.message)

        current_stage = "export"
        yield _stage("export", "active", "正在导出场景")
        scene_2x = to_2x(scene)
        postcard = make_postcard(scene, spec)
        artifacts = save_job(spec, scene, scene_2x, postcard)
        cleanup_old_jobs(settings.atelier_max_jobs)
        yield _stage("export", "done", "导出完成", "PNG · 明信片 · zip")
        yield AtelierEvent(
            "done",
            {
                "job_id": artifacts.job_id,
                "session_id": session_id,
                "title": spec.title,
                "subtitle": spec.subtitle,
                "scene": f"/api/atelier/files/{artifacts.job_id}/scene@2x.png",
                "scene_native": f"/api/atelier/files/{artifacts.job_id}/scene.png",
                "postcard": f"/api/atelier/files/{artifacts.job_id}/postcard.png",
                "zip": f"/api/atelier/files/{artifacts.job_id}/scene.zip",
                "spec": spec.model_dump(),
                "validation": {
                    "colors": result.colors,
                    "alpha_ok": result.alpha_ok,
                    "size_ok": result.size_ok,
                    "message": result.message,
                },
            },
        )
    except Exception as error:  # noqa: BLE001 SSE 必须给出可读错误
        if current_stage:
            yield _stage(current_stage, "error", "造境中断", str(error))
        yield AtelierEvent("error", {"message": f"造境失败：{error}"})
