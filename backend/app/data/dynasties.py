"""穿越系统数据入口：唐 / 宋 / 明（示意疆域 + 历史地名 + 诗词歌赋）。"""

from __future__ import annotations

from .dynasty_common import kind_label
from .dynasty_ming import MING
from .dynasty_song import SONG
from .dynasty_tang import TANG

DYNASTIES: dict[str, dict] = {item["key"]: item for item in (TANG, SONG, MING)}

# 立碑展示的代表诗词：碑面刻首联（两列竖排），其余诗词仍是可点的光点。
# 选的是流传最广、句子短、适合刻在碑上的几首，且尽量分布在不同地方。
FEATURED = {
    "tang": ["jingyesi", "zaofabaidicheng", "chunwang", "liangzhouci", "fengqiaoyebo", "dengguanquelou"],
    "song": ["niannujiao", "shuidiaogetou", "tixilinbi", "yinhushang", "shengshengman", "guolingdingyang"],
    "ming": ["shihuiyin", "linjiangxian", "taohuaan", "wangquetai", "jingshidejiashu", "bieyunjian"],
}


def dynasty_list() -> list[dict]:
    items = []
    for item in DYNASTIES.values():
        items.append(
            {
                "key": item["key"],
                "name": item["name"],
                "full_name": item.get("full_name") or item["name"],
                "period": item["period"],
                "capital": item["capital"],
                "color": item["color"],
                "summary": item["summary"],
                "places": len(item.get("places") or []),
                "poems": len(item.get("poems") or []),
            }
        )
    return items


def get_dynasty(key: str) -> dict | None:
    item = DYNASTIES.get(str(key or "").strip().lower())
    if not item:
        return None
    payload = dict(item)
    payload["places"] = [{**place, "kind_label": kind_label(place.get("kind", ""))} for place in item.get("places") or []]
    featured = set(FEATURED.get(item["key"], []))
    poem_ids = {poem.get("id") for poem in item.get("poems") or []}
    payload["poems"] = [{**poem, "featured": poem.get("id") in featured} for poem in item.get("poems") or []]
    payload["featured"] = [poem_id for poem_id in FEATURED.get(item["key"], []) if poem_id in poem_ids]
    return payload


def find_place(dynasty: dict, place_id: str | None) -> dict | None:
    if not place_id:
        return None
    return next((place for place in dynasty.get("places") or [] if place.get("id") == place_id), None)


def find_poem(dynasty: dict, poem_id: str | None) -> dict | None:
    if not poem_id:
        return None
    return next((poem for poem in dynasty.get("poems") or [] if poem.get("id") == poem_id), None)


PERSONA_TEMPLATE = """你是「{dynasty_full}（{period}）」的数字人讲解员，此刻正陪着观众站在这一朝的疆域沙盘前。

你的身份与口吻
- 你是这个朝代的人：说话用当时的称谓与地名（如「长安」「东京」「应天府」），可以自然地提到当朝的风物、制度与人物。
- 语气像面对面聊天，不要使用 Markdown 标题与列表，每次回答 2–4 句，适合朗读。

本朝背景
- 都城：{capital}
- 简介：{summary}
{context}

要求
1. 回答以史实为主；遇到学界有争议或你不确定的内容，要明确说「这一点史料有不同说法」。
2. 允许在史实基础上自由展开，但不要编造具体年份、数字或原文；拿不准就不说。
3. 不要提及「知识库」「资料」这类词，也不要重复观众的原话。"""


def build_system_prompt(dynasty: dict, *, place: dict | None = None, poem: dict | None = None) -> str:
    """朝代对话的 system prompt：带当前地点或诗词的上下文。"""
    lines: list[str] = []
    if poem:
        lines.append(f"\n当前话题：诗词《{poem['title']}》（{poem['author']}）")
        lines.append(f"- 全文：{poem['text']}")
        lines.append(f"- 背景：{poem.get('background') or '暂无'}")
        if poem.get("place_note"):
            lines.append(f"- 写作地说明：{poem['place_note']}（回答时若要提到地点，请保留这种「有不同说法」的措辞）")
        host = f"（写作地：{poem.get('place_label') or ''}）" if poem.get("place_label") else ""
        lines.append(f"- 相关地点{host}")
    if place:
        lines.append(f"\n当前话题：地点「{place['ancient']}」（今 {place['modern']}，{place.get('kind_label') or ''}）")
        lines.append(f"- 简介：{place.get('summary') or '暂无'}")
        if place.get("narration"):
            lines.append(f"- 讲解参考：{place['narration']}")
        if place.get("note"):
            lines.append(f"- 备注：{place['note']}")
    return PERSONA_TEMPLATE.format(
        dynasty_full=dynasty.get("full_name") or dynasty.get("name"),
        period=dynasty.get("period") or "",
        capital=dynasty.get("capital") or "",
        summary=dynasty.get("summary") or "",
        context="\n".join(lines) if lines else "",
    )
