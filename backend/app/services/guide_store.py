"""整体攻略的本地文件存储：data/guides/<id>.json + index.json，原子写，支持只读分享 token。"""

from __future__ import annotations

import json
import os
import secrets
import uuid
from datetime import datetime
from pathlib import Path

from ..config import get_settings
from . import flow_store


class GuideNotFound(FileNotFoundError):
    pass


def guides_dir() -> Path:
    path = Path(get_settings().guides_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def guide_path(guide_id: str) -> Path:
    safe = "".join(ch for ch in str(guide_id) if ch.isalnum() or ch in "-_")
    if not safe or not safe.startswith("guide-"):
        raise GuideNotFound("攻略 id 非法")
    return guides_dir() / f"{safe}.json"


def index_path() -> Path:
    return guides_dir() / "index.json"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _write_atomic(path: Path, payload: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def new_id() -> str:
    return f"guide-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6]}"


def new_token() -> str:
    return secrets.token_urlsafe(12)


def normalize_item(item: dict, fallback_day: int) -> dict:
    item = dict(item or {})
    day = item.get("day")
    try:
        day = int(day)
    except (TypeError, ValueError):
        day = fallback_day
    return {
        "day": max(1, day),
        "flowId": str(item.get("flowId") or item.get("flow_id") or ""),
        "notes": str(item.get("notes") or ""),
    }


def normalize_guide(guide: dict) -> dict:
    guide = dict(guide or {})
    guide["id"] = str(guide.get("id") or new_id())
    guide.setdefault("name", "未命名攻略")
    items = [normalize_item(item, index + 1) for index, item in enumerate(guide.get("items") or [])]
    items.sort(key=lambda item: item["day"])
    guide["items"] = items
    guide["totals"] = {
        "distance_km": round(float((guide.get("totals") or {}).get("distance_km") or 0), 2),
        "minutes": round(float((guide.get("totals") or {}).get("minutes") or 0), 1),
    }
    return guide


def empty_guide(name: str = "未命名攻略") -> dict:
    return {
        "id": new_id(),
        "name": name,
        "items": [],
        "totals": {"distance_km": 0, "minutes": 0},
        "created_at": _now(),
        "updated_at": _now(),
    }


def load_guide(guide_id: str) -> dict:
    path = guide_path(guide_id)
    if not path.exists():
        raise GuideNotFound(f"攻略不存在：{guide_id}")
    try:
        return normalize_guide(json.loads(path.read_text(encoding="utf-8")))
    except json.JSONDecodeError as error:
        raise GuideNotFound(f"攻略文件损坏：{guide_id}（{error}）") from error


def save_guide(guide: dict) -> dict:
    payload = normalize_guide(guide)
    payload["updated_at"] = _now()
    payload.setdefault("created_at", payload["updated_at"])
    _write_atomic(guide_path(payload["id"]), payload)
    _refresh_index()
    return payload


def create_guide(name: str = "未命名攻略", items: list[dict] | None = None) -> dict:
    guide = empty_guide(name)
    guide["items"] = items or []
    return save_guide(guide)


def delete_guide(guide_id: str) -> None:
    path = guide_path(guide_id)
    if path.exists():
        path.unlink()
    _refresh_index()


def ensure_share_token(guide_id: str) -> str:
    guide = load_guide(guide_id)
    share = dict(guide.get("share") or {})
    token = share.get("token") or new_token()
    share.update({"token": token, "created_at": share.get("created_at") or _now()})
    guide["share"] = share
    save_guide(guide)
    return token


def find_by_token(token: str) -> dict:
    wanted = str(token or "").strip()
    if not wanted:
        raise GuideNotFound("分享 token 非法")
    for path in sorted(guides_dir().glob("guide-*.json")):
        try:
            guide = normalize_guide(json.loads(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, ValueError):
            continue
        if (guide.get("share") or {}).get("token") == wanted:
            return guide
    raise GuideNotFound("分享链接已失效")


def summarize(guide: dict) -> dict:
    items = guide.get("items") or []
    return {
        "id": guide.get("id"),
        "name": guide.get("name"),
        "cities": [((item.get("flow") or {}).get("city") or "") for item in items],
        "days": len(items),
        "totals": guide.get("totals"),
        "shared": bool((guide.get("share") or {}).get("token")),
        "updated_at": guide.get("updated_at"),
    }


def expand(guide: dict) -> dict:
    """附上每条引用的流程摘要，便于前端与分享页直接渲染。"""
    payload = dict(guide)
    enriched = []
    for item in payload.get("items") or []:
        entry = dict(item)
        try:
            flow = flow_store.load_flow(item["flowId"])
            entry["flow"] = flow_store.summarize(flow)
        except (flow_store.FlowNotFound, ValueError):
            entry["flow"] = None
        enriched.append(entry)
    payload["items"] = enriched
    return payload


def list_guides() -> list[dict]:
    items: list[dict] = []
    for path in sorted(guides_dir().glob("guide-*.json")):
        try:
            guide = normalize_guide(json.loads(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, ValueError):
            continue
        summary = summarize(expand(guide))
        items.append(summary)
    items.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return items


def _refresh_index() -> dict:
    payload = {"updated_at": _now(), "guides": list_guides()}
    _write_atomic(index_path(), payload)
    return payload
