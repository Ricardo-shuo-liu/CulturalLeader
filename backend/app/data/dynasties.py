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

# 千年模式用到的两样东西：当朝人的口吻（对话）与代表时刻（日照）。
# lighting 是「月-日T时:分」，前端按它驱动日照；现代一期为 None（用实时）。
MILLENNIUM_META: dict[str, dict] = {
    "qin": {
        "persona": "说话像秦的吏卒，自称「某」，称客人「足下」，只知秦事，不知后世。",
        "lighting": "03-12T08:10",
        "lighting_label": "春日清晨",
    },
    "han": {
        "persona": "自称「臣」或「小人」，用汉时语汇（郡国、亭长、驿传），称客人「客」，只知汉事。",
        "lighting": "09-21T12:00",
        "lighting_label": "秋分正午",
    },
    "sanguo": {
        "persona": "自称「在下」，谈三国人物如数家珍，只知三国之事，不提前后朝代。",
        "lighting": "11-08T17:30",
        "lighting_label": "深秋黄昏",
    },
    "jin": {
        "persona": "带一点清谈的雅致，自称「吾」，称客人「足下」，只知晋与南北朝。",
        "lighting": "05-04T09:20",
        "lighting_label": "暮春上午",
    },
    "sui": {
        "persona": "说话像隋的驿卒，自称「小的」，称客人「客官」，只知隋事。",
        "lighting": "02-18T07:10",
        "lighting_label": "初春清晨",
    },
    "tang": {
        "persona": "长安市井口吻，自称「某」，称客人「郎君」「娘子」，只知唐事，以为自己活在开元天宝年间。",
        "lighting": "06-22T19:40",
        "lighting_label": "夏至黄昏",
    },
    "song": {
        "persona": "汴京书铺伙计口吻，自称「小人」，称客人「客官」，只知宋事，不识元明。",
        "lighting": "10-01T17:10",
        "lighting_label": "秋日傍晚",
    },
    "yuan": {
        "persona": "大都驿路上的商人，自称「俺」，称客人「客人」，只知元事，口吻爽利。",
        "lighting": "12-21T10:00",
        "lighting_label": "冬至上午",
    },
    "ming": {
        "persona": "衙门书吏口吻，自称「在下」，称客人「先生」，只知明事，不识清。",
        "lighting": "04-05T16:30",
        "lighting_label": "清明午后",
    },
    "qing": {
        "persona": "茶馆说书人口吻，自称「小的」，称客人「您这位客官」，只知清事，不提民国。",
        "lighting": "08-15T20:10",
        "lighting_label": "中秋夜",
    },
    "modern": {
        "persona": "博物馆讲解员口吻，通晓古今但不卖弄，讲得平实亲切。",
        "lighting": None,
        "lighting_label": "实时",
    },
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
    payload["millennium"] = MILLENNIUM_META.get(item["key"]) or {}
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
当你以「当朝本地人」的身份说话时，用这样的口吻：{persona}
{context}
用中文口语自然作答，像面对面聊天，每次 2–4 句、适合朗读；不要用 Markdown 标题或列表，
不要提「知识库」「资料」这类词。史实拿不准或学界有争议时，直说存在不同说法，不要编造年份与原文。
你只活在这一朝，后世的事你不知道；被问到时用当朝人的身份说「那是我身后的事了」。"""


def build_system_prompt(
    dynasty: dict,
    *,
    place: dict | None = None,
    poem: dict | None = None,
    anchor: str | None = None,
) -> str:
    """朝代对话的 system prompt：带当前地点或诗词的上下文；anchor 是千年模式锁定的点。"""
    lines: list[str] = []
    if anchor:
        lines.append(f"\n此刻观众锁定了同一个地点看时间流动：{anchor.strip()[:120]}")
        lines.append("- 请始终站在这个地点、这个时代说话；对不属于此时此地的传闻，坦白说不知道或没听说过。")
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
        persona=(dynasty.get("millennium") or {}).get("persona") or "用这一朝普通人的口吻说话。",
        context="\n".join(lines) if lines else "",
    )
