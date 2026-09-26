"""整体攻略：把多座城市的游玩流程串成逐日攻略，并汇总里程与时长。

城际段优先用腾讯位置服务算真实驾车时长，配额不足/无 Key 时自动降级为直线估算并标注。
"""

from __future__ import annotations

from . import flow_store, guide_store
from .tencent_map import MapError, TencentMapClient, estimate_leg


def _flow_totals(flow: dict) -> dict:
    plan = flow.get("plan") or {}
    legs = plan.get("legs") or []
    distance = sum(float(leg.get("distance_km") or 0) for leg in legs)
    minutes = float(plan.get("total_minutes") or sum(float(leg.get("minutes") or 0) for leg in legs) or 0)
    return {"distance_km": round(distance, 2), "minutes": round(minutes, 1), "estimated": bool(plan.get("estimated"))}


def _city_point(flow: dict) -> dict | None:
    city = flow.get("city") or {}
    if city.get("lng") is None or city.get("lat") is None:
        return None
    return {"name": city.get("name") or "城市", "lng": float(city["lng"]), "lat": float(city["lat"])}


def intercity_leg(previous: dict | None, current: dict, client: TencentMapClient | None = None) -> dict | None:
    if not previous:
        return None
    try:
        active = client or TencentMapClient()
        leg = active.route("driving", previous, current)
        return {
            "from": previous.get("name"),
            "to": current.get("name"),
            "mode": "driving",
            "minutes": round(float(leg.get("minutes") or 0), 1),
            "distance_km": round(float(leg.get("distance_km") or 0), 2),
            "estimated": bool(leg.get("estimated")),
        }
    except (MapError, ValueError, TypeError):
        pass
    fallback = estimate_leg("taxi", previous, current)
    return {
        "from": previous.get("name"),
        "to": current.get("name"),
        "mode": "driving",
        "minutes": round(float(fallback.get("minutes") or 0), 1),
        "distance_km": round(float(fallback.get("distance_km") or 0), 2),
        "estimated": True,
    }


def build_guide(name: str, items: list[dict], *, client: TencentMapClient | None = None) -> dict:
    """按传入顺序生成攻略：每个流程占一天，天号从 1 递增（也可显式指定 day）。"""
    built: list[dict] = []
    previous_city: dict | None = None
    distance_total = 0.0
    minutes_total = 0.0

    for index, item in enumerate(items):
        flow_id = item.get("flowId") or item.get("flow_id")
        try:
            flow = flow_store.load_flow(str(flow_id))
        except (flow_store.FlowNotFound, ValueError) as error:
            raise ValueError(f"第 {index + 1} 条引用的流程不可用：{error}") from error
        day = item.get("day") or (index + 1)
        totals = _flow_totals(flow)
        city = _city_point(flow)
        leg = intercity_leg(previous_city, city, client) if city else None
        if leg:
            distance_total += leg["distance_km"]
            minutes_total += leg["minutes"]
        distance_total += totals["distance_km"]
        minutes_total += totals["minutes"]
        if city:
            previous_city = city
        built.append({"day": int(day), "flowId": flow["id"], "notes": str(item.get("notes") or ""), "leg": leg})

    guide = guide_store.empty_guide(name)
    guide["items"] = built
    guide["totals"] = {"distance_km": round(distance_total, 2), "minutes": round(minutes_total, 1)}
    return guide


def recompute(guide: dict, *, client: TencentMapClient | None = None) -> dict:
    """按现有 items 重新计算城际段与总计（调整顺序/替换流程后调用）。"""
    rebuilt = build_guide(guide.get("name") or "未命名攻略", guide.get("items") or [], client=client)
    merged = dict(guide)
    merged["items"] = rebuilt["items"]
    merged["totals"] = rebuilt["totals"]
    return merged
