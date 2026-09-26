"""单日行程排序：腾讯位置服务通勤矩阵 + LKH-3.0.14 TSPTW（失败时内置插入法+2-opt）。

时间窗来自 POI 营业时间或用户设定的固定时间；停留时长默认 60 分钟。
LKH 实例用对称化矩阵求解（步行/公交时长本身不对称），随后用真实矩阵重算到达时间。
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

from ..config import PROJECT_ROOT
from .tencent_map import MapError, TencentMapClient, estimate_leg
from .trip_store import DEFAULT_DAY_END, DEFAULT_DAY_START, DEFAULT_DWELL

LKH_BIN = PROJECT_ROOT / "LKH-3.0.14" / "LKH"
LKH_TIMEOUT_SECONDS = 30
LKH_MAX_NODES = 40  # 超过则用内置启发式，避免大规模实例拖慢


def parse_hhmm(text: str | None) -> int | None:
    if not text:
        return None
    match = re.search(r"(\d{1,2})\s*[:：]\s*(\d{2})", str(text))
    if not match:
        return None
    hours, minutes = int(match.group(1)), int(match.group(2))
    if not (0 <= hours <= 23 and 0 <= minutes <= 59):
        return None
    return hours * 60 + minutes


def parse_window(text: str | None) -> tuple[int, int] | None:
    """解析 "08:30-18:00" / "08:30~18:00" 形式的营业时间。"""
    if not text:
        return None
    parts = re.split(r"[-~—至]", str(text))
    if len(parts) < 2:
        return None
    start = parse_hhmm(parts[0])
    end = parse_hhmm(parts[1])
    if start is None or end is None:
        return None
    if end <= start:
        end = min(24 * 60, start + 60)
    return start, end


def build_nodes(day: dict) -> list[dict]:
    """[出发点] + 点位 + [结束点]（与出发点相同则省略）。"""
    nodes: list[dict] = []
    start = day.get("start") or {"name": "出发点", "lng": 0.0, "lat": 0.0, "time": day.get("day_start", DEFAULT_DAY_START)}
    nodes.append({"kind": "start", **start})
    for stop in day.get("stops") or []:
        nodes.append({"kind": "stop", **stop})
    end = day.get("end")
    if end and end.get("lng") is not None:
        same = abs(float(end.get("lng", 0)) - float(start.get("lng", 0))) < 1e-6 and abs(
            float(end.get("lat", 0)) - float(start.get("lat", 0))
        ) < 1e-6
        if not same:
            nodes.append({"kind": "end", **end})
    return nodes


def build_windows(nodes: list[dict], day: dict) -> list[tuple[int, int]]:
    """返回秒为单位的时间窗（必须与矩阵/服务时长一致，LKH 会按同一单位比较）。"""
    start_minute = parse_hhmm(day.get("day_start") or DEFAULT_DAY_START) or 9 * 60
    end_minute = parse_hhmm(day.get("day_end") or DEFAULT_DAY_END) or 20 * 60
    windows: list[tuple[int, int]] = []
    for index, node in enumerate(nodes):
        if node["kind"] == "start":
            # 出发点固定为"出发时刻"，但窗口要放开到当天结束：
            # LKH 的 TSPTW 求的是回路，若把 depot 窗口设成单个瞬间，所有回到 depot 的弧都会变成不可行。
            # 实际出发时刻由我们自己的时间轴固定（_arrivals 从 start_seconds 开始推）。
            fixed = parse_hhmm(node.get("time")) or start_minute
            windows.append((fixed * 60, max(fixed, end_minute + 120) * 60))
            continue
        fixed = parse_hhmm(node.get("fixed_time"))
        if fixed is not None:
            windows.append((fixed * 60, fixed * 60))
            continue
        window = parse_window(node.get("open_time"))
        if window:
            earliest = max(window[0], start_minute) * 60
            latest = min(window[1], end_minute + 120) * 60
            windows.append((earliest, max(earliest, latest)))
        else:
            windows.append((start_minute * 60, (end_minute + 120) * 60))
    return windows


def build_service(nodes: list[dict]) -> list[int]:
    service = []
    for node in nodes:
        if node["kind"] == "start":
            service.append(0)
        elif node["kind"] == "end":
            service.append(0)
        else:
            service.append(int(node.get("dwell_minutes") or DEFAULT_DWELL) * 60)
    return service


def build_tsptw(nodes: list[dict], matrix_seconds: list[list[int]], windows, service, *, makespan: bool) -> str:
    count = len(nodes)
    lines = [
        "NAME: tripday",
        "TYPE: TSPTW",
        f"DIMENSION: {count}",
        "EDGE_WEIGHT_TYPE: EXPLICIT",
        "EDGE_WEIGHT_FORMAT: FULL_MATRIX",
        "EDGE_WEIGHT_SECTION",
    ]
    for row in matrix_seconds:
        lines.append(" ".join(str(int(value)) for value in row))
    lines.append("SERVICE_TIME_SECTION")
    for index, value in enumerate(service, start=1):
        lines.append(f"{index} {int(value)}")
    lines.append("TIME_WINDOW_SECTION")
    for index, (earliest, latest) in enumerate(windows, start=1):
        lines.append(f"{index} {int(earliest)} {int(latest)}")
    lines.append("DEPOT_SECTION")
    lines.append("1")
    lines.append("-1")
    lines.append("EOF")
    return "\n".join(lines) + "\n"


def parse_tour(path: Path, dimension: int) -> list[int] | None:
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8", errors="ignore")
    if "TOUR_SECTION" not in text:
        return None
    order: list[int] = []
    for line in text.split("TOUR_SECTION", 1)[1].splitlines():
        token = line.strip()
        if not token or token == "EOF":
            continue
        try:
            value = int(token)
        except ValueError:
            continue
        if value == -1:
            break
        if 1 <= value <= dimension:
            order.append(value - 1)
    return order if len(order) == dimension else None


def solve_with_lkh(nodes: list[dict], matrix_seconds, windows, service, *, makespan: bool) -> list[int] | None:
    if not LKH_BIN.exists() or len(nodes) < 3 or len(nodes) > LKH_MAX_NODES:
        return None
    instance = build_tsptw(nodes, matrix_seconds, windows, service, makespan=makespan)
    with tempfile.TemporaryDirectory(prefix="trip_lkh_") as workdir:
        work = Path(workdir)
        (work / "day.tsp").write_text(instance, encoding="utf-8")
        (work / "day.par").write_text(
            "\n".join(
                [
                    "PROBLEM_FILE = day.tsp",
                    "TOUR_FILE = day.tour",
                    f"MAKESPAN = {'YES' if makespan else 'NO'}",
                    "RUNS = 10",
                    "SEED = 1",
                    "TRACE_LEVEL = 0",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        try:
            subprocess.run(  # noqa: S603
                [str(LKH_BIN), "day.par"],
                cwd=work,
                check=True,
                timeout=LKH_TIMEOUT_SECONDS,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
        except (subprocess.SubprocessError, OSError):
            return None
        return parse_tour(work / "day.tour", len(nodes))


def _arrivals(order: list[int], matrix, windows, service, start_seconds: int) -> tuple[list[dict], int, int]:
    """按真实矩阵重算到达/离开；返回 (时间表, 结束秒, 放宽数量)。"""
    timeline: list[dict] = []
    relaxed = 0
    clock = start_seconds
    for position, node_index in enumerate(order):
        node = matrix["nodes"][node_index]
        if position == 0:
            arrive = clock
            wait = 0
        else:
            previous = order[position - 1]
            travel = matrix["minutes"][previous][node_index]
            arrive = clock + int(round(travel * 60))
            earliest, latest = windows[node_index]
            wait = max(0, earliest - arrive)
            if wait:
                arrive = earliest
            if latest is not None and arrive > latest:
                relaxed += 1
        depart = arrive + service[node_index]
        timeline.append(
            {
                "node": node_index,
                "kind": node["kind"],
                "id": node.get("id") or node.get("name"),
                "name": node.get("name", ""),
                "arrive": arrive,
                "depart": depart,
                "wait_minutes": round(wait / 60, 1),
            }
        )
        clock = depart
    return timeline, clock, relaxed


def fallback_order(nodes: list[dict], matrix, windows, service, start_seconds: int) -> list[int]:
    """插入法 + 2-opt（带时间窗可行性检查）。"""
    remaining = list(range(1, len(nodes)))
    order = [0]
    clock = start_seconds
    while remaining:
        best = None
        for candidate in remaining:
            travel = matrix["minutes"][order[-1]][candidate]
            arrive = clock + int(round(travel * 60))
            earliest, latest = windows[candidate]
            start = max(arrive, earliest)
            if latest is not None and start > latest:
                continue
            score = start + service[candidate]
            if best is None or score < best[0]:
                best = (score, candidate, start)
        if best is None:  # 全部超窗：放宽，取最早可插入者
            candidate = min(
                remaining,
                key=lambda item: clock + int(round(matrix["minutes"][order[-1]][item] * 60)),
            )
            _, best_candidate = None, candidate
            order.append(best_candidate)
            remaining.remove(best_candidate)
            _, clock, _ = _arrivals(order, matrix, windows, service, start_seconds)
            continue
        _, candidate, start = best
        order.append(candidate)
        remaining.remove(candidate)
        _, clock, _ = _arrivals(order, matrix, windows, service, start_seconds)

    # 简单 2-opt：只接受不增加结束时间且仍然可行的交换
    improved = True
    while improved:
        improved = False
        for i in range(1, len(order) - 1):
            for j in range(i + 1, len(order)):
                candidate = order[:i] + order[i : j + 1][::-1] + order[j + 1 :]
                _, end_time, relaxed = _arrivals(candidate, matrix, windows, service, start_seconds)
                _, current_end, current_relaxed = _arrivals(order, matrix, windows, service, start_seconds)
                if relaxed <= current_relaxed and end_time < current_end:
                    order = candidate
                    improved = True
    return order


def _clock(seconds: int) -> str:
    base = datetime(2000, 1, 1) + timedelta(seconds=int(seconds))
    return base.strftime("%H:%M")


def _plan_from_order(nodes, order, matrix_legs, windows, service, start_seconds, *, solver, estimated, objective) -> dict:
    minutes = [[float(leg["minutes"]) for leg in row] for row in matrix_legs]
    matrix = {"nodes": nodes, "minutes": minutes, "legs": matrix_legs}
    timeline, end_seconds, relaxed = _arrivals(order, matrix, windows, service, start_seconds)
    legs = []
    for position in range(1, len(order)):
        previous, current = order[position - 1], order[position]
        leg = matrix_legs[previous][current]
        legs.append(
            {
                "from": nodes[previous].get("id") or nodes[previous].get("name"),
                "to": nodes[current].get("id") or nodes[current].get("name"),
                "mode": leg.get("mode"),
                "minutes": leg.get("minutes"),
                "distance_km": leg.get("distance_km"),
                "estimated": leg.get("estimated", False),
            }
        )
    return {
        "order": [nodes[index].get("id") or nodes[index].get("name") for index in order],
        "timeline": [
            {**item, "arrive_text": _clock(item["arrive"]), "depart_text": _clock(item["depart"])} for item in timeline
        ],
        "legs": legs,
        "solver": solver,
        "objective": objective,
        "start_time": _clock(start_seconds),
        "end_time": _clock(end_seconds),
        "total_minutes": round((end_seconds - start_seconds) / 60, 1),
        "travel_minutes": round(sum(leg["minutes"] or 0 for leg in legs), 1),
        "waiting_minutes": round(sum(item["wait_minutes"] for item in timeline[1:]), 1),
        "relaxed_windows": relaxed,
        "estimated": estimated,
        "computed_at": datetime.now().isoformat(timespec="seconds"),
    }


def optimize_day(day: dict, *, client: TencentMapClient | None = None, keep_locked: bool = True) -> dict:
    """对单日排序并返回 plan；锁定点保持原位置不动。"""
    client = client or TencentMapClient()
    mode = day.get("mode") or "taxi"
    objective = (day.get("objective") or "makespan").lower()
    makespan = objective != "travel"
    stops = list(day.get("stops") or [])

    if not stops:
        return {
            "order": [], "timeline": [], "legs": [], "solver": None, "objective": objective,
            "total_minutes": 0, "travel_minutes": 0, "waiting_minutes": 0,
            "start_time": None, "end_time": None, "relaxed_windows": 0,
            "estimated": False, "message": "当天还没有点位",
        }

    locked_ids = [stop.get("id") for stop in stops if stop.get("locked")] if keep_locked else []
    if locked_ids and len(locked_ids) < len(stops):
        unlocked_day = {**day, "stops": [stop for stop in stops if not stop.get("locked")]}
        sub_plan = optimize_day(unlocked_day, client=client, keep_locked=False)
        unlocked_ids = {stop.get("id") or stop.get("name") for stop in unlocked_day["stops"]}
        # 子计划里含出发点/结束点，这里只取"未锁定的点位"，按原下标插回
        queue = [item for item in sub_plan["order"] if item in unlocked_ids]
        merged: list[str] = []
        for stop in stops:
            if stop.get("locked"):
                merged.append(stop.get("id"))
            else:
                merged.append(queue.pop(0) if queue else None)
        merged = [item for item in merged if item]
        nodes = build_nodes(day)
        windows = build_windows(nodes, day)
        service = build_service(nodes)
        start_minute = parse_hhmm(day.get("day_start") or DEFAULT_DAY_START) or 9 * 60
        start_seconds = (parse_hhmm(nodes[0].get("time")) or start_minute) * 60
        matrix_legs = client.distance_matrix(mode, nodes)
        estimated = any(leg["estimated"] for row in matrix_legs for leg in row)
        mapping = {(node.get("id") or node.get("name")): index for index, node in enumerate(nodes)}
        # 出发点必须是第一个节点（LKH 的 depot），结束点随后，最后补上遗漏节点
        order = [0]
        order += [mapping[item] for item in merged if item in mapping and mapping[item] != 0]
        order += [index for index, node in enumerate(nodes) if node["kind"] == "end" and index not in order]
        order += [index for index in range(len(nodes)) if index not in order]
        return _plan_from_order(
            nodes, order, matrix_legs, windows, service, start_seconds,
            solver=(sub_plan.get("solver") or "") + "（锁定点固定）",
            estimated=estimated,
            objective="makespan" if makespan else "travel",
        )

    nodes = build_nodes(day)
    if nodes[0]["lng"] is None or nodes[0]["lat"] is None:
        nodes[0]["lng"], nodes[0]["lat"] = nodes[1]["lng"], nodes[1]["lat"]
    windows = build_windows(nodes, day)
    service = build_service(nodes)
    start_minute = parse_hhmm(day.get("day_start") or DEFAULT_DAY_START) or 9 * 60
    start_seconds = (parse_hhmm(nodes[0].get("time")) or start_minute) * 60

    matrix_legs = client.distance_matrix(mode, nodes)
    estimated = any(leg["estimated"] for row in matrix_legs for leg in row)
    minutes = [[float(leg["minutes"]) for leg in row] for row in matrix_legs]
    symmetric = [
        [int(round((minutes[i][j] + minutes[j][i]) / 2 * 60)) for j in range(len(nodes))]
        for i in range(len(nodes))
    ]
    # 开放路径技巧：LKH 的 TSPTW 求的是回路，把「回到出发点」的弧成本置 0，
    # 这样 makespan 就是最后一个点位的结束时间（返程不计入目标，但出发仍固定在出发点）。
    for i in range(1, len(nodes)):
        symmetric[i][0] = 0
    order = solve_with_lkh(nodes, symmetric, windows, service, makespan=makespan)
    solver = "LKH-3.0.14"
    matrix = {"nodes": nodes, "minutes": minutes, "legs": matrix_legs}
    if order is None:
        order = fallback_order(nodes, matrix, windows, service, start_seconds)
        solver = "内置插入法+2-opt"
    if order and order[0] != 0:
        order.remove(0)
        order.insert(0, 0)
    return _plan_from_order(
        nodes, order, matrix_legs, windows, service, start_seconds,
        solver=solver, estimated=estimated,
        objective="makespan" if makespan else "travel",
    )
