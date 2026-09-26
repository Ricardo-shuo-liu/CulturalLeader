"""整体攻略接口：把多城流程组合成逐日攻略，支持调整、替换、导出与只读分享。"""

from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field

from ..config import get_settings
from ..services import flow_store, guide_builder, guide_store
from ..services.tencent_map import TencentMapClient

router = APIRouter(prefix="/api/guides", tags=["guides"])


class GuideItem(BaseModel):
    day: int | None = None
    flowId: str = ""
    notes: str = ""


class GuideCreate(BaseModel):
    name: str = "未命名攻略"
    items: list[GuideItem] = Field(default_factory=list)


def _client() -> TencentMapClient:
    return TencentMapClient(get_settings())


@router.get("")
def list_guides() -> dict:
    items = guide_store.list_guides()
    return {"count": len(items), "guides": items}


@router.post("")
def create_guide(payload: GuideCreate) -> dict:
    items = [item.model_dump() for item in payload.items if item.flowId]
    if not items:
        raise HTTPException(status_code=400, detail="至少选择一条城市流程")
    try:
        guide = guide_builder.build_guide(payload.name, items, client=_client())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    saved = guide_store.save_guide(guide)
    return guide_store.expand(saved)


@router.get("/shared/{token}")
def shared_guide(token: str) -> dict:
    try:
        guide = guide_store.find_by_token(token)
    except guide_store.GuideNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"readonly": True, "guide": guide_store.expand(guide)}


@router.get("/{guide_id}")
def get_guide(guide_id: str) -> dict:
    try:
        return guide_store.expand(guide_store.load_guide(guide_id))
    except guide_store.GuideNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.put("/{guide_id}")
def update_guide(guide_id: str, payload: dict = Body(...)) -> dict:
    try:
        current = guide_store.load_guide(guide_id)
    except guide_store.GuideNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    merged = dict(current)
    merged.update({key: value for key, value in payload.items() if key in {"name", "items", "notes"}})
    if "items" in payload:
        try:
            merged = guide_builder.recompute(merged, client=_client())
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
    return guide_store.expand(guide_store.save_guide(merged))


@router.delete("/{guide_id}")
def delete_guide(guide_id: str) -> dict:
    try:
        guide_store.delete_guide(guide_id)
    except guide_store.GuideNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"status": "deleted", "id": guide_id}


@router.post("/{guide_id}/share")
def share_guide(guide_id: str) -> dict:
    try:
        token = guide_store.ensure_share_token(guide_id)
    except guide_store.GuideNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"token": token, "path": f"/share/{token}"}


@router.post("/{guide_id}/flows/{flow_id}")
def replace_flow(guide_id: str, flow_id: str, day: int = 0) -> dict:
    """把攻略里某一天的流程替换成另一条流程（调整与替换某城流程）。"""
    try:
        guide = guide_store.load_guide(guide_id)
        flow_store.load_flow(flow_id)
    except guide_store.GuideNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except flow_store.FlowNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    target = guide.get("items") or []
    if not target:
        raise HTTPException(status_code=400, detail="攻略还没有任何一天")
    index = next((position for position, item in enumerate(target) if item["day"] == day), 0)
    target[index]["flowId"] = flow_id
    guide["items"] = target
    return guide_store.expand(guide_store.save_guide(guide_builder.recompute(guide, client=_client())))
