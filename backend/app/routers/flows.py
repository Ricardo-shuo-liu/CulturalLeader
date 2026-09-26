"""城市游玩流程接口：CRUD、复制、单流程优化（LKH TSPTW + 腾讯真实时长）。"""

from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

from ..config import get_settings
from ..services import flow_store
from ..services.tencent_map import MapError, MapKeyMissing, MapQuotaExceeded, TencentMapClient
from ..services.trip_optimizer import optimize_day

router = APIRouter(prefix="/api/flows", tags=["flows"])


class FlowCreate(BaseModel):
    city: dict | None = None
    name: str | None = None


class OptimizeRequest(BaseModel):
    transport: str | None = None
    mode: str | None = None
    objective: str | None = None
    day_start: str | None = None
    day_end: str | None = None
    start: dict | None = None
    end: dict | None = None
    keep_locked: bool = True


def _client() -> TencentMapClient:
    return TencentMapClient(get_settings())


def _map_error(error: MapError) -> HTTPException:
    """错误契约：409 缺 Key / 429 超配额 / 502 上游异常（前端据 code 提示并标注估算）。"""
    if isinstance(error, MapKeyMissing):
        return HTTPException(status_code=409, detail={"code": "MAP_KEY_MISSING", "message": str(error)})
    if isinstance(error, MapQuotaExceeded):
        return HTTPException(status_code=429, detail={"code": "MAP_QUOTA_EXCEEDED", "message": str(error)})
    return HTTPException(status_code=502, detail={"code": "MAP_UPSTREAM_ERROR", "message": str(error)})


@router.get("")
def list_flows(city: str = "") -> dict:
    items = flow_store.list_flows(city or None)
    return {"count": len(items), "flows": items}


@router.post("")
def create_flow(payload: FlowCreate) -> dict:
    try:
        return flow_store.create_flow(payload.city, payload.name)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/import")
def import_flow(payload: dict = Body(...)) -> dict:
    try:
        return flow_store.import_flow(payload)
    except (ValueError, flow_store.FlowNotFound) as error:
        raise HTTPException(status_code=400, detail=f"导入失败：{error}") from error


@router.get("/{flow_id}")
def get_flow(flow_id: str) -> dict:
    try:
        return flow_store.load_flow(flow_id)
    except flow_store.FlowNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.put("/{flow_id}")
def update_flow(flow_id: str, payload: dict = Body(...)) -> dict:
    flow = dict(payload)
    flow["id"] = flow_id
    try:
        return flow_store.save_flow(flow)
    except (ValueError, flow_store.FlowNotFound) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.delete("/{flow_id}")
def delete_flow(flow_id: str) -> dict:
    try:
        flow_store.delete_flow(flow_id)
    except flow_store.FlowNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"status": "deleted", "id": flow_id}


@router.post("/{flow_id}/duplicate")
def duplicate_flow(flow_id: str, payload: dict | None = Body(default=None)) -> dict:
    try:
        return flow_store.duplicate_flow(flow_id, (payload or {}).get("name"))
    except flow_store.FlowNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/{flow_id}/optimize")
def optimize(flow_id: str, payload: OptimizeRequest) -> dict:
    try:
        flow = flow_store.load_flow(flow_id)
    except flow_store.FlowNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    transport = payload.transport or payload.mode
    if transport:
        flow["transport"] = transport
    if payload.objective:
        flow["objective"] = payload.objective
    if payload.day_start:
        flow["day_start"] = payload.day_start
    if payload.day_end:
        flow["day_end"] = payload.day_end
    if payload.start is not None:
        flow["start"] = payload.start
    if payload.end is not None:
        flow["end"] = payload.end
    if not flow.get("points"):
        raise HTTPException(status_code=400, detail="这条流程还没有点位，先加入要去的点")
    if not flow.get("start"):
        first = flow["points"][0]
        flow["start"] = {"name": "出发点", "lng": first["lng"], "lat": first["lat"], "time": flow.get("day_start")}

    try:
        plan = optimize_day(flow_store.flow_to_day(flow), client=_client(), keep_locked=payload.keep_locked)
    except MapError as error:
        raise _map_error(error) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    flow = flow_store.apply_plan(flow, plan)
    saved = flow_store.save_flow(flow)
    return {"flow": saved, "plan": saved["plan"]}
