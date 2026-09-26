"""腾讯位置服务（WebService API）封装：缓存 / 限流 / 每日配额 / 降级估算。

接口约定（已核对官方文档）：
  - 路径规划 result.routes[].distance 单位米、duration 单位分钟
  - POI 搜索 data[].location 为 {lat, lng}
  - 错误用 status 字段表达（0 为成功），如 311 key 格式错误、120 当日配额用尽
  - 若 Key 开启了签名校验，需要带 sig = MD5(path?query+SK)
"""

from __future__ import annotations

import hashlib
import json
import math
import threading
import time
from datetime import date, datetime
from typing import Any
from urllib.parse import urlencode

import httpx

from ..config import get_settings
from ..db import SessionLocal
from ..models import MapCache, MapQuota

BASE_URL = "https://apis.map.qq.com"

TTL = {
    "ws/district/v1/list": 30 * 86400,
    "ws/place/v1/search": 7 * 86400,
    "ws/place/v1/detail": 7 * 86400,
    "ws/geocoder/v1": 30 * 86400,
    "ws/direction/v1/walking": 3 * 86400,
    "ws/direction/v1/driving": 3 * 86400,
    "ws/direction/v1/transit": 3 * 86400,
    "ws/direction/v1/bicycling": 3 * 86400,
}
DEFAULT_TTL = 86400

# 估算参数（无 Key / 超配额 / 接口异常时使用）
MODE_SPEED_KMH = {"walking": 4.5, "taxi": 28.0, "transit": 22.0}
MODE_DETOUR = {"walking": 1.25, "taxi": 1.30, "transit": 1.35}

# 腾讯错误码 → 可执行提示
STATUS_HINTS = {
    110: "来源未被授权：若报「此次请求无来源信息」，说明该 Key 用的是『域名(Referer)授权』——"
         "两种解法：① 把 Key 的授权方式改成 IP 白名单并加入服务器出口 IP；"
         "② 在 .env 填 TENCENT_MAP_REFERER=https://你白名单里的域名（我们会在请求里带上 Referer）",
    111: "签名验证失败：Key 开启了签名校验，请在 .env 填 TENCENT_MAP_SK",
    112: "IP 未被授权：把服务器公网 IP 加入 Key 的授权列表",
    113: "Referer 未被授权：检查 Key 的域名白名单设置",
    120: "当日调用量已达到上限：等待次日恢复，或申请提升配额",
    121: "配额已用完：检查控制台的配额包",
    300: "缺少必需参数：检查请求（一般是调用方问题）",
    311: "Key 格式错误：确认复制完整（腾讯 WebService Key 通常为 32 位字符）",
    347: "无权限使用该接口：在控制台给该 Key 勾选此服务",
}


class MapError(RuntimeError):
    """地图服务相关异常基类。"""


class MapKeyMissing(MapError):
    pass


class MapQuotaExceeded(MapError):
    pass


class MapUpstreamError(MapError):
    pass


def haversine_km(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    radius = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def estimate_leg(mode: str, a: dict, b: dict) -> dict:
    """直线距离 × 道路系数的粗略估算，明确标注 estimated。"""
    mode = mode if mode in MODE_SPEED_KMH else "taxi"
    straight = haversine_km(a["lng"], a["lat"], b["lng"], b["lat"])
    distance = straight * MODE_DETOUR[mode]
    minutes = max(1.0, distance / MODE_SPEED_KMH[mode] * 60)
    if mode == "transit":
        minutes += 8
    return {"distance_km": round(distance, 2), "minutes": round(minutes, 1), "estimated": True, "mode": mode}


class TencentMapClient:
    """带缓存、限流与配额的同步客户端（FastAPI 同步路由内使用）。"""

    _lock = threading.Lock()
    _last_call = 0.0

    def __init__(self, settings=None) -> None:
        self.settings = settings or get_settings()

    # ── 基础设施 ──────────────────────────────────────────────
    def _signature(self, path: str, params: dict[str, Any]) -> str | None:
        sk = (self.settings.tencent_map_sk or "").strip()
        if not sk:
            return None
        query = urlencode(sorted((key, value) for key, value in params.items() if key != "sig"))
        raw = f"{path}?{query}{sk}"
        return hashlib.md5(raw.encode("utf-8")).hexdigest()

    def _fingerprint(self, path: str, params: dict[str, Any]) -> str:
        filtered = {k: v for k, v in sorted(params.items()) if k != "key"}
        raw = f"{path}|{json.dumps(filtered, ensure_ascii=False, sort_keys=True)}"
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()

    def _cache_get(self, key: str, path: str) -> dict | None:
        ttl = TTL.get(path, DEFAULT_TTL)
        with SessionLocal() as db:
            row = db.get(MapCache, key)
            if row is None:
                return None
            age = datetime.now() - (row.created_at or datetime.now())
            if age.total_seconds() > ttl:
                db.delete(row)
                db.commit()
                return None
            try:
                return json.loads(row.payload)
            except json.JSONDecodeError:
                return None

    def _cache_put(self, key: str, path: str, payload: dict) -> None:
        with SessionLocal() as db:
            row = db.get(MapCache, key)
            if row is None:
                row = MapCache(key=key, path=path)
                db.add(row)
            row.path = path
            row.payload = json.dumps(payload, ensure_ascii=False)
            row.created_at = datetime.now()
            db.commit()

    def _quota(self, bump: bool = False) -> int:
        day = date.today().isoformat()
        with SessionLocal() as db:
            row = db.get(MapQuota, day)
            if row is None:
                row = MapQuota(day=day, count=0)
                db.add(row)
                db.commit()
            if bump:
                row.count += 1
                db.commit()
            return row.count

    def _throttle(self) -> None:
        qps = max(0.5, float(self.settings.map_qps or 3))
        interval = 1.0 / qps
        with TencentMapClient._lock:
            now = time.monotonic()
            wait = TencentMapClient._last_call + interval - now
            if wait > 0:
                time.sleep(wait)
            TencentMapClient._last_call = time.monotonic()

    def request(self, path: str, params: dict[str, Any], *, use_cache: bool = True) -> dict:
        key = (self.settings.tencent_map_key or "").strip()
        if not key:
            raise MapKeyMissing("未配置 TENCENT_MAP_KEY")

        fingerprint = self._fingerprint(path, params)
        if use_cache:
            cached = self._cache_get(fingerprint, path)
            if cached is not None:
                return cached

        if self._quota() >= int(self.settings.map_daily_limit or 5000):
            raise MapQuotaExceeded("已达到配置的每日调用上限")

        query = {**params, "key": key}
        signature = self._signature(path, query)
        if signature:
            query["sig"] = signature

        self._throttle()
        headers = {"User-Agent": "CulturalLeader/0.1"}
        referer = (self.settings.tencent_map_referer or "").strip()
        if referer:
            headers["Referer"] = referer if referer.endswith("/") else f"{referer}/"
            headers["Origin"] = referer.rstrip("/")
        try:
            response = httpx.get(f"{BASE_URL}/{path}", params=query, timeout=12, headers=headers)
            response.raise_for_status()
            payload = response.json()
        except Exception as error:  # noqa: BLE001
            raise MapUpstreamError(f"腾讯地图请求失败：{error}") from error

        self._quota(bump=True)
        status = int(payload.get("status") or 0)
        if status != 0:
            hint = STATUS_HINTS.get(status, payload.get("message") or "未知错误")
            message = f"{payload.get('message') or '请求失败'}（status={status}）→ {hint}"
            if status in (120, 121):
                raise MapQuotaExceeded(message)
            if status in (110, 111, 112, 113, 311, 347):
                raise MapKeyMissing(message)
            raise MapUpstreamError(message)

        if use_cache:
            self._cache_put(fingerprint, path, payload)
        return payload

    # ── 业务封装 ──────────────────────────────────────────────
    @staticmethod
    def _poi(item: dict) -> dict:
        location = item.get("location") or {}
        ad_info = item.get("ad_info") or {}
        return {
            "poi_id": item.get("id") or "",
            "name": item.get("title") or "",
            "type": item.get("category") or "",
            "address": item.get("address") or "",
            "lng": location.get("lng"),
            "lat": location.get("lat"),
            "city": ad_info.get("city") or "",
            "adcode": str(ad_info.get("adcode") or ""),
            "tel": item.get("tel") or "",
            "rating": item.get("rating") or None,
            "cost": None,
            "open_time": item.get("opening_hours") or "",
            "distance_m": item.get("_distance") or None,
            "estimated": False,
        }

    def poi_search(self, keyword: str, city: str = "", page: int = 1, offset: int = 20) -> list[dict]:
        boundary = f"region({city or '全国'},0)"
        payload = self.request(
            "ws/place/v1/search",
            {"keyword": keyword, "boundary": boundary, "page_size": max(1, min(offset, 20)), "page_index": page},
        )
        return [self._poi(item) for item in payload.get("data", [])]

    def poi_around(self, lng: float, lat: float, *, keyword: str = "", radius: int = 2000, offset: int = 20) -> list[dict]:
        payload = self.request(
            "ws/place/v1/search",
            {
                "keyword": keyword or "美食",
                "boundary": f"nearby({lat},{lng},{radius})",
                "page_size": max(1, min(offset, 20)),
                "page_index": 1,
                "orderby": "_distance",
            },
        )
        items = []
        for item in payload.get("data", []):
            poi = self._poi(item)
            location = (item.get("location") or {})
            if poi["lat"] is not None and poi["lng"] is not None:
                poi["_distance_km"] = None
                poi["distance_m"] = item.get("_distance")
            items.append(poi)
        return items

    def poi_detail(self, poi_id: str) -> dict | None:
        payload = self.request("ws/place/v1/detail", {"id": poi_id})
        data = payload.get("data")
        if isinstance(data, dict):
            return self._poi(data)
        if isinstance(data, list) and data:
            return self._poi(data[0])
        return None

    def district_list(self) -> dict:
        return self.request("ws/district/v1/list", {})

    def reverse_geocode(self, lng: float, lat: float) -> dict:
        """逆地理编码：用户在地图上随手点一个位置时，尽量给它一个可读的名字。"""
        payload = self.request(
            "ws/geocoder/v1",
            {
                "location": f"{lat},{lng}",
                "get_poi": 1,
                # 注意：腾讯的 poi_options 用分号分隔（用逗号会报 status=348 参数错误）
                "poi_options": "radius=200;page_size=3",
            },
        )
        result = payload.get("result") or {}
        component = result.get("address_component") or {}
        ad_info = result.get("ad_info") or {}
        formatted = (result.get("formatted_addresses") or {}).get("recommend") or ""
        pois = result.get("pois") or []
        nearest = pois[0] if pois else {}
        name = nearest.get("title") or formatted or result.get("address") or ""
        return {
            "name": str(name).strip(),
            "address": formatted or result.get("address") or "",
            "city": component.get("city") or "",
            "district": component.get("district") or "",
            "adcode": str(ad_info.get("adcode") or ""),
            "lng": lng,
            "lat": lat,
            "poi_id": nearest.get("id") or "",
            "estimated": False,
        }

    def route(self, mode: str, origin: dict, destination: dict, *, city: str = "", cityd: str = "") -> dict:
        """单段路径：walking / taxi(driving) / transit；腾讯 duration 单位为分钟。"""
        if mode not in {"walking", "taxi", "transit"}:
            mode = "taxi"
        endpoint = {"walking": "ws/direction/v1/walking", "taxi": "ws/direction/v1/driving", "transit": "ws/direction/v1/transit"}[mode]
        params = {
            "from": f"{origin['lat']},{origin['lng']}",
            "to": f"{destination['lat']},{destination['lng']}",
        }
        if mode == "transit":
            params["policy"] = "LEAST_TIME"
        payload = self.request(endpoint, params)
        routes = (payload.get("result") or {}).get("routes") or []
        if not routes:
            return estimate_leg(mode, origin, destination)
        first = routes[0]
        return {
            "distance_km": round(float(first.get("distance") or 0) / 1000, 2),
            "minutes": round(float(first.get("duration") or 0), 1),
            "estimated": False,
            "mode": mode,
        }

    def route_or_estimate(self, mode: str, origin: dict, destination: dict, *, city: str = "", cityd: str = "") -> dict:
        if not self.settings.map_ready:
            if not self.settings.allow_estimate:
                raise MapKeyMissing("未配置腾讯地图 Key 且不允许估算")
            return estimate_leg(mode, origin, destination)
        try:
            return self.route(mode, origin, destination, city=city, cityd=cityd)
        except MapError:
            if not self.settings.allow_estimate:
                raise
            return estimate_leg(mode, origin, destination)

    def distance_matrix(self, mode: str, points: list[dict]) -> list[list[dict]]:
        """N×N 通勤矩阵：逐对调用路径规划（结果进缓存；公交点多时退回估算）。"""
        count = len(points)
        matrix: list[list[dict]] = [[None] * count for _ in range(count)]  # type: ignore[list-item]
        for i in range(count):
            matrix[i][i] = {"distance_km": 0.0, "minutes": 0.0, "estimated": False, "mode": mode}

        use_real = self.settings.map_ready and (mode != "transit" or count <= 6)
        for i in range(count):
            for j in range(count):
                if i == j:
                    continue
                if use_real:
                    matrix[i][j] = self.route_or_estimate(mode, points[i], points[j])
                else:
                    matrix[i][j] = estimate_leg(mode, points[i], points[j])
        return matrix

    def status(self) -> dict:
        used = self._quota()
        with SessionLocal() as db:
            cached = db.query(MapCache).count()
        return {
            "provider": "腾讯位置服务",
            "key_ok": self.settings.map_ready,
            "degraded": not self.settings.map_ready,
            "quota_used_today": used,
            "quota_limit": int(self.settings.map_daily_limit or 5000),
            "cached_entries": cached,
            "allow_estimate": bool(self.settings.allow_estimate),
        }
