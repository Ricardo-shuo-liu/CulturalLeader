"""穿越系统的公共构造与工具（示意疆域加密、地点/诗词条目构造）。

数据只放在 Python 模块里直接读取，不写 SQLite、不做迁移；诗词全部为公有领域古文。
"""

from __future__ import annotations


def densify(points: list[list[float]], per_segment: int = 3) -> list[list[float]]:
    """把控制点线性加密成更细的闭合环（供地形/边界网格使用）。"""
    if len(points) < 3:
        return [list(point) for point in points]
    out: list[list[float]] = []
    for index, start in enumerate(points):
        end = points[(index + 1) % len(points)]
        for step in range(per_segment):
            t = step / per_segment
            out.append([round(start[0] + (end[0] - start[0]) * t, 3), round(start[1] + (end[1] - start[1]) * t, 3)])
    out.append(list(out[0]))  # 闭合
    return out


def place(
    key: str,
    ancient: str,
    modern: str,
    lng: float,
    lat: float,
    kind: str,
    summary: str,
    narration: str,
    knowledge: list[tuple[str, str]] | None = None,
    note: str = "",
) -> dict:
    return {
        "id": key,
        "ancient": ancient,
        "modern": modern,
        "lng": lng,
        "lat": lat,
        "kind": kind,
        "summary": summary,
        "narration": narration,
        "knowledge": [{"question": q, "answer": a} for q, a in (knowledge or [])],
        "note": note,
    }


def poem(
    key: str,
    title: str,
    author: str,
    text: str,
    place_id: str,
    background: str,
    tags: list[str] | None = None,
    knowledge: list[tuple[str, str]] | None = None,
    place_note: str = "",
) -> dict:
    return {
        "id": key,
        "title": title,
        "author": author,
        "text": text,
        "place_id": place_id,
        "background": background,
        "tags": tags or [],
        "knowledge": [{"question": q, "answer": a} for q, a in (knowledge or [])],
        "place_note": place_note,
    }


KIND_LABEL = {
    "capital": "都城",
    "city": "州府",
    "state": "州府",
    "pass": "关隘",
    "temple": "寺观",
    "scenic": "名胜",
    "port": "港口",
    "post": "驿站",
}


def kind_label(kind: str) -> str:
    return KIND_LABEL.get(kind, "地点")
