"""把旧的 data/trips/*.json 一次性迁移成「城市流程 + 整体攻略」。

- 每个行程里的一天 → 一条 flow（同城多天会各生成一条，名称里带天号，绝不丢内容）
- 每个行程 → 一条 guide（逐日引用这些 flow，并汇总里程/时长）
- 幂等：flow/guide 的 id 由原行程 id + 天号哈希得到，重复执行只会覆盖同样内容
- 保留原文件，不删除任何数据；加 --cleanup 才会把原行程移到 data/trips/_migrated/

用法：python tools/migrate_trips.py [--dry-run] [--cleanup]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.services import flow_store, guide_store  # noqa: E402

TRIPS_DIR = Path(__file__).resolve().parents[1] / "data" / "trips"


def stable_id(prefix: str, *parts: object) -> str:
    digest = hashlib.sha1("|".join(str(part) for part in parts).encode("utf-8")).hexdigest()[:10]
    return f"{prefix}-{digest}"


def ordered_points(day: dict) -> list[dict]:
    stops = list(day.get("stops") or [])
    order = [item for item in ((day.get("plan") or {}).get("order") or []) if isinstance(item, str)]
    if not order:
        return stops
    by_id = {stop.get("id"): stop for stop in stops}
    by_name: dict[str, dict] = {}
    for stop in stops:
        by_name.setdefault(str(stop.get("name") or ""), stop)
    sequenced = [by_id.get(item) or by_name.get(item) for item in order]
    result = [stop for stop in sequenced if stop]
    result += [stop for stop in stops if stop not in result]
    return result


def day_to_flow(trip: dict, day: dict, index: int) -> dict:
    flow_id = stable_id("flow-mig", trip.get("id"), day.get("index"))
    city = dict(day.get("city") or {})
    name = f"{trip.get('name') or '行程'} · 第 {day.get('index')} 天"
    if city.get("name"):
        name += f" {city['name']}"
    return {
        "id": flow_id,
        "name": name,
        "city": city,
        "transport": day.get("mode") or "taxi",
        "objective": day.get("objective") or "makespan",
        "day_start": day.get("day_start") or "09:00",
        "day_end": day.get("day_end") or "20:00",
        "start": day.get("start"),
        "end": day.get("end"),
        "points": ordered_points(day),
        "plan": day.get("plan"),
        "migrated_from": {"trip": trip.get("id"), "day": day.get("index")},
        "created_at": trip.get("created_at"),
    }


def migrate(dry_run: bool = False, cleanup: bool = False, trips_dir: Path | None = None) -> dict:
    report = {"trips": 0, "flows": 0, "guides": 0, "skipped": 0}
    root = Path(trips_dir) if trips_dir else TRIPS_DIR
    trip_files = sorted(path for path in root.glob("trip-*.json"))
    for path in trip_files:
        try:
            trip = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            report["skipped"] += 1
            continue
        report["trips"] += 1
        items = []
        for index, day in enumerate(trip.get("days") or []):
            flow = day_to_flow(trip, day, index)
            if not (flow["points"] or flow["city"].get("name")):
                continue
            if not dry_run:
                try:
                    saved = flow_store.save_flow(flow)
                except ValueError as error:
                    print(f"  ! {path.name} 第 {day.get('index')} 天跳过：{error}")
                    continue
                flow = saved
            report["flows"] += 1
            items.append({"day": int(day.get("index") or (index + 1)), "flowId": flow["id"], "notes": ""})
        if not items:
            continue
        guide = {
            "id": stable_id("guide-mig", trip.get("id")),
            "name": f"{trip.get('name') or '行程'}（迁移攻略）",
            "items": items,
            "totals": {"distance_km": 0, "minutes": 0},
        }
        if not dry_run:
            from backend.app.services import guide_builder

            try:
                built = guide_builder.build_guide(guide["name"], items)
                built["id"] = guide["id"]
                guide_store.save_guide(built)
            except ValueError as error:
                print(f"  ! {path.name} 攻略生成失败：{error}")
                continue
        report["guides"] += 1
        if cleanup and not dry_run:
            archived = root / "_migrated"
            archived.mkdir(parents=True, exist_ok=True)
            shutil.move(str(path), str(archived / path.name))
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="把旧行程迁移成城市流程与整体攻略")
    parser.add_argument("--dry-run", action="store_true", help="只统计，不写文件")
    parser.add_argument("--cleanup", action="store_true", help="迁移后把原行程移到 data/trips/_migrated/")
    args = parser.parse_args()
    report = migrate(dry_run=args.dry_run, cleanup=args.cleanup)
    mode = "（演练，未写入）" if args.dry_run else ""
    print(f"迁移完成{mode}：行程 {report['trips']} 个 → 流程 {report['flows']} 条 · 攻略 {report['guides']} 条")
    if report["skipped"]:
        print(f"跳过的损坏文件：{report['skipped']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
