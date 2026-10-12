"""一块土地的千年：按「今名」把 11 期历史数据聚合到同一个点上。

穿越全景是「按朝代看全图」；千年模式反过来——锁定一个地点，让时间在这个点上流动。
本模块只做聚合与策展，不改动各朝代模块里的事实数据：

1. 逐期匹配今名，顺序为：精确 → 前缀（西安 → 西安阎良）→ 策展补注 → 60km 内最近地名；
2. 策展补注写在 CURATED 里：十座精选城市的断档、跨城说明，以及示意疆域未画到的河西 / 闽地；
3. 每期的代表时刻（月-日 + 时:分，见 dynasties.MILLENNIUM_META）交给前端驱动日照，
   现代一期没有代表时刻，用实时。

数据全部来自公有领域的历史资料，与 dynasty_*.py 同源。
"""

from __future__ import annotations

from math import asin, cos, radians, sin, sqrt

from .dynasties import DYNASTIES, MILLENNIUM_META, get_dynasty
from .millennium_events import city_events
from .millennium_landmarks import landmark_timeline

# 60km 内的最近地名只作「就近参考」；超过这个距离就承认此地此朝没有记载
NEAR_KM = 60.0

# 精选十城：演示镜头与内容补洞重点（其余城市全量自动聚合）
PREMIUM_CITIES = ("西安", "洛阳", "北京", "南京", "成都", "杭州", "苏州", "敦煌", "泉州", "开封")

# 连续时间轴的分段：单调节段（相邻两段的交界处做形变混合），与各朝官方年代略有出入，
# 期卡仍显示各朝自己的 period 文本。
_BAND_SPANS: list[tuple[str, int, int]] = [
    ("qin", -221, -206),
    ("han", -206, 220),
    ("sanguo", 220, 280),
    ("jin", 280, 589),
    ("sui", 589, 618),
    ("tang", 618, 907),
    ("song", 907, 1279),
    ("yuan", 1279, 1368),
    ("ming", 1368, 1644),
    ("qing", 1644, 1912),
    ("modern", 1912, 0),  # end = 今年，构建时间轴时补齐
]

# 跨段时的形变混合窗口（年）
BLEND_YEARS = 12


def build_bands(now_year: int) -> list[dict]:
    """年代分带：连续时间轴的坐标系（-221 → 今年）。"""

    bands = []
    for key, start, end in _BAND_SPANS:
        dynasty = DYNASTIES.get(key) or {}
        bands.append(
            {
                "key": key,
                "name": dynasty.get("name") or key,
                "start": start,
                "end": end or now_year,
                "color": dynasty.get("color") or "#d8b46a",
                "period": dynasty.get("period") or "",
            }
        )
    return bands

# 策展补注：键是今名，值是「时期 key → 条目」。
# 条目字段：ancient（当期古名）、summary（一句话）、note（说明）、kind（可选，默认 state）。
CURATED: dict[str, dict[str, dict]] = {
    "西安": {
        "qin": {
            "ancient": "内史",
            "summary": "秦时此地属内史，都城咸阳在渭水北岸三十里，驰道自此东出函谷。",
            "note": "秦都咸阳与今西安隔渭水相望，汉长安城就建在咸阳的废墟之南。",
        },
    },
    "敦煌": {
        "qin": {
            "ancient": "月氏牧地",
            "summary": "秦时这里是月氏牧地，尚未设郡县；汉武帝开河西之后才置敦煌郡。",
            "note": "示意疆域未及河西，秦的郡县最西止于陇西。",
        },
        "sanguo": {
            "ancient": "敦煌",
            "summary": "曹魏仍领敦煌郡，丝路商队在此补给，城下的月牙泉已经叫这个名字。",
            "note": "示意疆域未画到河西，但曹魏的凉州一直管到敦煌。",
        },
        "song": {
            "ancient": "沙州",
            "summary": "宋初归义军以沙州为号，后来西夏占据河西，这里的名字慢慢从宋的文书里消失。",
            "note": "示意疆域未画到河西。",
        },
        "ming": {
            "ancient": "沙州卫",
            "summary": "明初设沙州卫，后因孤悬关外、补给艰难而内迁，敦煌一度沉寂为游牧之地。",
            "note": "示意疆域未画到河西；嘉峪关以西以卫所羁縻为主。",
        },
    },
    "泉州": {
        "qin": {
            "ancient": "闽中郡",
            "summary": "秦平闽越后设闽中郡，此地尚是越人部族散居之地，没有城郭。",
            "note": "示意疆域未画到闽地。",
        },
        "han": {
            "ancient": "冶县",
            "summary": "汉属会稽郡冶县，中原的文书里还很少出现这里的名字。",
            "note": "示意疆域未画到闽地。",
        },
        "sanguo": {
            "ancient": "东安县",
            "summary": "三国吴置东安县，是泉州最早的县治，在今南安丰州一带。",
            "note": "示意疆域未画到闽地，但孙吴的船队已经沿海南下。",
        },
        "jin": {
            "ancient": "晋安",
            "summary": "晋置晋安县，中原士族南渡之后，这里开始有姓氏、族谱与寺院。",
            "note": "示意疆域未画到闽地。",
        },
        "sui": {
            "ancient": "南安",
            "summary": "隋置南安县，港口与市集沿着晋江慢慢长出来。",
            "note": "示意疆域未画到闽地。",
        },
    },
    "杭州": {
        "sanguo": {
            "ancient": "钱唐",
            "summary": "三国吴置钱唐县，属吴郡，县治还在西湖群山之间的江边。",
            "note": "示意疆域未及此处。",
        },
        "jin": {
            "ancient": "钱唐",
            "summary": "晋时钱唐仍是一处江边小县，西湖还与海潮相通，后来才慢慢与江隔绝。",
            "note": "示意疆域未及此处。",
        },
    },
}


def haversine_km(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    """两个经纬度之间的球面距离（公里）。"""

    radius = 6371.0
    d_lat = radians(lat2 - lat1)
    d_lng = radians(lng2 - lng1)
    h = sin(d_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lng / 2) ** 2
    return 2 * radius * asin(min(1.0, sqrt(h)))


def in_outline(lng: float, lat: float, ring: list[list[float]]) -> bool:
    """射线法：点是否在该期示意疆域闭合环内（用于「此朝疆域未及此地」的措辞）。"""

    inside = False
    count = len(ring)
    for index in range(count - 1):
        x1, y1 = ring[index]
        x2, y2 = ring[index + 1]
        if (y1 > lat) != (y2 > lat):
            cross = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lng < cross:
                inside = not inside
    return inside


def _candidates(dynasty: dict) -> list[dict]:
    """一期里的全部候选条目：主地名 + 次级地名（展开后）。"""

    return [*(dynasty.get("places") or []), *(dynasty.get("minor") or [])]


def _match(dynasty: dict, name: str, lng: float, lat: float) -> tuple[str | None, dict | None, float]:
    """在单期内匹配一个今名，返回（来源, 条目, 距离公里）。

    来源：exact（今名精确）> prefix（今名前缀，如 西安 → 西安阎良）> near（60km 内最近）。
    主地名优先于次级地名（同名前缀时取更短、更主的那条）。
    """

    candidates = _candidates(dynasty)
    exact = [item for item in candidates if item.get("modern") == name]
    if exact:
        best = next((item for item in exact if not item.get("minor")), exact[0])
        return "exact", best, 0.0

    if len(name) >= 2:
        prefix = [item for item in candidates if str(item.get("modern") or "").startswith(name)]
        if prefix:
            prefix.sort(key=lambda item: (bool(item.get("minor")), len(str(item.get("modern") or ""))))
            best = prefix[0]
            best_lng = float(best.get("lng") or lng)
            best_lat = float(best.get("lat") or lat)
            return "prefix", best, haversine_km(lng, lat, best_lng, best_lat)

    nearest = None
    nearest_km = float("inf")
    for item in candidates:
        item_lng = item.get("lng")
        item_lat = item.get("lat")
        if item_lng is None or item_lat is None:
            continue
        distance = haversine_km(lng, lat, float(item_lng), float(item_lat))
        if distance < nearest_km:
            nearest = item
            nearest_km = distance
    if nearest is not None and nearest_km <= NEAR_KM:
        return "near", nearest, nearest_km
    return None, None, 0.0


def _poems_for(dynasty: dict, place: dict | None) -> list[dict]:
    """写作地正好是这条地名的诗词（次级地名没有诗词）。"""

    if not place or place.get("minor"):
        return []
    place_id = place.get("id")
    return [dict(item) for item in dynasty.get("poems") or [] if item.get("place_id") == place_id]


def _era_entry(key: str, dynasty: dict, name: str, lng: float, lat: float) -> dict:
    meta = MILLENNIUM_META.get(key) or {}
    curated = (CURATED.get(name) or {}).get(key)
    source, place, distance = _match(dynasty, name, lng, lat)
    note = ""

    # 策展补注优先于自动匹配，但历史数据里的「精确同名」永远最优先：
    # 十城断档用一句更贴切的话填上（如西安的秦、泉州的秦汉）。
    if curated and source != "exact":
        source = "curated"
        place = {
            "id": f"curated-{key}",
            "ancient": curated["ancient"],
            "modern": name,
            "kind": curated.get("kind") or "state",
            "kind_label": "史迹",
            "summary": curated["summary"],
            "narration": curated["summary"],
            "minor": True,
            "distance_km": 0.0,
        }
        note = curated.get("note") or ""
    elif source == "near" and place is not None:
        note = f"就近参考：{place.get('modern')}，约 {round(distance)} 公里外"

    matched = place is not None
    poems = _poems_for(dynasty, place)
    if not matched:
        note = "此朝疆域未及此地" if not in_outline(lng, lat, dynasty.get("outline") or []) else "此朝此地暂无记载"
    elif source == "prefix" and place is not None:
        note = f"今为：{place.get('modern')}"

    return {
        "key": key,
        "name": dynasty.get("name") or key,
        "full_name": dynasty.get("full_name") or dynasty.get("name") or key,
        "period": dynasty.get("period") or "",
        "capital": dynasty.get("capital") or "",
        "color": dynasty.get("color") or "#d8b46a",
        "lighting": meta.get("lighting"),
        "lighting_label": meta.get("lighting_label") or "",
        "persona": meta.get("persona") or "",
        "matched": matched,
        "empty": not matched,
        "source": source,
        "place": place,
        "poems": poems,
        "note": note,
        "distance_km": round(distance, 1) if matched else None,
    }


def build_payload(name: str, lng: float, lat: float, landmark_key: str | None = None) -> dict:
    """千年聚合：一个今名 + 坐标 → 秦到现代 11 期逐期「这里是什么地方」。

    landmark_key 可选：带上时返回该地标的建造年表（千年模式据此演"随史建造"）。
    """

    import datetime

    eras = []
    matched_count = 0
    for key in DYNASTIES:
        dynasty = get_dynasty(key)
        if dynasty is None:
            continue
        entry = _era_entry(key, dynasty, name, lng, lat)
        if entry["matched"]:
            matched_count += 1
        eras.append(entry)
    named = city_events(name)
    bands = build_bands(datetime.date.today().year)
    return {
        "city": {"name": name, "lng": lng, "lat": lat},
        "featured": name in PREMIUM_CITIES,
        "counts": {"matched": matched_count, "total": len(eras)},
        "eras": eras,
        "bands": bands,
        "bounds": {"start": bands[0]["start"], "end": bands[-1]["end"], "blend_years": BLEND_YEARS},
        "headline": named["headline"],
        "events": named["events"],
        "landmark": landmark_timeline(landmark_key) if landmark_key else None,
    }
