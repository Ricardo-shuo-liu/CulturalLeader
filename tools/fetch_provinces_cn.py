"""生成省级数据 frontend/js/data/provinces-cn.js：名称 / 中心 / 包围盒 / 简化轮廓。

数据源（无需 Key）：
  https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json
用途：
  1) 沙盘上绘制省界并支持"飞到指定省份"
  2) 省份点击命中与省级信息卡
"""

from __future__ import annotations

import json
import math
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "frontend" / "js" / "data" / "provinces-cn.js"
SOURCE = "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json"
TOLERANCE = 0.35  # 轮廓抽稀（度），省界只需要可辨认


def download(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "CulturalLeader/0.1"})
    with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def perpendicular_distance(point, start, end) -> float:
    (x, y), (x1, y1), (x2, y2) = point, start, end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify(points: list[list[float]], tolerance: float) -> list[list[float]]:
    if len(points) < 3:
        return points
    start, end = points[0], points[-1]
    index, distance = 0, 0.0
    for i in range(1, len(points) - 1):
        current = perpendicular_distance(points[i], start, end)
        if current > distance:
            index, distance = i, current
    if distance > tolerance:
        left = simplify(points[: index + 1], tolerance)
        right = simplify(points[index:], tolerance)
        return left[:-1] + right
    return [start, end]


def rings_of(geometry: dict) -> list[list[list[float]]]:
    coordinates = geometry.get("coordinates") or []
    kind = geometry.get("type")
    if not coordinates:
        return []
    polygons = coordinates if kind == "MultiPolygon" else [coordinates]
    rings: list[list[list[float]]] = []
    for polygon in polygons:
        for ring in polygon:
            if ring and isinstance(ring[0], (list, tuple)) and len(ring) >= 3:
                rings.append([[float(point[0]), float(point[1])] for point in ring])
    return rings


def main() -> None:
    payload = download(SOURCE)
    provinces = []
    for feature in payload.get("features", []):
        props = feature["properties"]
        name = props.get("name") or ""
        adcode = str(props.get("adcode") or "")
        center = props.get("center") or props.get("centroid")
        if not name or not adcode or not center:
            continue
        rings = rings_of(feature.get("geometry") or {})
        if not rings:
            continue
        # 取面积最大的环作为主轮廓
        main_ring = max(rings, key=len)
        simplified = simplify(main_ring, TOLERANCE)
        lngs = [point[0] for point in main_ring]
        lats = [point[1] for point in main_ring]
        provinces.append(
            {
                "adcode": adcode,
                "name": name,
                "lng": float(center[0]),
                "lat": float(center[1]),
                "bbox": [round(min(lngs), 4), round(min(lats), 4), round(max(lngs), 4), round(max(lats), 4)],
                "ring": [[round(lng, 3), round(lat, 3)] for lng, lat in simplified],
            }
        )
    provinces.sort(key=lambda item: item["adcode"])

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(provinces, ensure_ascii=False, separators=(",", ":"))
    TARGET.write_text(
        "// 由 tools/fetch_provinces_cn.py 生成：省级名称/中心/包围盒/简化轮廓（DataV 公开数据）。\n"
        f"export const PROVINCES_CN = {body};\n",
        encoding="utf-8",
    )
    points = sum(len(item["ring"]) for item in provinces)
    print(f"[provinces] {len(provinces)} 个省级单位，轮廓点 {points} -> {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
