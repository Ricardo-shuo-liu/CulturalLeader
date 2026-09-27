"""攻略导入（抄作业）接口：链接 / 正文 / 截图 → 解析 → 定位 → 生成计划块与草稿攻略。"""

from __future__ import annotations

from fastapi import APIRouter, Body, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..config import get_settings
from ..services import flow_store, guide_store, importer
from ..services.importer import (
    ImportFetchFailed,
    ImportKeyMissing,
    ImportNotFound,
    ImportParseFailed,
)
from ..services.tencent_map import TencentMapClient

router = APIRouter(prefix="/api/imports", tags=["imports"])


class ImportRequest(BaseModel):
    url: str = ""
    text: str = ""
    engine: str = Field(default="auto", pattern="^(auto|llm|rule)$")
    city: str = ""


class ParseRequest(BaseModel):
    engine: str = Field(default="auto", pattern="^(auto|llm|rule)$")
    text: str | None = None


class ResolveRequest(BaseModel):
    day: int | None = None
    names: list[str] | None = None
    confirmed: dict | None = None  # {name: {lng, lat, poi_id, label}}


def _client() -> TencentMapClient:
    return TencentMapClient(get_settings())


def _can_use_llm() -> bool:
    return bool(get_settings().openai_api_key.strip())


async def _parse_text(text: str, engine: str, fallback_city: str) -> dict:
    want_llm = engine == "llm" or (engine == "auto" and _can_use_llm())
    if want_llm:
        try:
            parsed = await importer.llm_parse_text(text, model=get_settings().chat_model)
            parsed["days"] = importer.normalize_days(parsed.get("days"), fallback_city=fallback_city)
            return parsed
        except ImportParseFailed:
            if engine == "llm":
                raise
            parsed = importer.rule_parse(text, fallback_city=fallback_city)
            parsed["degraded_reason"] = "llm_failed"
            return parsed
    return importer.rule_parse(text, fallback_city=fallback_city)


def _merge_confirmed(previous: dict | None, days: list[dict]) -> list[dict]:
    """重新解析时保留用户已经在地图上确认过的点位。"""
    if not previous:
        return days
    confirmed: dict[str, dict] = {}
    for day in previous.get("days") or []:
        for place in day.get("places") or []:
            if place.get("status") == "confirmed" and place.get("lng") is not None:
                confirmed[str(place.get("name"))] = place
    for day in days:
        for place in day.get("places") or []:
            hit = confirmed.get(str(place.get("name")))
            if hit:
                place.update(
                    {
                        "lng": hit.get("lng"),
                        "lat": hit.get("lat"),
                        "poi_id": hit.get("poi_id") or "",
                        "confidence": hit.get("confidence") or 1.0,
                        "status": "confirmed",
                    }
                )
    return days


@router.get("")
def list_imports() -> dict:
    items = importer.list_imports()
    return {"count": len(items), "imports": items}


@router.post("")
async def create_import(payload: ImportRequest) -> dict:
    url = (payload.url or "").strip()
    text = (payload.text or "").strip()
    title = ""
    if url:
        try:
            fetched_title, fetched_text = importer.fetch_url(url)
        except ImportFetchFailed as error:
            raise HTTPException(status_code=422, detail={"code": "IMPORT_FETCH_FAILED", "message": str(error)}) from error
        title = fetched_title
        text = text or fetched_text
    if not text:
        raise HTTPException(status_code=400, detail="请提供链接或粘贴攻略正文")
    try:
        parsed = await _parse_text(text, payload.engine, payload.city)
    except ImportParseFailed as error:
        raise HTTPException(status_code=502, detail={"code": "IMPORT_PARSE_FAILED", "message": str(error)}) from error
    resolved = importer.resolve_places(parsed["days"], client=_client())
    record = importer.save_import(
        {
            "id": importer.new_id(),
            "title": title or parsed.get("title") or (text.strip().splitlines() or ["导入攻略"])[0][:30],
            "source": "url" if url else "text",
            "url": url,
            "text": text[:20000],
            "engine": parsed.get("engine") or "rule",
            "degraded": bool(resolved.get("degraded")),
            "degraded_reason": parsed.get("degraded_reason") or "",
            "days": resolved["days"],
        }
    )
    return {"import": record}


@router.post("/image")
async def create_import_from_images(files: list[UploadFile] = File(...)) -> dict:
    if not _can_use_llm():
        raise HTTPException(
            status_code=409,
            detail={
                "code": "IMPORT_KEY_MISSING",
                "message": "截图解析需要配置 OPENAI_API_KEY（可指向兼容网关）；也可以先把文字复制出来用「粘贴正文」导入",
            },
        )
    images: list[tuple[bytes, str]] = []
    for file in files[:4]:
        data = await file.read()
        if data:
            images.append((data, file.content_type or "image/png"))
    if not images:
        raise HTTPException(status_code=400, detail="没有收到图片")
    try:
        parsed = await importer.llm_parse_images(images, model=get_settings().chat_model)
    except Exception as error:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail={"code": "IMPORT_PARSE_FAILED", "message": f"截图解析失败：{error}"}
        ) from error
    parsed["days"] = importer.normalize_days(parsed.get("days"))
    resolved = importer.resolve_places(parsed["days"], client=_client())
    record = importer.save_import(
        {
            "id": importer.new_id(),
            "title": parsed.get("title") or "截图导入",
            "source": "image",
            "url": "",
            "text": "",
            "engine": "llm",
            "degraded": bool(resolved.get("degraded")),
            "days": resolved["days"],
        }
    )
    return {"import": record}


@router.get("/{import_id}")
def get_import(import_id: str) -> dict:
    try:
        return {"import": importer.load_import(import_id)}
    except ImportNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/{import_id}/parse")
async def reparse(import_id: str, payload: ParseRequest) -> dict:
    try:
        record = importer.load_import(import_id)
    except ImportNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    text = (payload.text or record.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="这条导入没有可重新解析的正文")
    try:
        parsed = await _parse_text(text, payload.engine, "")
    except ImportParseFailed as error:
        raise HTTPException(status_code=502, detail={"code": "IMPORT_PARSE_FAILED", "message": str(error)}) from error
    days = importer.normalize_days(parsed.get("days"))
    days = _merge_confirmed(record, days)
    resolved = importer.resolve_places(days, client=_client())
    record.update(
        {
            "text": text[:20000],
            "engine": parsed.get("engine") or "rule",
            "days": resolved["days"],
            "degraded": bool(resolved.get("degraded")),
            "degraded_reason": parsed.get("degraded_reason") or "",
            "committed": False,
        }
    )
    return {"import": importer.save_import(record)}


@router.post("/{import_id}/resolve")
def resolve(import_id: str, payload: ResolveRequest | None = Body(default=None)) -> dict:
    """重新定位：可整体重跑，也可只处理某一天 / 某几个地点；带 confirmed 时视为人工落位。"""
    try:
        record = importer.load_import(import_id)
    except ImportNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    payload = payload or ResolveRequest()
    manual = payload.confirmed or {}
    pending_days: list[dict] = []
    for day in record.get("days") or []:
        if payload.day is not None and int(day.get("day") or 0) != int(payload.day):
            continue
        targets = [
            place for place in (day.get("places") or []) if not payload.names or place.get("name") in payload.names
        ]
        for place in targets:
            fixed = manual.get(place.get("name"))
            if fixed and fixed.get("lng") is not None:
                place.update(
                    {
                        "lng": fixed.get("lng"),
                        "lat": fixed.get("lat"),
                        "poi_id": fixed.get("poi_id") or "",
                        "confidence": 1.0,
                        "status": "confirmed",
                    }
                )
        remaining = [place for place in targets if place.get("status") != "confirmed"]
        if remaining:
            pending_days.append({"day": day.get("day"), "city": day.get("city"), "places": remaining})
    if pending_days:
        result = importer.resolve_places(pending_days, client=_client())
        record["degraded"] = bool(result.get("degraded"))
    return {"import": importer.save_import(record)}


@router.post("/{import_id}/commit")
def commit(import_id: str) -> dict:
    try:
        record = importer.load_import(import_id)
    except ImportNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    try:
        result = importer.commit_import(record, client=_client())
    except ImportParseFailed as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    record["committed"] = True
    record["committed_flows"] = result["flows"]
    record["committed_guide"] = result["guideId"]
    importer.save_import(record)
    guide = guide_store.load_guide(result["guideId"])
    return {
        "import": record,
        "flowIds": [item["id"] for item in result["flows"]],
        "guideId": guide["id"],
        "guideName": guide.get("name"),
    }


@router.delete("/{import_id}")
def delete(import_id: str) -> dict:
    try:
        importer.delete_import(import_id)
    except ImportNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"status": "deleted", "id": import_id}
