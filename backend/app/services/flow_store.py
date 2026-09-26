"""城市游玩流程的本地文件存储（单人本地软件）：data/flows/<id>.json + index.json，原子写。

一条 flow = 一座城市的「游玩流程」：点位顺序、停留时长、固定时间、交通方式与优化结果，
可以反复复用，也可以被整体攻略（guide）引用。
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from pathlib import Path

from ..config import get_settings

DEFAULT_TRANSPORT = "taxi"
DEFAULT_OBJECTIVE = "makespan"
DEFAULT_DAY_START = "09:00"
DEFAULT_DAY_END = "20:00"
DEFAULT_DWELL = 60


class FlowNotFound(FileNotFoundError):
    pass


def flows_dir() -> Path:
    path = Path(get_settings().flows_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def flow_path(flow_id: str) -> Path:
    safe = "".join(ch for ch in str(flow_id) if ch.isalnum() or ch in "-_")
    if not safe or not safe.startswith("flow-"):
        raise FlowNotFound("流程 id 非法")
    return flows_dir() / f"{safe}.json"


def index_path() -> Path:
    return flows_dir() / "index.json"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _write_atomic(path: Path, payload: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def new_id() -> str:
    return f"flow-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6]}"


def new_point_id() -> str:
    return f"pt-{uuid.uuid4().hex[:10]}"


def normalize_city(city: dict | None) -> dict:
    city = dict(city or {})
    return {
        "name": str(city.get("name") or "").strip(),
        "province": str(city.get("province") or "").strip(),
        "adcode": str(city.get("adcode") or "").strip(),
        "lng": _as_float(city.get("lng")),
        "lat": _as_float(city.get("lat")),
    }


def _as_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_point(point: dict) -> dict:
    point = dict(point or {})
    result = {
        "id": str(point.get("id") or new_point_id()),
        "poi_id": str(point.get("poi_id") or ""),
        "name": str(point.get("name") or "").strip() or "未命名点位",
        "lng": _as_float(point.get("lng")),
        "lat": _as_float(point.get("lat")),
        "address": str(point.get("address") or ""),
        "open_time": str(point.get("open_time") or ""),
        "dwell_minutes": int(point.get("dwell_minutes") or DEFAULT_DWELL),
        "fixed_time": point.get("fixed_time") or None,
        "locked": bool(point.get("locked")),
    }
    if result["lng"] is None or result["lat"] is None:
        raise ValueError(f"点位缺少坐标：{result['name']}")
    return result


def empty_flow(city: dict | None = None, name: str | None = None) -> dict:
    info = normalize_city(city)
    start = None
    if info["lng"] is not None and info["lat"] is not None:
        start = {"name": "出发点", "lng": info["lng"], "lat": info["lat"], "time": DEFAULT_DAY_START}
    return {
        "id": new_id(),
        "name": name or (f"{info['name']}游玩流程" if info["name"] else "未命名流程"),
        "city": info,
        "transport": DEFAULT_TRANSPORT,
        "objective": DEFAULT_OBJECTIVE,
        "day_start": DEFAULT_DAY_START,
        "day_end": DEFAULT_DAY_END,
        "start": start,
        "points": [],
        "plan": None,
        "created_at": _now(),
        "updated_at": _now(),
    }


def normalize_flow(flow: dict) -> dict:
    flow = dict(flow or {})
    flow["id"] = str(flow.get("id") or new_id())
    flow.setdefault("name", "未命名流程")
    flow["city"] = normalize_city(flow.get("city"))
    flow["transport"] = flow.get("transport") or flow.get("mode") or DEFAULT_TRANSPORT
    flow["objective"] = (flow.get("objective") or DEFAULT_OBJECTIVE).lower()
    flow["day_start"] = flow.get("day_start") or DEFAULT_DAY_START
    flow["day_end"] = flow.get("day_end") or DEFAULT_DAY_END
    points = [normalize_point(point) for point in flow.get("points") or flow.get("stops") or []]
    # 点数不变时保留原顺序（优化结果已经写回 points），仅在越界时裁剪
    flow["points"] = points
    if not flow.get("start"):
        anchor = points[0] if points else flow["city"]
        if anchor.get("lng") is not None and anchor.get("lat") is not None:
            flow["start"] = {
                "name": "出发点",
                "lng": anchor["lng"],
                "lat": anchor["lat"],
                "time": flow["day_start"],
            }
    return flow


def flow_to_day(flow: dict) -> dict:
    """转换成单日优化器可用的 day 结构。"""
    flow = normalize_flow(flow)
    return {
        "index": 1,
        "city": flow["city"],
        "mode": flow["transport"],
        "objective": flow["objective"],
        "day_start": flow["day_start"],
        "day_end": flow["day_end"],
        "start": flow.get("start"),
        "end": flow.get("end"),
        "stops": [dict(point) for point in flow["points"]],
        "plan": flow.get("plan"),
    }


def apply_plan(flow: dict, plan: dict) -> dict:
    """把优化结果的顺序写回点位列表（用户随后拖拽即基于该顺序）。"""
    order = [item for item in (plan or {}).get("order") or []]
    points = list(flow.get("points") or [])
    if not order or len(order) < 2:
        return flow
    positions = {point["id"]: index for index, point in enumerate(points)}
    sequence = [positions[item] for item in order if item in positions]
    sequence += [index for index in range(len(points)) if index not in sequence]
    flow["points"] = [points[index] for index in sequence]
    flow["plan"] = plan
    return flow


def create_flow(city: dict | None = None, name: str | None = None) -> dict:
    return save_flow(empty_flow(city, name))


def load_flow(flow_id: str) -> dict:
    path = flow_path(flow_id)
    if not path.exists():
        raise FlowNotFound(f"流程不存在：{flow_id}")
    try:
        return normalize_flow(json.loads(path.read_text(encoding="utf-8")))
    except json.JSONDecodeError as error:
        raise FlowNotFound(f"流程文件损坏：{flow_id}（{error}）") from error


def save_flow(flow: dict) -> dict:
    payload = normalize_flow(flow)
    payload["updated_at"] = _now()
    payload.setdefault("created_at", payload["updated_at"])
    _write_atomic(flow_path(payload["id"]), payload)
    _refresh_index()
    return payload


def delete_flow(flow_id: str) -> None:
    path = flow_path(flow_id)
    if path.exists():
        path.unlink()
    _refresh_index()


def duplicate_flow(flow_id: str, name: str | None = None) -> dict:
    flow = load_flow(flow_id)
    flow["id"] = new_id()
    flow["name"] = name or f"{flow['name']}（副本）"
    flow["plan"] = None
    return save_flow(flow)


def summarize(flow: dict) -> dict:
    plan = flow.get("plan") or {}
    return {
        "id": flow.get("id"),
        "name": flow.get("name"),
        "city": flow.get("city", {}).get("name") or "",
        "adcode": flow.get("city", {}).get("adcode") or "",
        "transport": flow.get("transport"),
        "points": len(flow.get("points") or []),
        "total_minutes": plan.get("total_minutes"),
        "distance_km": round(sum(float(leg.get("distance_km") or 0) for leg in plan.get("legs") or []), 2),
        "end_time": plan.get("end_time"),
        "updated_at": flow.get("updated_at"),
    }


def list_flows(city_name: str | None = None) -> list[dict]:
    items: list[dict] = []
    for path in sorted(flows_dir().glob("flow-*.json")):
        try:
            flow = normalize_flow(json.loads(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, ValueError):
            continue
        if city_name:
            wanted = str(city_name).replace("市", "")
            if str(flow.get("city", {}).get("name", "")).replace("市", "") != wanted:
                continue
        items.append(summarize(flow))
    items.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return items


def _refresh_index() -> dict:
    payload = {"updated_at": _now(), "flows": list_flows()}
    _write_atomic(index_path(), payload)
    return payload


def import_flow(payload: dict) -> dict:
    flow = dict(payload)
    flow["id"] = new_id()
    flow["name"] = (flow.get("name") or "导入的流程") + "（导入）"
    return save_flow(flow)
