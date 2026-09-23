"""路线求解：调用本地 LKH-3.0.14 求最优巡回，失败时退回内置 2-opt。"""

from __future__ import annotations

import math
import subprocess
import tempfile
import time
from pathlib import Path

from ..config import PROJECT_ROOT

LKH_BIN = PROJECT_ROOT / "LKH-3.0.14" / "LKH"
LKH_TIMEOUT_SECONDS = 60


def haversine_km(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    radius = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def to_tsplib_geo(value: float) -> float:
    """十进制度 → TSPLIB GEO 的 DDD.MMmmm 记法（小数部分是分）。"""
    sign = -1 if value < 0 else 1
    absolute = abs(value)
    degrees = int(absolute)
    minutes = (absolute - degrees) * 60 / 100
    return sign * (degrees + minutes)


def build_instance(cities) -> str:
    lines = [
        "NAME: culturalleader-route",
        "TYPE: TSP",
        f"DIMENSION: {len(cities)}",
        "EDGE_WEIGHT_TYPE: GEO",
        "NODE_COORD_SECTION",
    ]
    for index, city in enumerate(cities, start=1):
        # TSPLIB GEO：第一列是纬度，第二列是经度
        lines.append(f"{index} {to_tsplib_geo(city.lat):.6f} {to_tsplib_geo(city.lng):.6f}")
    lines.append("EOF")
    return "\n".join(lines) + "\n"


def parse_tour(path: Path, dimension: int) -> list[int] | None:
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8", errors="ignore")
    if "TOUR_SECTION" not in text:
        return None
    body = text.split("TOUR_SECTION", 1)[1]
    order: list[int] = []
    for line in body.splitlines():
        token = line.strip()
        if not token or token in {"EOF"}:
            continue
        try:
            value = int(token)
        except ValueError:
            continue
        if value == -1:
            break
        if 1 <= value <= dimension:
            order.append(value - 1)
    if len(order) != dimension:
        return None
    return order


def tour_length(cities, order: list[int]) -> float:
    total = 0.0
    for i, index in enumerate(order):
        a = cities[index]
        b = cities[order[(i + 1) % len(order)]]
        total += haversine_km(a.lng, a.lat, b.lng, b.lat)
    return total


def parse_lkh_cost(output: str) -> float | None:
    for line in output.splitlines():
        if line.strip().startswith("Cost.min"):
            digits = "".join(ch for ch in line.split("=")[1] if ch.isdigit())
            if digits:
                return float(digits)
    return None


def solve_with_lkh(cities) -> tuple[list[int], float, float | None] | None:
    """返回 (顺序, 里程)；LKH 不可用时返回 None。"""

    if not LKH_BIN.exists():
        return None

    with tempfile.TemporaryDirectory(prefix="lkh_route_") as workdir:
        work = Path(workdir)
        problem = work / "route.tsp"
        tour = work / "route.tour"
        params = work / "route.par"
        problem.write_text(build_instance(cities), encoding="utf-8")
        params.write_text(
            "\n".join(
                [
                    "PROBLEM_FILE = route.tsp",
                    "TOUR_FILE = route.tour",
                    "RUNS = 10",
                    "SEED = 1",
                    "TRACE_LEVEL = 1",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        try:
            completed = subprocess.run(  # noqa: S603
                [str(LKH_BIN), "route.par"],
                cwd=work,
                check=True,
                timeout=LKH_TIMEOUT_SECONDS,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
        except (subprocess.SubprocessError, OSError):
            return None

        order = parse_tour(tour, len(cities))
        if order is None:
            return None
        cost = parse_lkh_cost(completed.stdout.decode("utf-8", errors="ignore"))
        return order, tour_length(cities, order), cost


def fallback_solve(cities) -> tuple[list[int], float]:
    """最近邻构造 + 2-opt 改进，保证没有 LKH 时也能给出合理路线。"""

    count = len(cities)
    remaining = set(range(1, count))
    order = [0]
    while remaining:
        last = cities[order[-1]]
        nearest = min(
            remaining,
            key=lambda index: haversine_km(last.lng, last.lat, cities[index].lng, cities[index].lat),
        )
        order.append(nearest)
        remaining.discard(nearest)

    best = tour_length(cities, order)
    improved = True
    while improved:
        improved = False
        for i in range(1, count - 1):
            for j in range(i + 1, count):
                if i == 1 and j == count - 1:
                    continue
                candidate = order[:i] + order[i : j + 1][::-1] + order[j + 1 :]
                value = tour_length(cities, candidate)
                if value < best - 1e-9:
                    order, best = candidate, value
                    improved = True
    return order, best


def solve_route(cities) -> dict:
    started = time.perf_counter()
    solver = "LKH-3.0.14"
    lkh_cost = None
    result = solve_with_lkh(cities)
    if result is None:
        solver = "内置 2-opt"
        order, distance = fallback_solve(cities)
    else:
        order, distance, lkh_cost = result
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    ordered_cities = [cities[index] for index in order]
    legs = []
    for i, city in enumerate(ordered_cities):
        nxt = ordered_cities[(i + 1) % len(ordered_cities)]
        legs.append(
            {
                "from": city.slug,
                "to": nxt.slug,
                "km": round(haversine_km(city.lng, city.lat, nxt.lng, nxt.lat), 1),
            }
        )

    return {
        "order": [city.slug for city in ordered_cities],
        "names": [city.name for city in ordered_cities],
        "distance_km": round(distance, 1),
        "solver": solver,
        "lkh_cost_km": lkh_cost,
        "elapsed_ms": elapsed_ms,
        "closed": True,
        "legs": legs,
        "cities": [
            {"slug": city.slug, "name": city.name, "lng": city.lng, "lat": city.lat}
            for city in ordered_cities
        ],
    }
