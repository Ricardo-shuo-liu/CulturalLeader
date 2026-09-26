"""行程规划接口：行程 CRUD、单日优化、POI 检索与推荐、地图服务状态与前端配置。"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..services import trip_store
from ..services.tencent_map import MapError, MapKeyMissing, MapQuotaExceeded, TencentMapClient
from ..services.trip_optimizer import optimize_day

router = APIRouter(prefix="/api", tags=["trips"])

# 时段 → 推荐关键词（腾讯位置服务按关键词 + nearby 边界检索）
BUCKETS: dict[str, dict[str, str]] = {
    "breakfast": {"keywords": "早餐"},
    "lunch": {"keywords": "餐厅"},
    "coffee": {"keywords": "咖啡"},
    "dinner": {"keywords": "特色菜"},
    "night": {"keywords": "夜宵"},
    "shop": {"keywords": "文创"},
    "spot": {"keywords": "景点"},
}


def bucket_for_now() -> str:
    hour = datetime.now().hour
    if hour < 10:
        return "breakfast"
    if hour < 14:
        return "lunch"
    if hour < 17:
        return "coffee"
    if hour < 20:
        return "dinner"
    return "night"


class TripCreate(BaseModel):
    name: str = "未命名行程"
    days: int = Field(default=1, ge=1, le=30)
    city: dict | None = None


class OptimizeRequest(BaseModel):
    mode: str | None = None
    objective: str | None = None
    start: dict | None = None
    end: dict | None = None
    keep_locked: bool = True


def _client() -> TencentMapClient:
    return TencentMapClient(get_settings())


def _map_error(error: MapError) -> HTTPException:
    """错误契约：409 缺 Key / 429 超配额 / 502 上游异常。"""
    if isinstance(error, MapKeyMissing):
        return HTTPException(status_code=409, detail={"code": "MAP_KEY_MISSING", "message": str(error)})
    if isinstance(error, MapQuotaExceeded):
        return HTTPException(status_code=429, detail={"code": "MAP_QUOTA_EXCEEDED", "message": str(error)})
    return HTTPException(status_code=502, detail={"code": "MAP_UPSTREAM_ERROR", "message": str(error)})


@router.get("/config")
def public_config() -> dict:
    settings = get_settings()
    return {
        "provider": "tencent",
        "map_js_key": settings.tencent_map_js_key,
        "map_ready": settings.map_ready,
        "allow_estimate": settings.allow_estimate,
    }


@router.get("/map/selftest")
def map_selftest() -> dict:
    """逐项自检地图服务能力，返回可直接展示给用户的结论。"""
    settings = get_settings()
    client = _client()
    checks: list[dict] = []

    if not settings.tencent_map_key:
        checks.append(
            {
                "name": "Web 服务 Key",
                "ok": False,
                "hint": "在 .env 填 TENCENT_MAP_KEY（腾讯位置服务 → 控制台 → key管理 → WebServiceAPI）",
            }
        )
    else:
        try:
            client.district_list()
            checks.append({"name": "行政区划接口", "ok": True, "hint": "WebService Key 可用"})
        except MapError as error:
            checks.append({"name": "行政区划接口", "ok": False, "hint": str(error)})
        try:
            client.poi_search("咖啡", city="北京市", offset=1)
            checks.append({"name": "POI 搜索", "ok": True, "hint": "可用于搜索与附近推荐"})
        except MapError as error:
            checks.append({"name": "POI 搜索", "ok": False, "hint": str(error)})
        try:
            client.route("walking", {"lng": 116.397, "lat": 39.908}, {"lng": 116.407, "lat": 39.916})
            checks.append({"name": "路径规划", "ok": True, "hint": "可计算真实通勤时长"})
        except MapError as error:
            checks.append({"name": "路径规划", "ok": False, "hint": str(error)})

    checks.append(
        {
            "name": "JS Key（浏览器地图）",
            "ok": bool(settings.tencent_map_js_key),
            "hint": "已配置，记得把 127.0.0.1 与线上域名加入白名单"
            if settings.tencent_map_js_key
            else "未配置：城内规划会使用 canvas 示意图（功能可用，无真实底图）",
        }
    )
    return {"ok": all(item["ok"] for item in checks[:1]) and all(item["ok"] for item in checks if item["name"] != "JS Key（浏览器地图）"), "checks": checks}


@router.get("/map/status")
def map_status() -> dict:
    return _client().status()


@router.get("/trips")
def list_trips() -> list[dict]:
    return trip_store.list_trips()


@router.post("/trips")
def create_trip(payload: TripCreate) -> dict:
    return trip_store.create_trip(payload.name, payload.days, payload.city)


@router.post("/trips/import")
def import_trip(payload: dict = Body(...)) -> dict:
    try:
        return trip_store.import_trip(payload)
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"导入失败：{error}") from error


@router.get("/trips/{trip_id}")
def get_trip(trip_id: str) -> dict:
    try:
        return trip_store.load_trip(trip_id)
    except trip_store.TripNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.put("/trips/{trip_id}")
def update_trip(trip_id: str, payload: dict = Body(...)) -> dict:
    trip = dict(payload)
    trip["id"] = trip_id
    return trip_store.save_trip(trip)


@router.delete("/trips/{trip_id}")
def delete_trip(trip_id: str) -> dict:
    trip_store.delete_trip(trip_id)
    return {"status": "deleted", "id": trip_id}


@router.post("/trips/{trip_id}/days/{day_index}/optimize")
def optimize(trip_id: str, day_index: int, payload: OptimizeRequest) -> dict:
    try:
        trip = trip_store.load_trip(trip_id)
    except trip_store.TripNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    day = next((item for item in trip.get("days", []) if int(item.get("index")) == day_index), None)
    if day is None:
        raise HTTPException(status_code=404, detail=f"第 {day_index} 天不存在")
    if payload.mode:
        day["mode"] = payload.mode
    if payload.objective:
        day["objective"] = payload.objective
    if payload.start is not None:
        day["start"] = payload.start
    if payload.end is not None:
        day["end"] = payload.end
    if not day.get("stops"):
        raise HTTPException(status_code=400, detail="当天还没有点位，先添加要去的点")
    if not day.get("start"):
        first = day["stops"][0]
        day["start"] = {"name": "出发点", "lng": first["lng"], "lat": first["lat"], "time": day.get("day_start") or "09:00"}

    try:
        plan = optimize_day(day, client=_client(), keep_locked=payload.keep_locked)
    except MapError as error:
        raise _map_error(error) from error

    day["plan"] = plan
    day["manual"] = False
    trip_store.save_trip(trip)
    return {"day": day_index, "plan": plan}


@router.get("/poi/search")
def poi_search(keyword: str, city: str = "", offset: int = 20) -> dict:
    if not keyword.strip():
        raise HTTPException(status_code=400, detail="请输入搜索关键词")
    try:
        items = _client().poi_search(keyword, city=city, offset=max(1, min(offset, 25)))
    except MapError as error:
        raise _map_error(error) from error
    return {"count": len(items), "items": items}


@router.get("/poi/around")
def poi_around(lng: float, lat: float, bucket: str = "", radius: int = 2000) -> dict:
    name = bucket or bucket_for_now()
    spec = BUCKETS.get(name, BUCKETS["lunch"])
    try:
        items = _client().poi_around(lng, lat, keyword=spec["keywords"], radius=radius)
    except MapError as error:
        raise _map_error(error) from error

    def score(item: dict) -> tuple:
        rating = float(item.get("rating") or 0)
        distance = float(item.get("distance_m") or 99999)
        return (round(distance / 500), -rating)

    items.sort(key=score)
    return {"bucket": name, "keywords": spec["keywords"], "count": len(items), "items": items[:20]}


@router.get("/poi/reverse")
def poi_reverse(lng: float, lat: float) -> dict:
    """地图取点：给任意坐标配一个可读名字。

    这条接口永不失败：没有 Key、超配额或上游异常时返回「地图取点 + 坐标」并标记 estimated，
    保证用户在地图上随手点一个位置也能加点位。
    """
    try:
        return _client().reverse_geocode(lng, lat)
    except MapError as error:
        return {
            "name": "地图取点",
            "address": f"{lat:.5f}, {lng:.5f}",
            "city": "",
            "district": "",
            "adcode": "",
            "lng": lng,
            "lat": lat,
            "poi_id": "",
            "estimated": True,
            "hint": str(error),
        }


@router.get("/poi/{poi_id}")
def poi_detail(poi_id: str) -> dict:
    try:
        item = _client().poi_detail(poi_id)
    except MapError as error:
        raise _map_error(error) from error
    if item is None:
        raise HTTPException(status_code=404, detail="POI 不存在")
    return item
