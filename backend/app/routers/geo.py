"""全国城市清单（供沙盘市级标注使用）。"""

from __future__ import annotations

import json
import re
from functools import lru_cache

import urllib.request
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException

from ..config import DATA_DIR, FRONTEND_DIR

router = APIRouter(prefix="/api/geo", tags=["geo"])

CITY_FILE = FRONTEND_DIR / "js" / "data" / "cities-cn.js"


@lru_cache(maxsize=1)
def _load_cities() -> list[dict]:
    if not CITY_FILE.exists():
        return []
    text = CITY_FILE.read_text(encoding="utf-8")
    match = re.search(r"export const CITIES_CN\s*=\s*(\[.*\]);", text, re.S)
    if not match:
        return []
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=500, detail=f"城市数据解析失败：{error}") from error


@router.get("/cities")
def list_cities() -> dict:
    cities = _load_cities()
    return {"count": len(cities), "cities": cities}


PROVINCE_FILE = FRONTEND_DIR / "js" / "data" / "provinces-cn.js"
BOUNDARY_CACHE = DATA_DIR / "geo"
DATAV = "https://geo.datav.aliyun.com/areas_v3/bound"


@lru_cache(maxsize=1)
def _load_provinces() -> list[dict]:
    if not PROVINCE_FILE.exists():
        return []
    text = PROVINCE_FILE.read_text(encoding="utf-8")
    match = re.search(r"export const PROVINCES_CN\s*=\s*(\[.*\]);", text, re.S)
    if not match:
        return []
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return []


@router.get("/provinces")
def list_provinces() -> dict:
    provinces = _load_provinces()
    return {"count": len(provinces), "provinces": provinces}


@router.get("/city-boundary")
def city_boundary(adcode: str) -> dict:
    """城市行政边界（离线矢量底图用）：首次从 DataV 取回并缓存到 data/geo/。"""
    code = "".join(ch for ch in adcode if ch.isdigit())
    if len(code) < 6:
        raise HTTPException(status_code=400, detail="adcode 需要 6 位数字")
    BOUNDARY_CACHE.mkdir(parents=True, exist_ok=True)
    cache_file = BOUNDARY_CACHE / f"{code}.json"
    if cache_file.exists():
        try:
            return json.loads(cache_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            cache_file.unlink(missing_ok=True)

    payload = None
    for suffix in ("_full", ""):
        url = f"{DATAV}/{code}{suffix}.json"
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "CulturalLeader/0.1"})
            with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310
                payload = json.loads(response.read().decode("utf-8"))
            break
        except Exception:  # noqa: BLE001
            continue
    if payload is None:
        raise HTTPException(status_code=502, detail="边界数据获取失败（离线时只影响矢量底图）")

    rings: list[list[list[float]]] = []
    for feature in payload.get("features", []):
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        kind = geometry.get("type")
        if not coordinates:
            continue
        polygons = coordinates if kind == "MultiPolygon" else [coordinates]
        for polygon in polygons:
            for ring in polygon:
                if ring and isinstance(ring[0], (list, tuple)):
                    rings.append([[round(float(p[0]), 4), round(float(p[1]), 4)] for p in ring])
    result = {"adcode": code, "name": (payload.get("features") or [{}])[0].get("properties", {}).get("name", ""), "rings": rings}
    cache_file.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result


STATIC_CACHE = DATA_DIR / "geo" / "staticmap"


@router.get("/static-map")
def static_map(center: str, zoom: int = 12, width: int = 900, height: int = 600, maptype: str = "roadmap"):
    """腾讯静态图（WebServiceAPI 的 staticmap）代理：返回 PNG 底图，浏览器直接叠路线。"""
    from fastapi.responses import Response

    from ..config import get_settings

    settings = get_settings()
    if not settings.tencent_map_key:
        raise HTTPException(status_code=409, detail={"code": "MAP_KEY_MISSING", "message": "未配置 TENCENT_MAP_KEY"})
    # 腾讯静态图要求 center=纬度,经度（与其它接口的 lng,lat 相反）
    parts = str(center).split(",")
    lat, lng = (parts[0].strip(), parts[1].strip()) if len(parts) == 2 else ("0", "0")
    w = max(200, min(int(width), 1024))
    h = max(150, min(int(height), 1024))
    z = max(3, min(int(zoom), 18))
    key = f"{lat},{lng}_{z}_{w}x{h}_{maptype}"
    STATIC_CACHE.mkdir(parents=True, exist_ok=True)
    cached = STATIC_CACHE / f"{abs(hash(key))}.png"
    if cached.exists():
        return Response(content=cached.read_bytes(), media_type="image/png")

    params = {
        "center": f"{lat},{lng}",
        "zoom": z,
        "size": f"{w}*{h}",
        "maptype": maptype,
        "key": settings.tencent_map_key,
    }
    from ..services.tencent_map import TencentMapClient

    client = TencentMapClient(settings)
    signature = client._signature("ws/staticmap/v2/", params)
    if signature:
        params["sig"] = signature
    url = f"https://apis.map.qq.com/ws/staticmap/v2/?{urlencode(params)}"
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "CulturalLeader/0.1"})
        with urllib.request.urlopen(request, timeout=15) as response:  # noqa: S310
            data = response.read()
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"静态图获取失败：{error}") from error
    if not data.startswith(b"\x89PNG"):
        raise HTTPException(status_code=502, detail=f"静态图返回异常：{data[:80]!r}")
    cached.write_bytes(data)
    return Response(content=data, media_type="image/png")
