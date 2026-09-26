"""行程的本地文件存储（单人软件）：data/trips/<id>.json + index.json，原子写。"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from pathlib import Path

from ..config import get_settings

DEFAULT_MODE = "taxi"
DEFAULT_OBJECTIVE = "makespan"
DEFAULT_DAY_START = "09:00"
DEFAULT_DAY_END = "20:00"
DEFAULT_DWELL = 60


class TripNotFound(FileNotFoundError):
    pass


def trips_dir() -> Path:
    path = Path(get_settings().trips_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def trip_path(trip_id: str) -> Path:
    safe = "".join(ch for ch in trip_id if ch.isalnum() or ch in "-_")
    if not safe:
        raise TripNotFound("行程 id 非法")
    return trips_dir() / f"{safe}.json"


def index_path() -> Path:
    return trips_dir() / "index.json"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _write_atomic(path: Path, payload: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def new_id() -> str:
    return f"trip-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6]}"


def empty_day(index: int, city: dict | None = None) -> dict:
    return {
        "index": index,
        "city": city or {},
        "mode": DEFAULT_MODE,
        "objective": DEFAULT_OBJECTIVE,
        "day_start": DEFAULT_DAY_START,
        "day_end": DEFAULT_DAY_END,
        "start": None,
        "end": None,
        "stops": [],
        "manual": False,
        "plan": None,
    }


def create_trip(name: str, days: int = 1, city: dict | None = None) -> dict:
    trip = {
        "id": new_id(),
        "name": name or "未命名行程",
        "created_at": _now(),
        "updated_at": _now(),
        "days": [empty_day(index + 1, city) for index in range(max(1, days))],
    }
    return save_trip(trip)


def load_trip(trip_id: str) -> dict:
    path = trip_path(trip_id)
    if not path.exists():
        raise TripNotFound(f"行程不存在：{trip_id}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise TripNotFound(f"行程文件损坏：{trip_id}（{error}）") from error


def save_trip(trip: dict) -> dict:
    trip = dict(trip)
    trip.setdefault("id", new_id())
    trip["updated_at"] = _now()
    trip.setdefault("created_at", trip["updated_at"])
    trip.setdefault("days", [empty_day(1)])
    _write_atomic(trip_path(trip["id"]), trip)
    _refresh_index()
    return trip


def delete_trip(trip_id: str) -> None:
    path = trip_path(trip_id)
    if path.exists():
        path.unlink()
    _refresh_index()


def list_trips() -> list[dict]:
    items = []
    for path in sorted(trips_dir().glob("trip-*.json")):
        try:
            trip = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        days = trip.get("days") or []
        stops = sum(len(day.get("stops") or []) for day in days)
        cities = [day.get("city", {}).get("name") for day in days if day.get("city")]
        items.append(
            {
                "id": trip.get("id"),
                "name": trip.get("name"),
                "days": len(days),
                "stops": stops,
                "cities": [name for name in cities if name],
                "updated_at": trip.get("updated_at"),
            }
        )
    items.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return items


def _refresh_index() -> dict:
    payload = {"updated_at": _now(), "trips": list_trips()}
    _write_atomic(index_path(), payload)
    return payload


def import_trip(payload: dict) -> dict:
    """导入外部 JSON：换新 id，避免覆盖已有行程。"""
    trip = dict(payload)
    trip["id"] = new_id()
    trip["name"] = (trip.get("name") or "导入的行程") + "（导入）"
    return save_trip(trip)
