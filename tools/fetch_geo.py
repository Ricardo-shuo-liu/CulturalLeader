"""抓取简化中国轮廓，生成前端可直接 import 的矢量数据（运行时不再联网）。"""

from __future__ import annotations

import json
import math
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "frontend" / "js" / "data" / "china-outline.js"

SOURCES = [
    "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json",
    "https://cdn.jsdelivr.net/gh/apache/echarts@4.9.0/map/json/china.json",
]

TOLERANCE = 0.12  # 抽稀阈值，单位：度
MIN_POINTS = 6
MIN_AREA = 0.25  # 度^2，过滤碎岛
MAX_RINGS = 60


def download(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "CulturalLeader/0.1"})
    with urllib.request.urlopen(request, timeout=180) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def ring_area(ring: list[list[float]]) -> float:
    total = 0.0
    for index in range(len(ring) - 1):
        x1, y1 = ring[index]
        x2, y2 = ring[index + 1]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2


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


def collect_rings(payload: dict) -> list[list[list[float]]]:
    """兼容标准 GeoJSON（Polygon / MultiPolygon）。"""

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
                if not ring or not isinstance(ring[0], (list, tuple)):
                    continue
                if len(ring) >= 3:
                    rings.append([[float(point[0]), float(point[1])] for point in ring])
    return rings


def main() -> None:
    payload = None
    for url in SOURCES:
        try:
            print(f"[geo] {url}")
            payload = download(url)
            break
        except Exception as error:  # noqa: BLE001
            print(f"[geo] failed: {error}")
    if payload is None:
        raise SystemExit("无法获取中国轮廓数据")

    rings = collect_rings(payload)
    print(f"[geo] raw rings = {len(rings)}")
    if not rings:
        raise SystemExit("数据源格式不兼容，未解析到任何环")

    kept: list[list[list[float]]] = []
    for ring in rings:
        simplified = simplify(ring, TOLERANCE)
        if len(simplified) < MIN_POINTS or ring_area(simplified) < MIN_AREA:
            continue
        kept.append([[round(x, 4), round(y, 4)] for x, y in simplified])

    kept.sort(key=ring_area, reverse=True)
    kept = kept[:MAX_RINGS]
    total = sum(len(ring) for ring in kept)
    print(f"[geo] kept rings = {len(kept)}, points = {total}")
    if not kept:
        raise SystemExit("抽稀后没有可用轮廓")

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(kept, ensure_ascii=False, separators=(",", ":"))
    TARGET.write_text(
        "// 由 tools/fetch_geo.py 生成：中国省级边界抽稀为整体水墨晕染轮廓。\n"
        "export const CHINA_OUTLINE = " + body + ";\n",
        encoding="utf-8",
    )
    print(f"[geo] -> {TARGET}")


if __name__ == "__main__":
    main()
