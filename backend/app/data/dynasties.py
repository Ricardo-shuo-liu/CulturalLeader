"""穿越系统数据入口：秦 → 现代（示意疆域 + 历史地名 + 诗词歌赋）。"""

from __future__ import annotations

from .dynasty_common import kind_label
from .dynasty_han import HAN
from .dynasty_jin import JIN
from .dynasty_ming import MING
from .dynasty_modern import MODERN
from .dynasty_qin import QIN
from .dynasty_qing import QING
from .dynasty_sanguo import SANGUO
from .dynasty_song import SONG
from .dynasty_sui import SUI
from .dynasty_tang import TANG
from .dynasty_yuan import YUAN

# 按时间顺序排列：秦 → 汉 → 三国 → 晋·南北朝 → 隋 → 唐 → 宋 → 元 → 明 → 清 → 现代
DYNASTIES: dict[str, dict] = {
    item["key"]: item
    for item in (QIN, HAN, SANGUO, JIN, SUI, TANG, SONG, YUAN, MING, QING, MODERN)
}

# 立碑展示的代表诗词：碑面刻首联（两列竖排），其余诗词仍是可点的光点。
# 选的是流传最广、句子短、适合刻在碑上的几首，且尽量分布在不同地方。
FEATURED = {
    "qin": ["wuyi", "jianjia", "caiwei", "guoshang", "yishuige", "lisao"],
    "han": ["dafeng", "gaixia", "changgexing", "jiangnan", "moshangsang", "qiufengci"],
    "sanguo": ["guancanghai", "duangexing", "guisuishou", "qibushi", "baimapian", "liangfuyin"],
    "jin": ["yinjiu", "guiyuantianju", "chilege", "mulan", "dengchishang", "lantingxu"],
    "sui": ["renrisigui", "chunjiang", "yinmachangcheng_sui", "congjunxing_sui", "yewang_sui", "songbie_sui"],
    "tang": ["jingyesi", "zaofabaidicheng", "chunwang", "liangzhouci", "fengqiaoyebo", "dengguanquelou"],
    "song": ["niannujiao", "shuidiaogetou", "tixilinbi", "yinhushang", "shengshengman", "guolingdingyang"],
    "yuan": ["tianjingsha_qiusi", "shangpoyang_tongguan", "momei", "sikuaiyu", "shuixianzi_yeyu", "tianjingsha_chun"],
    "ming": ["shihuiyin", "linjiangxian", "taohuaan", "wangquetai", "jingshidejiashu", "bieyunjian"],
    "qing": ["changxiangsi", "zhushi", "jihai5", "fushu", "yuzhongtibi", "chunchou"],
    "modern": ["zaibiekangqiao", "yueye", "zichao", "qizizhige", "wangdalu", "duijiu"],
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
                "minor": len(item.get("minor") or []),
                "poems": len(item.get("poems") or []),
            }
        )
    return items


# 次级地名（只有名字、今名与坐标）自动成文：既省数据，又能把地图填满、便于定位
MINOR_NARRATION = {
    "capital": "{name}曾为都城，宫室与官署集中于此。",
    "state": "{name}是这一方的州府所在，市集、驿站与官仓都设在这里。",
    "pass": "{name}扼守要道，往来的商旅与戍卒都要从此过关。",
    "port": "{name}的码头上停着南来北往的商船，货物在此集散。",
    "temple": "{name}香火不断，是这一带僧侣与信众聚集之处。",
    "scenic": "{name}山水清嘉，是当时人游赏题咏的地方。",
    "city": "{name}是这一带的大城，人口稠密、市面繁华。",
}


def _expand_minor(dynasty: dict, entry: tuple, index: int) -> dict:
    ancient, modern, lng, lat, kind = entry
    label = kind_label(kind)
    template = MINOR_NARRATION.get(kind, "{name}是这一带往来的必经之地。")
    return {
        "id": f"{dynasty['key']}-m{index + 1}",
        "ancient": ancient,
        "modern": modern,
        "lng": lng,
        "lat": lat,
        "kind": kind,
        "kind_label": label,
        "summary": f"{dynasty['name']}时的{label}，今 {modern}。",
        "narration": template.format(name=ancient),
        "knowledge": [],
        "note": "",
        "minor": True,
    }


def get_dynasty(key: str) -> dict | None:
    item = DYNASTIES.get(str(key or "").strip().lower())
    if not item:
        return None
    payload = dict(item)
    payload["places"] = [
        {**place, "kind_label": kind_label(place.get("kind", ""))} for place in item.get("places") or []
    ]
    payload["minor"] = [_expand_minor(item, entry, index) for index, entry in enumerate(item.get("minor") or [])]
    featured = set(FEATURED.get(item["key"], []))
    poem_ids = {poem.get("id") for poem in item.get("poems") or []}
    payload["poems"] = [{**poem, "featured": poem.get("id") in featured} for poem in item.get("poems") or []]
    payload["featured"] = [poem_id for poem_id in FEATURED.get(item["key"], []) if poem_id in poem_ids]
    payload["counts"] = {
        "places": len(payload["places"]),
        "minor": len(payload["minor"]),
        "poems": len(payload["poems"]),
        "total_places": len(payload["places"]) + len(payload["minor"]),
    }
    return payload


def find_place(dynasty: dict, place_id: str | None) -> dict | None:
    if not place_id:
        return None
    return next((place for place in dynasty.get("places") or [] if place.get("id") == place_id), None)


def find_poem(dynasty: dict, poem_id: str | None) -> dict | None:
    if not poem_id:
        return None
    return next((poem for poem in dynasty.get("poems") or [] if poem.get("id") == poem_id), None)


# 对话走数字人原有的那套链路，这里只做「提示词指定」：说清是哪一朝、都城与当前话题。
PERSONA_TEMPLATE = """你是「{dynasty_full}（{period}）」的数字人讲解员，此刻陪着观众站在这一朝的疆域沙盘前。
都城：{capital}。这一朝的背景：{summary}
{context}
用中文口语自然作答，像面对面聊天，每次 2–4 句、适合朗读；不要用 Markdown 标题或列表，
不要提「知识库」「资料」这类词。史实拿不准或学界有争议时，直说存在不同说法，不要编造年份与原文。"""


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
